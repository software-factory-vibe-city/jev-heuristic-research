import { test } from "node:test";
import assert from "node:assert/strict";
import { createChoiceModel, providerConfig } from "../src/providers/system-one.js";
import { mazePolicy } from "../src/experiments/maze/policy.js";
import { parseMaze } from "../src/experiments/maze/domain.js";

const config = providerConfig("local", { TYPESAFE_API_KEY: "hosted-secret" });
const validResponse = (probabilities: Record<string, number> = { up: 0, right: .9, down: .1, left: 0 }) => ({
  model: "test-model-v1",
  answers: { move: { type: "choice", choice: "right", confidence: .8, probabilities } },
  usage: { input_tokens: 100, output_tokens: 1 },
});
const criteria = { up: "Up", right: "Right", down: "Down", left: "Left" };

test("local config never inherits hosted credentials or endpoint", () => {
  assert.equal(config.apiKey, "local");
  assert.equal(config.baseURL, "http://localhost:8765");
  assert.throws(() => providerConfig("jev", {}), /requires TYPESAFE_API_KEY/);
  assert.throws(() => providerConfig("local", { MODEL_TIMEOUT_MS: "bad" }), /Invalid/);
  assert.throws(() => providerConfig("local", { LOCAL_BASE_URL: "http://user:secret@localhost:8765" }), /without credentials/);
});

test("SDK adapter sends typed questions, records evidence, and receives a typed choice", async () => {
  const model = createChoiceModel(config, async (input, init) => {
    assert.equal(String(input), "http://localhost:8765/v1/systemone");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer local");
    const request = JSON.parse(String(init?.body));
    assert.equal(request.model, "imajev-4b");
    assert.equal(request.state.maze, "@.G\n.##");
    assert.deepEqual(request.state.legal_moves, ["right", "down"]);
    assert.equal(request.questions.move.type, "choice");
    assert.deepEqual(Object.keys(request.questions.move.criteria), ["right", "down"]);
    assert.equal(request.state.optimalMoves, undefined);
    return Response.json(validResponse({ right: 1, down: 0 }));
  });
  const maze = parseMaze("S.G\n.##");
  const decision = await mazePolicy(maze, model)(maze.start, []);
  assert.equal(decision?.action, "right");
  assert.ok(decision?.metadata?.request);
  assert.equal(model.stats.calls, 1);
  assert.equal(model.stats.inputTokens, 100);
  assert.deepEqual(model.stats.responseModels, ["test-model-v1"]);
});

test("bad choices and probability distributions fail instead of silently selecting a fallback", async () => {
  for (const mutate of [
    (body: ReturnType<typeof validResponse>) => { body.answers.move.choice = "teleport"; },
    (body: ReturnType<typeof validResponse>) => { body.answers.move.confidence = 2; },
    (body: ReturnType<typeof validResponse>) => { body.answers.move.probabilities.right = -.1; },
    (body: ReturnType<typeof validResponse>) => { body.answers.move.probabilities.right = .1; },
  ]) {
    const body = validResponse();
    mutate(body);
    const model = createChoiceModel(config, async () => Response.json(body));
    await assert.rejects(model.decide("state", "move", criteria), /invalid/);
    assert.equal(model.stats.calls, 1);
    assert.deepEqual(model.stats.failure?.response, body);
    assert.ok(model.stats.failure?.request);
  }
});

test("restricted choices reject excluded labels and extra probabilities without fallback", async () => {
  for (const body of [
    { ...validResponse({ right: 1 }), answers: { move: { type: "choice", choice: "up", confidence: 1, probabilities: { up: 1 } } } },
    validResponse(), // Even zero-probability excluded labels must not appear.
  ]) {
    const model = createChoiceModel(config, async () => Response.json(body));
    const maze = parseMaze("S.G\n.##");
    await assert.rejects(async () => mazePolicy(maze, model)(maze.start, []), /invalid/);
    assert.equal(model.stats.calls, 1);
    assert.deepEqual(model.stats.failure?.response, body);
    assert.ok(model.stats.failure?.request);
  }
});

test("HTTP failures have no hidden retries", async () => {
  let requests = 0;
  const model = createChoiceModel(config, async () => {
    requests++;
    return Response.json({ message: "unavailable" }, { status: 503 });
  });
  await assert.rejects(model.decide("state", "move", criteria));
  assert.equal(requests, 1);
  assert.equal(model.stats.calls, 1);
  assert.ok(model.stats.failure?.request);
});

test("request timeout aborts the transport and does not retry", async () => {
  let requests = 0;
  const model = createChoiceModel({ ...config, timeoutMs: 10 }, async (_input, init) => {
    requests++;
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new Error("aborted"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
  });
  await assert.rejects(model.decide("state", "move", criteria), /timed out/i);
  assert.equal(requests, 1);
});
