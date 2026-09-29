import type { Encoding, MazeObservation } from "../maze-diagnostics/encoding.js";
import { hypothesisState } from "../maze-hypotheses/arms.js";

export type RuleMemory = "full" | "summary";

export function ruleMemory(value: string = "full"): RuleMemory {
  if (value !== "full" && value !== "summary") throw new Error("Rule memory must be full or summary");
  return value;
}

/** Summaries are derived from the real trace; only the model-visible chronology is omitted. */
export function ruleObservation(observation: MazeObservation, encoding: Encoding, memory: RuleMemory = "full") {
  return hypothesisState(observation, encoding, ruleMemory(memory) === "summary" ? "summary" : "rule");
}
