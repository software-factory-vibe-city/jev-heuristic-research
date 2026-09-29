import { defineExperiment } from "../../core/experiment.js";
import type { ExperimentOptions } from "../../core/experiment.js";
import type { Decision } from "../../core/task.js";
import { createChoiceModel, providerConfig } from "../../providers/system-one.js";
import type { ModelStats, ProviderId } from "../../providers/system-one.js";
import { checkpointDefinitions, freezeCheckpoint } from "./checkpoints.js";
import type { FrozenCheckpoint } from "./checkpoints.js";
import { conditions, createEncoding, diagnosticState, encodingSeed } from "./encoding.js";
import type { Condition, Encoding } from "./encoding.js";
import { expectedAnswers, probeCriteria, probeInstructions, probes } from "./probes.js";
import type { Probe } from "./probes.js";
import { renderDiagnostics } from "./render.js";

export const diagnosticVersion = "maze-diagnostics-v1";
export interface DiagnosticCase extends FrozenCheckpoint { encoding: Encoding; expected: Record<Probe, string[]> }
export interface DiagnosticSample {
  checkpoint: string; solver: ProviderId; condition: Condition; probe: Probe; trial: number;
  status: "ok" | "error"; correct: boolean | null; correctProbability: number | null;
  elapsedMs: number; decision?: Decision<string>; error?: string; modelStats: ModelStats;
}
export interface DiagnosticResult {
  protocol: {
    version: string; encodingSeed: number; options: ExperimentOptions;
    conditions: readonly Condition[]; probes: readonly Probe[]; instructions: Record<Probe, string>;
    executionOrder: string; checkpointSource: string;
    providers: { id: string; model: string; baseURL: string; timeoutMs: number; retries: number }[];
  };
  cases: DiagnosticCase[];
  samples: DiagnosticSample[];
}

export function diagnosticSchedule(solvers: readonly ProviderId[], trial: number, caseIndex: number) {
  const providers = trial % 2 === 0 ? [...solvers].reverse() : [...solvers];
  const offset = (trial - 1 + caseIndex) % probes.length;
  const questions = [...probes.slice(offset), ...probes.slice(0, offset)];
  return providers.flatMap((solver) => questions.flatMap((probe) => {
    const arms = (trial + caseIndex + probes.indexOf(probe)) % 2 === 1 ? [...conditions] : [...conditions].reverse();
    return arms.map((condition) => ({ solver, probe, condition }));
  }));
}

export async function runDiagnostics(options: ExperimentOptions, createModel = createChoiceModel): Promise<DiagnosticResult> {
  if (!options.solvers.length || options.solvers.some((id) => id !== "local" && id !== "jev")) throw new Error("Diagnostic solvers: local, jev (no A* rollout; answers are graded offline)");
  if (!Number.isSafeInteger(options.trials) || options.trials < 1) throw new Error("Trials must be a positive integer");
  if (options.maxSteps !== undefined) throw new Error("Frozen-state diagnostics do not support --max-steps");
  if (options.cases.some((id) => !checkpointDefinitions.some((item) => item.id === id))) throw new Error(`Diagnostic cases: ${checkpointDefinitions.map((item) => item.id).join(", ")}`);
  const configs = options.solvers.map((id) => providerConfig(id as ProviderId));
  const selected = options.cases.length ? checkpointDefinitions.filter((item) => options.cases.includes(item.id)) : checkpointDefinitions;
  const cases = selected.map((definition): DiagnosticCase => {
    const checkpoint = freezeCheckpoint(definition);
    const encoding = createEncoding(checkpoint);
    const expected = Object.fromEntries(probes.map((probe) => [probe, expectedAnswers(checkpoint, encoding, probe)])) as Record<Probe, string[]>;
    return { ...checkpoint, encoding, expected };
  });
  const result: DiagnosticResult = {
    protocol: {
      version: diagnosticVersion, encodingSeed, options, conditions, probes, instructions: probeInstructions,
      executionOrder: "Sequential. Provider order reverses on even trials; probe order rotates across checkpoint/trial; coordinate-arm order alternates across checkpoint/trial/probe. Every question is a separate stateless request. Trials repeat the same labels, node order, and frozen histories.",
      checkpointSource: "Selected before diagnostics from local maze-representation-v3 traces: reports/2026-09-28T05-44-16-001Z-maze-representation-dc66a0e7. Prefixes are embedded in source; reports are not required to reconstruct them.",
      providers: configs.map(({ apiKey: _secret, ...config }) => ({ ...config, retries: 0 })),
    }, cases, samples: [],
  };
  for (let trial = 1; trial <= options.trials; trial++) {
    for (const [caseIndex, checkpoint] of cases.entries()) {
      console.log(`  ${checkpoint.id} / trial ${trial}`);
      for (const { solver, probe, condition } of diagnosticSchedule(configs.map((config) => config.id), trial, caseIndex)) {
        const model = createModel(configs.find((config) => config.id === solver)!);
        const sample: DiagnosticSample = { checkpoint: checkpoint.id, solver, probe, condition, trial,
          status: "error", correct: null, correctProbability: null, elapsedMs: 0, modelStats: model.stats };
        const start = performance.now();
        try {
          // Deliberately build only observable state, never pass the checkpoint/evaluator object.
          const decision = await model.decide(diagnosticState(checkpoint, checkpoint.encoding, condition), probeInstructions[probe], probeCriteria(checkpoint, checkpoint.encoding, probe), "answer");
          const answer = decision.metadata!.answer as { probabilities: Record<string, number> };
          sample.decision = decision;
          sample.status = "ok";
          sample.correct = checkpoint.expected[probe].includes(decision.action);
          sample.correctProbability = checkpoint.expected[probe].reduce((sum, label) => sum + (answer.probabilities[label] ?? 0), 0);
        } catch (error) {
          sample.error = error instanceof Error ? error.message : String(error);
        }
        sample.elapsedMs = performance.now() - start;
        result.samples.push(sample);
        console.log(`    ${solver} / ${probe} / ${condition}: ${sample.status === "error" ? sample.error : `${sample.correct ? "correct" : "incorrect"} · P(correct)=${sample.correctProbability!.toFixed(3)}`}`);
      }
    }
  }
  return result;
}

export const mazeDiagnosticsExperiment = defineExperiment({
  id: "maze-diagnostics", title: "Maze · frozen-state diagnostics", defaultSolvers: ["local"],
  run: (options) => runDiagnostics(options), render: renderDiagnostics,
});
