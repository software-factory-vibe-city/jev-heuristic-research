import type { RuleRun } from "../maze-rule/experiment.js";
import type { GeneratedCase } from "./experiment.js";

export function summarizeGenerated(cases: readonly GeneratedCase[], solver: string) {
  const entries = cases.flatMap((item) => item.runs.filter((run) => run.solver === solver).map((run) => ({ item, run })));
  const runs = entries.map(({ run }) => run);
  const sum = (key: keyof RuleRun["metrics"]) => runs.reduce((total, run) => total + (run.metrics[key] ?? 0), 0);
  const solved = entries.filter(({ run }) => run.trace.status === "solved");
  const requests = runs.flatMap((run) => [...run.trace.steps.flatMap((step) => step.metadata?.request ? [step.metadata.request] : []),
    ...(run.modelStats?.failure ? [run.modelStats.failure.request] : [])]);
  return { solver, layouts: new Set(entries.map(({ item }) => item.layoutId)).size, runs: runs.length,
    solved: solved.length, exhausted: runs.filter((run) => run.trace.status === "budget-exhausted").length,
    errors: runs.filter((run) => run.trace.status === "error").length, stopped: runs.filter((run) => run.trace.status === "stopped").length,
    calls: sum("modelCalls"), forced: sum("forcedMoves"), ruleChecks: sum("ruleChecks"), ruleMatches: sum("ruleMatches"),
    junctionChecks: sum("junctionChecks"), junctionMatches: sum("junctionMatches"), tieChecks: sum("tieChecks"), tieMatches: sum("tieMatches"),
    revisits: sum("revisits"),
    meanSolvedStretch: solved.length ? solved.reduce((total, { item, run }) => total + run.trace.steps.length / item.optimalMoves, 0) / solved.length : null,
    maxRequestBytes: requests.reduce<number>((max, request) => Math.max(max, Buffer.byteLength(JSON.stringify(request))), 0),
  };
}

/** Match exactly the same layout, encoding, and trial. Errors never become directional wins. */
export function compareWithCode(cases: readonly GeneratedCase[], solver: string) {
  const result = { solver, pairs: 0, bothSolved: 0, codeOnly: 0, modelOnly: 0, neitherSolved: 0, errorPairs: 0, identicalActions: 0 };
  for (const item of cases) for (const model of item.runs.filter((run) => run.solver === solver)) {
    const code = item.runs.find((run) => run.solver === "rule" && run.trial === model.trial);
    if (!code) continue;
    result.pairs++;
    if (model.trace.status === "error" || code.trace.status === "error") { result.errorPairs++; continue; }
    const a = model.trace.status === "solved", b = code.trace.status === "solved";
    if (a && b) result.bothSolved++;
    else if (b) result.codeOnly++;
    else if (a) result.modelOnly++;
    else result.neitherSolved++;
    if (JSON.stringify(model.trace.steps.map((step) => step.action)) === JSON.stringify(code.trace.steps.map((step) => step.action))) result.identicalActions++;
  }
  return result;
}
