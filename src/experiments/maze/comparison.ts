import type { MazeResult, MazeRun } from "./experiment.js";

export interface RepresentationPair {
  caseId: string;
  solver: string;
  trial: number;
  ascii: MazeRun;
  graph: MazeRun;
}

/** Pair by experimental identity, not array position: execution order is counterbalanced. */
export function representationPairs(result: MazeResult): RepresentationPair[] {
  return result.cases.flatMap((item) => item.runs.filter((run) => run.solver !== "astar" && run.representation === "ascii").map((ascii) => {
    const graph = item.runs.find((run) => run.solver === ascii.solver && run.trial === ascii.trial && run.representation === "graph");
    if (!graph) throw new Error(`Missing graph arm for ${item.id}/${ascii.solver}/${ascii.trial}`);
    return { caseId: item.id, solver: ascii.solver, trial: ascii.trial, ascii, graph };
  }));
}

export function representationSummary(result: MazeResult) {
  const pairs = representationPairs(result);
  return [...new Set(pairs.map((pair) => pair.solver))].map((solver) => {
    const group = pairs.filter((pair) => pair.solver === solver);
    // An infrastructure/response error is not evidence for one encoding over the other.
    const valid = group.filter((pair) => pair.ascii.trace.status !== "error" && pair.graph.trace.status !== "error");
    return {
      solver,
      pairs: group.length,
      errorPairs: group.length - valid.length,
      asciiSolved: group.filter((pair) => pair.ascii.trace.status === "solved").length,
      graphSolved: group.filter((pair) => pair.graph.trace.status === "solved").length,
      graphOnly: valid.filter((pair) => pair.graph.trace.status === "solved" && pair.ascii.trace.status !== "solved").length,
      asciiOnly: valid.filter((pair) => pair.ascii.trace.status === "solved" && pair.graph.trace.status !== "solved").length,
      bothSolved: valid.filter((pair) => pair.ascii.trace.status === "solved" && pair.graph.trace.status === "solved").length,
      neitherSolved: valid.filter((pair) => pair.ascii.trace.status !== "solved" && pair.graph.trace.status !== "solved").length,
    };
  });
}
