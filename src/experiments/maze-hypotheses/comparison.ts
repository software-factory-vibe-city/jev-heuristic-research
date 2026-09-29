import { arms, contrasts } from "./arms.js";
import type { Arm } from "./arms.js";
import type { HypothesisResult, HypothesisSample } from "./experiment.js";

export function hypothesisPairs(result: HypothesisResult) {
  const groups = new Map<string, Partial<Record<Arm, HypothesisSample>>>();
  for (const sample of result.samples) {
    const key = JSON.stringify([sample.checkpoint, sample.solver, sample.trial]);
    const group = groups.get(key) ?? {};
    if (group[sample.arm]) throw new Error("Duplicate hypothesis sample");
    group[sample.arm] = sample;
    groups.set(key, group);
  }
  return [...groups.values()].flatMap((group) => {
    if (arms.some((arm) => !group[arm])) throw new Error("Incomplete hypothesis group");
    return contrasts.map((contrast) => {
      const control = group[contrast.control]!;
      const treatment = group[contrast.treatment]!;
      const valid = control.status === "ok" && treatment.status === "ok";
      return { contrast, control, treatment, valid,
        probabilityDelta: valid ? treatment.correctProbability! - control.correctProbability! : null,
        outcome: !valid ? "error" : control.correct && treatment.correct ? "both" : control.correct ? "control-only" : treatment.correct ? "treatment-only" : "neither",
      };
    });
  });
}
