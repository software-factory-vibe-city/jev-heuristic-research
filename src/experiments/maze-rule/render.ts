import { badge, escapeHtml as e, formatMs, table } from "../../report/html.js";
import { renderRun } from "../maze/render.js";
import type { RuleResult, RuleRun } from "./experiment.js";

const adherence = (run: RuleRun) => run.metrics.ruleChecks ? `${run.metrics.ruleMatches} / ${run.metrics.ruleChecks}` : "—";

export function renderRuleExperiment(result: RuleResult): string {
  const allRuns = result.cases.flatMap((item) => item.runs);
  const modelRuns = allRuns.filter((run) => run.solver === "local" || run.solver === "jev");
  return `<div class="hero"><div><div class="eyebrow">Experiment 005 / end-to-end navigation</div><h1>Same rule.<br>Whole journeys.</h1><p class="lede">Do rule-guided model choices compose into a complete route? Every run starts at the entrance and evolves its own history.</p></div>
    <div class="callout"><div class="eyebrow">No silent rescue</div><p>Models receive the same opaque-ID graph, candidate facts, and exploration rule as the frozen-state experiment. All legal moves remain available—even moves that violate the rule.</p><p class="note">Singleton moves are forced, logged, and budgeted. The code rule and A* run independently as references.${result.protocol.memory === "summary" ? " Summary-only amendment: models receive visit counts and previous-position flags, but no chronological history or prompts to consult it." : ""}</p></div></div>
    <div class="summary"><div><strong>${result.cases.length}</strong><span>fixed mazes</span></div><div><strong>${modelRuns.filter((run) => run.trace.status === "solved").length} / ${modelRuns.length}</strong><span>model rollouts solved</span></div><div><strong>${modelRuns.reduce((sum, run) => sum + run.metrics.modelCalls, 0)}</strong><span>model calls, including failures</span></div><div><strong>${modelRuns.reduce((sum, run) => sum + run.metrics.ruleViolations, 0)}</strong><span>model rule violations</span></div></div>
    <section><h2>Completion versus compliance</h2>${table(["Solver", "Solved / runs", "Errors", "Successful non-forced decisions obeying rule", "Calls", "Forced moves"], result.protocol.options.solvers.map((solver) => {
      const runs = allRuns.filter((run) => run.solver === solver);
      const checks = runs.reduce((sum, run) => sum + run.metrics.ruleChecks, 0);
      return [e(runs[0]?.label ?? solver), `${runs.filter((run) => run.trace.status === "solved").length} / ${runs.length}`, String(runs.filter((run) => run.trace.status === "error").length),
        checks ? `${runs.reduce((sum, run) => sum + run.metrics.ruleMatches, 0)} / ${checks}` : "—", String(runs.reduce((sum, run) => sum + run.metrics.modelCalls, 0)), String(runs.reduce((sum, run) => sum + (run.metrics.forcedMoves ?? 0), 0))];
    }))}<p class="note">Compliance counts decisions actually executed, including those in failed or exhausted runs; API failures without an action are not compliance observations. Forced singletons are excluded. Perfect compliance need not imply a shortest route. <a href="result.json">Raw traces, exact requests, and post-run audits ↗</a></p></section>
    ${result.cases.map((item) => `<section><div class="section-heading"><div><h2>${e(item.title)}</h2><p class="note">${e(item.description)} · Model inputs are node-ID JSON, not the grid shown below.</p></div><div class="mono note">${item.optimalMoves} optimal moves<br>${item.maxSteps} attempt budget</div></div>
      ${Array.from({ length: result.protocol.options.trials }, (_, index) => index + 1).map((trial) => `<h3>Trial ${trial}</h3><div class="cards">${item.runs.filter((run) => run.trial === trial).map((run) => renderRun(item, run, true, [
        ["rule agreement", adherence(run)], ["two-step returns", String(run.metrics.twoStepReturns)], ["longest no new cell", String(run.metrics.longestStagnation)],
      ])).join("")}</div>`).join("")}
    </section>`).join("")}
    <section><h2>Full rollout ledger</h2>${table(["Case / trial", "Solver", "Outcome", "Moves / optimal", "Calls", "Forced", "Rule agreement", "Revisits", "Two-step returns", "Longest no new cell", "Elapsed"], result.cases.flatMap((item) => item.runs.map((run) => [
      `${e(item.id)} / ${run.trial}`, e(run.label), badge(run.trace.status), `${run.metrics.moves} / ${item.optimalMoves}`, String(run.metrics.modelCalls), String(run.metrics.forcedMoves ?? 0), adherence(run),
      String(run.metrics.revisits), String(run.metrics.twoStepReturns), String(run.metrics.longestStagnation), formatMs(run.trace.elapsedMs),
    ])))}<p class="note">Two-step returns include necessary backtracking, not just pathological loops. Stagnation is the longest consecutive sequence of attempted moves without discovering a new cell. All attempted transitions, including forced moves, consume budget.</p></section>
    <section><details><summary>Protocol & limitations</summary>
      <p>The exact rule question, seed, node labels, and order are reused from the frozen hypothesis rule arm. ${result.protocol.memory === "summary" ? "The observation retains the graph, candidate facts, visit counts, and previous-position flags but omits chronological history. The rule question already has no history-consulting instructions." : "The full-history candidate-facts observation is unchanged."} State is rebuilt after every actual move; no frozen answers or successful trajectories are supplied. Model destination IDs are mapped to legal compass moves solely for environment execution, with the raw answer and probabilities preserved.</p>
      <p>With one legal destination, both providers and the code rule take a logged forced move without a model call. Otherwise all legal destinations remain choices. No previous-node masking, compliance override, path fallback, loop pruning, or hidden retries. Invalid/out-of-schema model answers or API failures stop that run and preserve evidence.</p>
      <p>The code rule uses exactly the same observations and tie-breaking policy. A* plans separately with Manhattan distance. Neither reference contributes action hints. Optimal lengths set the default budget (4× optimal) and grade efficiency but are not model inputs. Compliance is audited after each rollout against its own actual history, not the code reference's trajectory. Timing excludes this audit, the evaluation oracle, and rendering.</p>
      <p>These are the same three simple path-shaped mazes used during development, not held-out branching/cyclic tasks. One fixed ID assignment may favor the arbitrary lexicographic tie-break. Repeated trials need not be independent. Completion here tests executing a supplied exploration policy, not discovering one or demonstrating general navigation.</p>
      <pre>${e(JSON.stringify(result.protocol, null, 2))}</pre></details></section>`;
}
