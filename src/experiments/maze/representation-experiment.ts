import { defineExperiment } from "../../core/experiment.js";
import { badge, escapeHtml as e, formatMs, table } from "../../report/html.js";
import { representationPairs, representationSummary } from "./comparison.js";
import { runMaze } from "./experiment.js";
import type { MazeResult, MazeRun } from "./experiment.js";
import { renderRun } from "./render.js";

export function renderRepresentationExperiment(result: MazeResult): string {
  const pairs = representationPairs(result);
  const summary = representationSummary(result);
  const runs = pairs.flatMap((pair) => [pair.ascii, pair.graph]);
  const calls = runs.reduce((sum, run) => sum + run.metrics.modelCalls, 0);
  const outcome = (run: MazeRun) => `${badge(run.trace.status)}<br>${run.trace.steps.length} attempts · ${run.metrics.revisits} revisits · ${run.metrics.forcedMoves ?? 0} forced`;
  return `<div class="hero"><div><div class="eyebrow">Experiment 002 / representation ablation</div><h1>Same world.<br>Different description.</h1><p class="lede">ASCII cells or explicit connections? Change the map encoding, not the next-move controller.</p></div>
    <div class="callout"><div class="eyebrow">One variable</div><p>Does exposing adjacency help a System One model navigate without search or a hand-written route heuristic?</p><p class="note">Both arms share the same question, coordinates, history, visit counts, action space, and attempt budget.</p></div></div>
    <div class="summary"><div><strong>${result.cases.length}</strong><span>identical mazes in each arm</span></div><div><strong>${pairs.length}</strong><span>paired model rollouts</span></div><div><strong>${runs.filter((run) => run.trace.status === "solved").length} / ${runs.length}</strong><span>model runs reached the goal (excludes A*)</span></div><div><strong>${calls}</strong><span>model calls, including failures</span></div></div>
    <section><div class="section-heading"><div><div class="eyebrow">Paired outcomes</div><h2>Does the encoding change the outcome?</h2></div><a class="note" href="result.json">Raw traces + exact inputs ↗</a></div>
    ${summary.length ? table(["Provider", "ASCII solved", "Graph solved", "Graph only", "ASCII only", "Both solved", "Neither solved", "Error pairs"], summary.map((row) => [
      e(row.solver), `${row.asciiSolved} / ${row.pairs}`, `${row.graphSolved} / ${row.pairs}`, String(row.graphOnly), String(row.asciiOnly), String(row.bothSolved), String(row.neitherSolved), String(row.errorPairs),
    ])) : '<p class="note">No model arms requested; only A* references were run.</p>'}
    <p class="note" style="margin-top:12px">A pair is one case × provider × trial. “Only” and “neither” counts exclude pairs with errors. These are descriptive counts on three hand-authored fixtures, not a significance test.</p></section>
    <p class="note">The same grid visualizes both traces below; the graph arm receives JSON, not a picture. Open a frame’s model-input inspector to see the actual request. Playback follows moves, not elapsed time.</p>
    ${result.cases.map((item) => `<section><div class="section-heading"><div><h2>${e(item.title)}</h2><p class="note">${e(item.description)}</p></div><div class="mono note">${item.optimalMoves} optimal moves<br>${item.maxSteps} attempts per arm</div></div>
      ${pairs.filter((pair) => pair.caseId === item.id).map((pair) => `<div class="representation-pair" data-pair="${e(pair.solver)}-${pair.trial}"><div class="cards">${renderRun(item, pair.ascii, true)}${renderRun(item, pair.graph, true)}</div></div>`).join("")}
      ${item.runs.filter((run) => run.solver === "astar").map((run) => `<details class="reference"><summary>A* reference · trial ${run.trial} · ${run.trace.status === "solved" ? `${run.metrics.moves} moves` : e(run.trace.status)} · ${run.metrics.expandedStates} expansions</summary><div class="reference-card">${renderRun(item, run)}</div></details>`).join("")}
    </section>`).join("")}
    <section><h2>Paired measurement ledger</h2>${table(["Case / provider / trial", "ASCII", "Graph", "ASCII / graph time", "ASCII / graph input tokens"], pairs.map((pair) => [
      `${e(pair.caseId)} / ${e(pair.solver)} / ${pair.trial}`, outcome(pair.ascii), outcome(pair.graph), `${formatMs(pair.ascii.trace.elapsedMs)} / ${formatMs(pair.graph.trace.elapsedMs)}`,
      `${pair.ascii.modelStats?.usageReported ? pair.ascii.modelStats.inputTokens : "—"} / ${pair.graph.modelStats?.usageReported ? pair.graph.modelStats.inputTokens : "—"}`,
    ]))}</section>
    <section><details><summary>Protocol, controls & limitations</summary>
    <p>The only between-arm input difference is <code>state.map</code>: an ASCII grid and its legend, or a row-major list of every open cell with coordinates and directional edges. Graph edges are exactly legal one-step transitions. Bounds make omitted cells reconstructible as walls. There are no distance-to-goal scores, goal-based sorting, reachable-subgraph filtering, or removed dead ends.</p>
    <p>Both arms receive identical shared fields for a given position/history: dimensions, start/current/goal coordinates, legal moves, full history, and per-cell arrival counts. Counts include the initial cell once and valid arrivals only. They summarize information already in history; they do not prune revisits. ${result.protocol.actionSpace === "legal-only" ? "Only legal directions at the current cell are answer options. Previously used edges remain available for backtracking; history affects instructions, not action filtering." : "All four directions remain answer options, so invalid moves still consume budget."} ${result.protocol.singleLegalMove === "forced" ? "A sole legal move is executed by code, explicitly logged as forced, and included in the budget and subsequent history; no model request or probabilities are fabricated. This rule applies equally to both providers and encodings." : "Even a single legal option is sent to the model."}</p>
    <p>This experiment uses a shared representation-neutral prompt and exposes visit counts to <em>both</em> arms. The ASCII control is rerun here. Compare encodings within the same policy version: v2 restricts choices to legal moves and strengthens history instructions; v3 keeps those inputs but executes singleton choices as forced moves. Differences from historical versions are not solely encoding effects. Historical artifacts are preserved. Within this experiment, the question, action descriptions, provider settings, controller, and per-case budgets are fixed. Histories naturally diverge once actions differ: these are paired rollouts, not identical-state judgments at every step.</p>
    <p>Every arm starts fresh at S₀ and stops at the goal, an error, or the same attempt budget (default 4 × optimal path length). A* is evaluated once per case/trial as a reference, never exposed to the model. No search fallback, history-based action pruning, retries, or cross-arm memory. Backtracking is automatic only when the sole-legal-move rule applies. Execution is sequential; representation order alternates across cases/trials, and provider order reverses on even trials. The JSON preserves actual execution order.</p>
    <p>Graph inputs are longer; token count and latency are not held constant. Timing includes encoding and network/cold-start effects, so it is not a pure inference-speed comparison. Errors are reported separately, not counted as evidence favoring an encoding. Three fixed mazes cannot establish generalization, and repeated trials need not be independent. A useful next test would freeze this protocol and evaluate unseen mazes.</p>
    <pre>${e(JSON.stringify(result.protocol, null, 2))}</pre></details></section>`;
}

export const mazeRepresentationExperiment = defineExperiment({
  id: "maze-representation",
  title: "Maze · ASCII vs adjacency graph",
  run: (options) => runMaze(options, "representation"),
  render: renderRepresentationExperiment,
});
