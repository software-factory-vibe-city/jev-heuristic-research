import type { DiagnosticResult, DiagnosticSample } from "./experiment.js";

export function summarizeSamples(samples: readonly Pick<DiagnosticSample, "status" | "correct" | "correctProbability">[]) {
  const valid = samples.filter((sample) => sample.status === "ok");
  return {
    total: samples.length, valid: valid.length, errors: samples.length - valid.length,
    correct: valid.filter((sample) => sample.correct).length,
    meanCorrectProbability: valid.length ? valid.reduce((sum, sample) => sum + sample.correctProbability!, 0) / valid.length : null,
  };
}

/** Only compare matching checkpoint/provider/probe/trial pairs; errors never count as wins. */
export function diagnosticPairs(result: DiagnosticResult) {
  const groups = new Map<string, Partial<Record<"coordinates" | "topology", DiagnosticSample>>>();
  for (const sample of result.samples) {
    const key = JSON.stringify([sample.checkpoint, sample.solver, sample.probe, sample.trial]);
    const group = groups.get(key) ?? {};
    if (group[sample.condition]) throw new Error("Duplicate diagnostic sample");
    group[sample.condition] = sample;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => {
    if (!group.coordinates || !group.topology) throw new Error("Incomplete diagnostic pair");
    const { coordinates, topology } = group;
    const valid = coordinates.status === "ok" && topology.status === "ok";
    return { coordinates, topology, valid,
      probabilityDelta: valid ? topology.correctProbability! - coordinates.correctProbability! : null,
      outcome: !valid ? "error" : coordinates.correct && topology.correct ? "both" : coordinates.correct ? "coordinates-only" : topology.correct ? "topology-only" : "neither",
    };
  });
}
