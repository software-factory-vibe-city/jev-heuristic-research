import { defineExperiment } from "../../core/experiment.js";
import type { ExperimentOptions } from "../../core/experiment.js";
import { createChoiceModel, providerConfig } from "../../providers/system-one.js";
import type { ProviderId } from "../../providers/system-one.js";
import { checkpointDefinitions, freezeCheckpoint } from "../maze-diagnostics/checkpoints.js";
import type { FrozenCheckpoint } from "../maze-diagnostics/checkpoints.js";
import { createEncoding, diagnosticState, encodingSeed } from "../maze-diagnostics/encoding.js";
import type { Encoding } from "../maze-diagnostics/encoding.js";
import type { DiagnosticSample } from "../maze-diagnostics/experiment.js";
import { expectedAnswers, probeCriteria } from "../maze-diagnostics/probes.js";
import { actionInstructions, arms, candidateFacts, contrasts, explorationRule, hypothesisState, instructionsFor, ruleInstructions } from "./arms.js";
import type { Arm } from "./arms.js";
import { renderHypotheses } from "./render.js";

export interface HypothesisCase extends FrozenCheckpoint {
  encoding: Encoding;
  expectedAction: string[];
  codeReference: { action: string; correct: boolean };
}
export interface HypothesisSample extends Omit<DiagnosticSample, "condition" | "probe"> {
  arm: Arm;
  ruleAgrees: boolean | null;
  ruleProbability: number | null;
}
export interface HypothesisResult {
  protocol: {
    version: string; encodingSeed: number; options: ExperimentOptions;
    arms: readonly Arm[]; contrasts: typeof contrasts; actionInstructions: string; ruleInstructions: string;
    executionOrder: string; controls: string;
    providers: { id: string; model: string; baseURL: string; timeoutMs: number; retries: number }[];
  };
  cases: HypothesisCase[];
  samples: HypothesisSample[];
}

export function hypothesisSchedule(solvers: readonly ProviderId[], trial: number, caseIndex: number) {
  const offset = (trial - 1 + caseIndex) % arms.length;
  // Four-arm Williams order: each arm occupies each position once over a full cycle.
  const order = [0, 1, 3, 2].map((index) => arms[(index + offset) % arms.length]!);
  const providers = trial % 2 === 0 ? [...solvers].reverse() : [...solvers];
  return providers.flatMap((solver) => order.map((arm) => ({ solver, arm })));
}

export async function runHypotheses(options: ExperimentOptions, createModel = createChoiceModel): Promise<HypothesisResult> {
  if (!options.solvers.length || options.solvers.some((id) => id !== "local" && id !== "jev")) throw new Error("Hypothesis solvers: local, jev; the code reference is evaluated separately");
  if (!Number.isSafeInteger(options.trials) || options.trials < 1) throw new Error("Trials must be a positive integer");
  if (options.maxSteps !== undefined) throw new Error("Frozen-state hypotheses do not support --max-steps");
  if (options.cases.some((id) => !checkpointDefinitions.some((item) => item.id === id))) throw new Error(`Hypothesis cases: ${checkpointDefinitions.map((item) => item.id).join(", ")}`);
  const configs = options.solvers.map((id) => providerConfig(id as ProviderId));
  const selected = options.cases.length ? checkpointDefinitions.filter((item) => options.cases.includes(item.id)) : checkpointDefinitions;
  const cases = selected.map((definition): HypothesisCase => {
    const checkpoint = freezeCheckpoint(definition);
    const encoding = createEncoding(checkpoint);
    const expectedAction = expectedAnswers(checkpoint, encoding, "action");
    const action = explorationRule(candidateFacts(diagnosticState(checkpoint, encoding, "topology")));
    return { ...checkpoint, encoding, expectedAction, codeReference: { action, correct: expectedAction.includes(action) } };
  });
  const result: HypothesisResult = {
    protocol: {
      version: "maze-hypotheses-v1", encodingSeed, options, arms, contrasts, actionInstructions, ruleInstructions,
      executionOrder: "Sequential independent requests. Four-arm Williams order rotates across checkpoint/trial; provider order reverses on even trials. Repeats use identical inputs and one fixed node-label assignment.",
      controls: "Same six frozen diagnostic checkpoints, opaque-ID graphs, legal destination choices, and no coordinates throughout. Control is rerun with a memory-neutral version of the action question. Facts are computed from observations, never from model answers or shortest paths. Summary removes chronology, not all memory. Code reference is not a fallback. No rollouts or answer feedback.",
      providers: configs.map(({ apiKey: _secret, ...config }) => ({ ...config, retries: 0 })),
    }, cases, samples: [],
  };
  for (let trial = 1; trial <= options.trials; trial++) for (const [caseIndex, checkpoint] of cases.entries()) {
    console.log(`  ${checkpoint.id} / trial ${trial}`);
    for (const { solver, arm } of hypothesisSchedule(configs.map((config) => config.id), trial, caseIndex)) {
      const model = createModel(configs.find((config) => config.id === solver)!);
      const sample: HypothesisSample = { checkpoint: checkpoint.id, solver, arm, trial, status: "error",
        correct: null, correctProbability: null, ruleAgrees: null, ruleProbability: null, elapsedMs: 0, modelStats: model.stats };
      const start = performance.now();
      try {
        const decision = await model.decide(hypothesisState(checkpoint, checkpoint.encoding, arm), instructionsFor(arm), probeCriteria(checkpoint, checkpoint.encoding, "action"), "answer");
        const answer = decision.metadata!.answer as { probabilities: Record<string, number> };
        sample.decision = decision;
        sample.status = "ok";
        sample.correct = checkpoint.expectedAction.includes(decision.action);
        sample.correctProbability = checkpoint.expectedAction.reduce((sum, label) => sum + (answer.probabilities[label] ?? 0), 0);
        sample.ruleAgrees = decision.action === checkpoint.codeReference.action;
        sample.ruleProbability = answer.probabilities[checkpoint.codeReference.action] ?? 0;
      } catch (error) {
        sample.error = error instanceof Error ? error.message : String(error);
      }
      sample.elapsedMs = performance.now() - start;
      result.samples.push(sample);
      console.log(`    ${solver} / ${arm}: ${sample.status === "error" ? sample.error : `${sample.correct ? "correct" : "incorrect"} · P(correct)=${sample.correctProbability!.toFixed(3)} · rule=${sample.ruleAgrees}`}`);
    }
  }
  return result;
}

export const mazeHypothesesExperiment = defineExperiment({
  id: "maze-hypotheses", title: "Maze · action-selection hypotheses", defaultSolvers: ["local"],
  run: (options) => runHypotheses(options), render: renderHypotheses,
});
