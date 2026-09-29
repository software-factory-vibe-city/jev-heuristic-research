import { badge, escapeHtml as e, formatMs, replay, table } from "../../report/html.js";
import { moves, positionKey } from "./domain.js";
import type { Maze, Position } from "./domain.js";
import type { MazeCaseResult, MazeResult, MazeRun } from "./experiment.js";
import { representationLabels } from "./representations.js";

export function renderMazeBoard(maze: Maze, run: MazeRun, frame: number): string {
  const cell = 32;
  const trail = [run.trace.initial, ...run.trace.steps.slice(0, frame).map((step) => step.after)];
  const current = trail.at(-1)!;
  const expanded = new Set(run.expanded.map(positionKey));
  const center = (p: Position) => `${p.x * cell + cell / 2},${p.y * cell + cell / 2}`;
  const tiles = maze.rows.flatMap((row, y) => [...row].map((value, x) => {
    const kind = value === "#" ? "wall" : expanded.has(positionKey({ x, y })) ? "expanded" : "floor";
    return `<rect class="${kind} grid" x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`;
  })).join("");
  return `<svg class="board" viewBox="0 0 ${maze.rows[0]!.length * cell} ${maze.rows.length * cell}" role="img" aria-label="Maze at step ${frame}; position ${current.x}, ${current.y}">
    ${tiles}<polyline class="trail" points="${trail.map(center).join(" ")}"/>
    <text class="cell-label" x="${maze.start.x * cell + 16}" y="${maze.start.y * cell + 16}">S</text>
    <rect class="goal" x="${maze.goal.x * cell + 5}" y="${maze.goal.y * cell + 5}" width="22" height="22" rx="4"/>
    <text class="goal-label" x="${maze.goal.x * cell + 16}" y="${maze.goal.y * cell + 16}">G</text>
    <circle class="agent" cx="${current.x * cell + 16}" cy="${current.y * cell + 16}" r="8"/>
  </svg>`;
}

export function renderRun(item: MazeCaseResult, run: MazeRun, inspectState = false, extraMetrics: readonly (readonly [string, string])[] = []): string {
  const frames = Array.from({ length: run.trace.steps.length + 1 }, (_, index) => {
    const step = run.trace.steps[index - 1];
    const answer = step?.metadata?.answer as { choice?: string; confidence: number; probabilities: Record<string, number> } | undefined;
    const forced = step?.metadata?.source === "forced";
    const codeRule = step?.metadata?.source === "code-rule";
    const caption = step ? `${step.action} ${step.valid ? "→" : "× wall"} (${step.after.x}, ${step.after.y})${forced ? " · forced" : codeRule ? " · code rule" : ""}` : "S₀ / initial state";
    const labels = answer ? [...moves.filter((move) => Object.hasOwn(answer.probabilities, move)),
      ...Object.keys(answer.probabilities).filter((label) => !(moves as readonly string[]).includes(label)).sort()] : [];
    const probabilities = answer ? `<div class="probabilities">${labels.map((label) => {
      const p = answer.probabilities[label]!;
      const direction = (step?.metadata?.destinationMoves as Record<string, string> | undefined)?.[label];
      return `<div class="probability ${(answer.choice ?? step?.action) === label ? "selected" : ""}">${e(label)}${direction ? ` → ${e(direction)}` : ""}<i><b style="width:${(p * 100).toFixed(1)}%"></b></i>${(p * 100).toFixed(0)}%</div>`;
    }).join("")}</div>` : `<div class="probabilities note">${run.solver === "astar" ? "Shading: states expanded during A* planning." : forced ? "Forced move · only legal direction; no model call." : codeRule ? "Code rule · no model call." : "Probabilities are shown only for model decisions."}</div>`;
    const request = index === 0
      ? (run.trace.steps.length ? run.trace.steps[0]?.metadata?.request : run.modelStats?.failure?.request)
      : step?.metadata?.request;
    const inspection = !inspectState ? "" : request
      ? `<details class="state-inspector"><summary>${index ? `Model input before move ${index}` : "Model input for first decision"}</summary><pre>${e(JSON.stringify(request, null, 2))}</pre></details>`
      : forced || codeRule ? `<details class="state-inspector"><summary>${forced ? "Forced move" : "Code rule decision"} (no model request)</summary><pre>${e(JSON.stringify(step!.metadata, null, 2))}</pre></details>` : "";
    const audit = step?.metadata?.ruleAudit as { expectedDestination: string; agrees: boolean; forced: boolean } | undefined;
    const auditMarkup = audit ? `<p class="note">Post-run rule audit: expected ${e(audit.expectedDestination)} · ${audit.agrees ? "match" : "VIOLATION"}${audit.forced ? " · forced, excluded from compliance score" : ""}</p>` : "";
    return `${renderMazeBoard(item.maze, run, index)}<div class="frame-caption"><span class="mono">${e(caption)}</span><span class="note">${answer ? `confidence ${(answer.confidence * 100).toFixed(0)}% · ` : ""}${step ? formatMs(step.decisionMs) : ""}</span></div>${probabilities}${auditMarkup}${inspection}`;
  });
  const metrics = [
    ["moves / optimal", `${run.metrics.moves} / ${item.optimalMoves}`],
    ["total time", formatMs(run.trace.elapsedMs)],
    ["model calls", String(run.metrics.modelCalls)],
    ["forced moves", String(run.metrics.forcedMoves ?? 0)],
    ["revisits", String(run.metrics.revisits)],
    ["invalid moves", String(run.metrics.invalidMoves)],
    ["efficiency", run.metrics.efficiency === null ? "—" : `${(run.metrics.efficiency * 100).toFixed(0)}%`],
    ...extraMetrics,
  ];
  return `<article class="card"><div class="card-head"><div><span class="eyebrow">${inspectState && run.representation ? `${representationLabels[run.representation]} · ` : ""}Trial ${run.trial}</span><h3>${e(run.label)}</h3></div>${badge(run.trace.status)}</div>
    ${replay(frames)}<dl class="metrics">${metrics.map(([label, value]) => `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`).join("")}</dl>
    ${run.trace.error ? `<p class="error-message">${e(run.trace.error)}</p>` : ""}</article>`;
}

