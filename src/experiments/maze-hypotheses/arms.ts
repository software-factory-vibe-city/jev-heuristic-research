import { diagnosticState } from "../maze-diagnostics/encoding.js";
import type { Encoding, MazeObservation } from "../maze-diagnostics/encoding.js";
import { probeInstructions } from "../maze-diagnostics/probes.js";

export const arms = ["control", "facts", "summary", "rule"] as const;
export type Arm = typeof arms[number];
export const armLabels: Record<Arm, string> = {
  control: "Control", facts: "+ Candidate facts", summary: "Facts, no trajectory", rule: "Facts + explicit rule",
};
export const contrasts = [
  { id: "H1", control: "control", treatment: "facts", title: "Explicit facts", change: "Add deterministic candidate facts; keep the question and full history unchanged." },
  { id: "H2", control: "facts", treatment: "summary", title: "Trajectory interference", change: "Remove only chronological history; retain candidate facts, previous-position flags, visit counts, graph, and question." },
  { id: "H3", control: "facts", treatment: "rule", title: "Supplied policy", change: "Keep the exact facts/history state; replace the shortest-route question with a fully specified exploration rule." },
] as const satisfies readonly { id: string; control: Arm; treatment: Arm; title: string; change: string }[];

// A fresh control avoids comparing a history-referencing prompt with missing history.
export const actionInstructions = probeInstructions.action.replace("check the full movement history", "check the supplied movement memory");
export const ruleInstructions = "Choose the next destination by applying exactly this exploration rule, not by calculating a shortest route. " +
  "First, if any legal candidate has previous_position=false, consider only those candidates; otherwise consider all legal candidates. " +
  "Next, among the remaining candidates, choose the one with the smallest visit_count. " +
  "Break any remaining tie by choosing the lexicographically smallest node ID. Use candidate_facts. Choose only a legal destination.";
export const instructionsFor = (arm: Arm) => arm === "rule" ? ruleInstructions : actionInstructions;

export type CandidateFact = { destination: string; visit_count: number; previous_position: boolean; neighbor_count: number; dead_end: boolean };
export const factDefinition = "Facts about every legal destination, in the same order as legal_destinations: visit_count is its arrival count; previous_position is true only for the node from which the most recent transition arrived (all false if no transition occurred); neighbor_count is its graph degree; dead_end means exactly one neighbor. These are observations, not action recommendations.";

/** Only local graph/history lookups. No goal distances or evaluator answers. */
export function candidateFacts(state: ReturnType<typeof diagnosticState>): CandidateFact[] {
  const previous = state.history.at(-1)?.from;
  return state.legal_destinations.map((destination) => {
    const node = state.graph.nodes.find((node) => node.id === destination)!;
    return { destination, visit_count: state.visit_counts.find((entry) => entry.node === destination)?.count ?? 0,
      previous_position: destination === previous, neighbor_count: node.neighbors.length, dead_end: node.neighbors.length === 1 };
  });
}

export function hypothesisState(checkpoint: MazeObservation, encoding: Encoding, arm: Arm) {
  const base = diagnosticState(checkpoint, encoding, "topology");
  if (arm === "control") return base;
  const facts = { candidate_facts: candidateFacts(base), candidate_fact_definition: factDefinition };
  if (arm === "summary") {
    const { history: _trajectory, ...summary } = base;
    return { ...summary, ...facts };
  }
  return { ...base, ...facts };
}

/** The same rule as the prompt, implemented directly. Not guaranteed globally optimal. */
export function explorationRule(facts: readonly CandidateFact[]): string {
  if (!facts.length) throw new Error("Exploration rule needs a legal candidate");
  const nonPrevious = facts.filter((fact) => !fact.previous_position);
  const eligible = nonPrevious.length ? nonPrevious : [...facts];
  return eligible.sort((a, b) => a.visit_count - b.visit_count || a.destination.localeCompare(b.destination))[0]!.destination;
}
