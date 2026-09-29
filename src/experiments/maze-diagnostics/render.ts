import { escapeHtml as e, formatMs, table } from "../../report/html.js";
import { positionKey } from "../maze/domain.js";
import { conditionLabels } from "./encoding.js";
import { probeLabels, probes } from "./probes.js";
import { diagnosticPairs, summarizeSamples } from "./comparison.js";
import type { DiagnosticResult, DiagnosticSample } from "./experiment.js";
import type { FrozenCheckpoint } from "./checkpoints.js";
import type { Encoding } from "./encoding.js";

const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
function score(samples: DiagnosticSample[]) {
  const summary = summarizeSamples(samples);
  return `${summary.correct} / ${summary.valid} correct<br><span class="note">P(correct) ${pct(summary.meanCorrectProbability)} · ${summary.errors} errors</span>`;
}
export function renderCheckpointBoard(checkpoint: FrozenCheckpoint & { encoding: Encoding }) {
  const cell = 36;
  const center = (p: { x: number; y: number }) => `${p.x * cell + cell / 2},${p.y * cell + cell / 2}`;
  const path = [checkpoint.maze.start, ...checkpoint.history.map((step) => step.after)];
  return `<svg class="board" viewBox="0 0 ${checkpoint.maze.rows[0]!.length * cell} ${checkpoint.maze.rows.length * cell}" role="img" aria-label="Human-only reconstruction of ${e(checkpoint.id)}">
    ${checkpoint.maze.rows.flatMap((row, y) => [...row].map((value, x) => `<rect class="${value === "#" ? "wall" : "floor"} grid" x="${x * cell}" y="${y * cell}" width="${cell}" height="${cell}"/>`)).join("")}
    <polyline class="trail" points="${path.map(center).join(" ")}"/>
    <rect class="goal" x="${checkpoint.maze.goal.x * cell + 3}" y="${checkpoint.maze.goal.y * cell + 3}" width="30" height="30" rx="4"/>
    <circle class="agent" cx="${checkpoint.current.x * cell + 18}" cy="${checkpoint.current.y * cell + 18}" r="14"/>
    ${checkpoint.encoding.nodes.map((node) => `<text x="${node.position.x * cell + 18}" y="${node.position.y * cell + 21}" text-anchor="middle" style="font:10px ui-monospace,monospace">${e(node.id)}</text>`).join("")}
  </svg>`;
}

export function renderDiagnostics(result: DiagnosticResult): string {
  const pairs = diagnosticPairs(result);
  const errors = result.samples.filter((sample) => sample.status === "error").length;
  const providers = result.protocol.providers.map((provider) => provider.id);
  const aggregate = providers.flatMap((provider) => probes.map((probe) => {
    const samples = result.samples.filter((sample) => sample.solver === provider && sample.probe === probe);
    const matched = pairs.filter((pair) => pair.coordinates.solver === provider && pair.coordinates.probe === probe);
    const valid = matched.filter((pair) => pair.valid);
    const delta = valid.length ? valid.reduce((sum, pair) => sum + pair.probabilityDelta!, 0) / valid.length : null;
    return [e(provider), e(probeLabels[probe]), score(samples.filter((sample) => sample.condition === "coordinates")), score(samples.filter((sample) => sample.condition === "topology")),
      delta === null ? "—" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pp`,
      `${matched.filter((pair) => pair.outcome === "coordinates-only").length} / ${matched.filter((pair) => pair.outcome === "topology-only").length} / ${matched.filter((pair) => !pair.valid).length}`];
  }));
  return `<div class="hero"><div><div class="eyebrow">Experiment 003 / frozen-state diagnostics</div><h1>Same connections.<br>Less geometry.</h1><p class="lede">Does removing coordinates change factual recognition or the next action? No movement rollouts; every question sees a frozen state.</p></div>
    <div class="callout"><div class="eyebrow">One between-arm difference</div><p>Both arms use identical arbitrary node IDs, edges, destination choices, history, visit counts, and questions. Only node coordinates are added or removed.</p><p class="note">Each factual question and action question is a separate request. Answers never coach later questions.</p></div></div>
    <div class="summary"><div><strong>${result.cases.length}</strong><span>frozen checkpoints</span></div><div><strong>${result.protocol.options.trials}</strong><span>repeats per condition</span></div><div><strong>${result.samples.length}</strong><span>requests across both arms</span></div><div><strong>${errors}</strong><span>errors, excluded from accuracy</span></div></div>
    <section><h2>Recognition versus action</h2>${table(["Provider", "Probe", "With coordinates", "Without coordinates", "Δ P(correct), without − with", "With-only / without-only / error pairs"], aggregate)}
    <p class="note">P(correct) is probability mass assigned to evaluator-correct labels, not the API confidence field. Accuracy denominators exclude errors. Probability deltas use complete, error-free pairs only; errors are not evidence for either arm. Repeated calls and related checkpoints are not independent benchmark tasks. <a href="result.json">Raw requests, answers, and grading ↗</a></p></section>
    ${result.cases.map((checkpoint) => `<section><div class="section-heading"><div><h2>${e(checkpoint.title)}</h2><p>${e(checkpoint.description)}</p><p class="note">${checkpoint.history.length} prior moves · current ${e(checkpoint.encoding.byPosition[positionKey(checkpoint.current)])} · goal ${e(checkpoint.encoding.byPosition[positionKey(checkpoint.maze.goal)])}</p></div></div>
      <div class="reference-card">${renderCheckpointBoard(checkpoint)}</div><p class="note">Human-only reconstruction: orange = current, green = goal, line = history. Neither model receives this picture.</p>
      ${table(["Provider / probe", "Evaluator answer(s)", "With coordinates", "Without coordinates"], providers.flatMap((provider) => probes.map((probe) => {
        const samples = result.samples.filter((sample) => sample.checkpoint === checkpoint.id && sample.solver === provider && sample.probe === probe);
        return [`${e(provider)} / ${e(probeLabels[probe])}`, e(checkpoint.expected[probe].join(", ")), score(samples.filter((sample) => sample.condition === "coordinates")), score(samples.filter((sample) => sample.condition === "topology"))];
      })))}
      <details><summary>Exact requests and responses · ${e(checkpoint.id)}</summary>${result.samples.filter((sample) => sample.checkpoint === checkpoint.id).map((sample) => {
        const request = sample.decision?.metadata?.request ?? sample.modelStats.failure?.request;
        const answer = sample.decision?.metadata?.answer ?? sample.modelStats.failure?.response;
        return `<details class="state-inspector"><summary>${e(sample.solver)} · ${e(probeLabels[sample.probe])} · ${conditionLabels[sample.condition]} · trial ${sample.trial} · ${sample.status === "error" ? "ERROR" : sample.correct ? "correct" : "incorrect"} · P(correct) ${pct(sample.correctProbability)}</summary>
          <p>Chosen: ${e(sample.decision?.action ?? "—")} · ${formatMs(sample.elapsedMs)}${sample.error ? ` · ${e(sample.error)}` : ""}</p><h3>Request</h3><pre>${e(JSON.stringify(request, null, 2))}</pre><h3>Response</h3><pre>${e(JSON.stringify(answer ?? null, null, 2))}</pre></details>`;
      }).join("")}</details></section>`).join("")}
    <section><details><summary>Protocol & limitations</summary>
      <p>Checkpoints were selected from earlier v3 failures before running this study. Valid action prefixes reconstruct positions/history without depending on report files. This is a targeted diagnostic, not a held-out success benchmark.</p>
      <p>Node IDs are seeded random assignments; node order is independently shuffled. Neighbor lists and criteria use opaque-ID order rather than compass order. The no-coordinate arm has no grid, dimensions, coordinate IDs, compass action labels, or directional history. Labels and orders remain fixed across arms and repeats. A single label assignment cannot establish robustness to naming or ordering.</p>
      <p>Previous-node, unvisited-neighbor, dead-end-neighbor, and action probes are separate stateless SDK calls. Factual probes include none and, where applicable, multiple. The dead-end definition is exactly one neighbor, not a computed route-quality label. Action choices contain only legal destination IDs. Every checkpoint has at least two legal destinations; no forced moves or fallback occur.</p>
      <p>Evaluator answers are kept outside requests. Action correctness means choosing a neighbor with minimum actual remaining path length, computed offline by BFS; all tied best neighbors count. No distance, answer, or search score is supplied to either model. All checkpoints still come from the three simple path-shaped fixtures.</p>
      <p>Trials repeat identical requests to expose variation; they are not independent maps. Coordinate removal also changes token length. This new node-ID interface and action prompt differ from v3 navigation: compare the matched arms here, not their headline accuracy against old rollout success. A negative coordinate-ablation result does not by itself rule out geometric bias; abstract graph reading may be harder.</p>
      <pre>${e(JSON.stringify(result.protocol, null, 2))}</pre></details></section>`;
}
