import { APIError, choice, TypeSafeClient } from "@typesafe-ai/sdk";
import type { EntryType } from "@typesafe-ai/sdk";
import type { Decision } from "../core/task.js";

export type ProviderId = "local" | "jev";
export interface ProviderConfig {
  id: ProviderId;
  model: string;
  baseURL: string;
  apiKey: string;
  timeoutMs: number;
}

export function providerConfig(id: ProviderId, env = process.env): ProviderConfig {
  const timeoutMs = Number(env.MODEL_TIMEOUT_MS ?? 30_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error("Invalid MODEL_TIMEOUT_MS");
  if (id === "jev" && !env.TYPESAFE_API_KEY?.trim()) throw new Error("jev requires TYPESAFE_API_KEY in .env");
  const baseURL = id === "local" ? env.LOCAL_BASE_URL || "http://localhost:8765" : env.TYPESAFE_BASE_URL || "https://api.typesafe.ai";
  const url = new URL(baseURL);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Model base URL must be HTTP(S), without credentials, query, or fragment");
  }
  return {
    id,
    model: id === "local" ? env.LOCAL_MODEL || "imajev-4b" : env.TYPESAFE_MODEL || "jev-latest",
    baseURL,
    // Never forward the hosted API key to the local endpoint.
    apiKey: id === "local" ? env.LOCAL_API_KEY || "local" : env.TYPESAFE_API_KEY!,
    timeoutMs,
  };
}

export interface ModelStats {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  usageReported: boolean;
  responseModels: string[];
  failure?: { request: unknown; response?: unknown; error: string; http?: { status: number; body: unknown; requestId?: string } };
}

/** Shared SDK adapter. Domain-specific state and questions stay in the experiment. */
export function createChoiceModel(config: ProviderConfig, fetch?: typeof globalThis.fetch) {
  const client = new TypeSafeClient({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
    defaultModel: config.model,
    timeout: config.timeoutMs,
    retry: { maxRetries: 0 }, // One counted call = one HTTP attempt; no hidden benchmark retries.
    logLevel: "off",
    fetch,
  });
  const stats: ModelStats = { calls: 0, inputTokens: 0, outputTokens: 0, usageReported: false, responseModels: [] };
  return {
    stats,
    async decide<A extends string>(
      state: EntryType,
      instructions: string,
      criteria: Partial<Record<A, string>> & Record<string, string>,
      questionKey = "move",
    ): Promise<Decision<A>> {
      const request = { model: config.model, state, questions: { [questionKey]: choice(instructions, criteria) } };
      stats.calls++;
      const response = await client.systemOne(request).catch((error: unknown) => {
        // Keep server diagnostic bodies, but never serialize request/response headers or credentials.
        const redact = (text: string) => config.apiKey ? text.replaceAll(config.apiKey, "[redacted]") : text;
        const message = error instanceof Error ? error.message : String(error);
        const redactBody = (value: unknown): unknown => typeof value === "string" ? redact(value)
          : Array.isArray(value) ? value.map(redactBody)
          : value !== null && typeof value === "object"
            ? Object.fromEntries(Object.entries(value).map(([key, child]) => [redact(key), redactBody(child)])) : value;
        stats.failure = { request, error: redact(message), ...(error instanceof APIError ? { http: {
          status: error.status, body: redactBody(error.body), requestId: error.requestId ? redact(error.requestId) : undefined,
        } } : {}) };
        if (redact(message) !== message) throw new Error(redact(message));
        throw error;
      });
      const fail = (message: string): never => {
        stats.failure = { request, response, error: message };
        throw new Error(message);
      };
      const answer = response?.answers?.[questionKey];
      if (!answer || answer.type !== "choice" || !Object.hasOwn(criteria, answer.choice)) {
        return fail("Model returned an invalid choice answer");
      }
      const probabilities = answer.probabilities;
      const labels = Object.keys(criteria) as A[];
      const probabilityValues = labels.map((label) => probabilities?.[label]);
      if (
        !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1 ||
        !probabilities || Object.keys(probabilities).length !== labels.length ||
        probabilityValues.some((p) => !Number.isFinite(p) || p! < 0 || p! > 1) ||
        Math.abs(probabilityValues.reduce<number>((sum, p) => sum + p!, 0) - 1) > 0.02
      ) fail("Model returned an invalid probability distribution");
      if (typeof response.model === "string" && !stats.responseModels.includes(response.model)) {
        stats.responseModels.push(response.model);
      }
      const usage = response.usage;
      if (usage && Number.isFinite(usage.input_tokens) && Number.isFinite(usage.output_tokens)) {
        stats.usageReported = true;
        stats.inputTokens += usage.input_tokens;
        stats.outputTokens += usage.output_tokens;
      }
      return {
        action: answer.choice as A,
        metadata: { request, answer, responseModel: response.model, usage },
      };
    },
  };
}