export function renderMaze(result: MazeResult): string {
  const runs = result.cases.flatMap((item) => item.runs);
  const solved = runs.filter((run) => run.trace.status === "solved").length;
  const modelCalls = runs.reduce((sum, run) => sum + run.metrics.modelCalls, 0);
  return `<div class="hero"><div><div class="eyebrow">Experiment 001 / navigation</div><h1>One maze.<br>Different instincts.</h1><p class="lede">A hand-written search heuristic meets a learned next-move policy. Same map. Same moves. Different ways of getting there.</p></div>
    <div class="callout"><div class="eyebrow">Working hypothesis</div><p>A System One model amortizes the creation of task-specific semantic heuristics across arbitrary problem domains.</p><p class="note">This is a first probe, not evidence of cross-domain generalization.</p></div></div>
    <div class="summary"><div><strong>${result.cases.length}</strong><span>fixed ASCII mazes</span></div><div><strong>${solved} / ${runs.length}</strong><span>runs reached the goal</span></div><div><strong>${modelCalls}</strong><span>model calls, including failed attempts</span></div><div><strong>${result.protocol.actionSpace === "legal-only" ? "Legal moves" : "4 actions"}</strong><span>up · right · down · left</span></div></div>
    <p class="note">Orange dot = current position · green line = traveled path · G = goal. Scrub each trace independently. Playback follows moves, not wall-clock time. <a href="result.json">Download raw run + requests ↗</a></p>
    ${result.cases.map((item) => `<section><div class="section-heading"><div><h2>${e(item.title)}</h2><p class="note">${e(item.description)}</p></div><div class="mono note">${item.optimalMoves} optimal moves<br>${item.maxSteps} attempt budget</div></div><div class="cards">${item.runs.map((run) => renderRun(item, run)).join("")}</div></section>`).join("")}
    <section><div class="section-heading"><div><div class="eyebrow">Observations</div><h2>The measurement ledger</h2></div></div>
    ${table(["Maze / trial", "Solver", "Outcome", "Moves", "Invalid", "Revisits", "Efficiency", "Elapsed", "Calls", "Forced", "A* expansions", "Tokens in / out"], result.cases.flatMap((item) => item.runs.map((run) => [
      `${e(item.id)} / ${run.trial}`, e(run.label), badge(run.trace.status), `${run.metrics.moves} / ${item.optimalMoves}`, String(run.metrics.invalidMoves), String(run.metrics.revisits),
      run.metrics.efficiency === null ? "—" : `${(run.metrics.efficiency * 100).toFixed(0)}%`, formatMs(run.trace.elapsedMs), String(run.metrics.modelCalls), String(run.metrics.forcedMoves ?? 0), String(run.metrics.expandedStates ?? "—"),
      run.modelStats?.usageReported ? `${run.modelStats.inputTokens} / ${run.modelStats.outputTokens}` : "—",
    ])))}
    <p class="note" style="margin-top:12px">Efficiency = optimal moves / all attempted moves, only when solved. Invalid actions consume budget; revisits count valid moves onto previously occupied cells. “—” is not measured or not applicable, not zero.</p></section>
    <section><details><summary>Protocol & limitations</summary>
    <p>All solvers receive the same fully observable, static, unit-cost, four-neighbor maze. A* plans once with Manhattan distance and executes its path. The models choose one move per call from ${result.protocol.actionSpace === "legal-only" ? "only the legal directions at the current cell (including necessary backtracking)" : "all four directions"}, with the full ASCII map, coordinates, legal moves, and complete movement history. ${result.protocol.singleLegalMove === "forced" ? "If only one legal direction exists, code executes it without a model call, including at dead ends. These forced moves are explicitly logged, count against the attempt budget, and remain in subsequent history. This rule is identical for local and hosted models. " : ""}No search scores, oracle path, loop pruning, or search fallback are supplied. This tests a <em>reactive policy</em>, not a learned admissible A* heuristic.</p>
    <p>Each run stops at the goal or its attempt budget (default: 4 × optimal path length). Repeated states do not terminate a run because backtracking can be useful. A* expansions exclude the goal pop. Timing includes planning or model round trips and transition execution, excludes the evaluation oracle and rendering, and includes cold-start/network effects. Calls are sequential, solver order reverses on even trials, and SDK retries are disabled.</p>
    <p>Three hand-authored mazes are a sanity check, not a benchmark. Model confidence is reported, not treated as correctness. Hosted and local latency, training cost, and hardware are not directly comparable. Repeated trials do not guarantee independent samples. Model aliases may change; returned model IDs, prompts, responses, fixtures, runtime, and source fingerprint are preserved in the JSON artifact. Next: held-out generated mazes, representation ablations, and other domains.</p>
    <pre>${e(JSON.stringify(result.protocol, null, 2))}</pre></details></section>`;
}
