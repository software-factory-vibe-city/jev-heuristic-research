import { escapeHtml as e, formatMs, table } from "../../report/html.js";
import { summarizeSamples } from "../maze-diagnostics/comparison.js";
import { renderCheckpointBoard } from "../maze-diagnostics/render.js";
import { armLabels, arms, contrasts } from "./arms.js";
import { hypothesisPairs } from "./comparison.js";
import type { HypothesisResult, HypothesisSample } from "./experiment.js";

const pct = (value: number | null) => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
function score(samples: HypothesisSample[]) {
  const summary = summarizeSamples(samples);
  return `${summary.correct} / ${summary.valid}<br><span class="note">P(correct) ${pct(summary.meanCorrectProbability)} · ${summary.errors} errors</span>`;
}
function ruleScore(samples: HypothesisSample[]) {
  const valid = samples.filter((sample) => sample.status === "ok");
  return `${valid.filter((sample) => sample.ruleAgrees).length} / ${valid.length}`;
}

export function renderHypotheses(result: HypothesisResult): string {
  const providers = result.protocol.providers.map((provider) => provider.id);
  const pairs = hypothesisPairs(result);
  const errors = result.samples.filter((sample) => sample.status === "error").length;
  return `<div class="hero"><div><div class="eyebrow">Experiment 004 / action-selection hypotheses</div><h1>Facts, memory,<br>or strategy?</h1><p class="lede">Three controlled changes to the same frozen decisions. No coordinates, movement rollouts, or hidden rescue.</p></div>
    <div class="callout"><div class="eyebrow">Four arms · three contrasts</div><p>Fresh control → explicit candidate facts → remove the trajectory. A fourth arm keeps facts and history but supplies an exact exploration rule.</p><p class="note">The same rule is also implemented in code. Following a supplied heuristic is not evidence of inventing one.</p></div></div>
    <div class="summary"><div><strong>${result.cases.length}</strong><span>frozen checkpoints</span></div><div><strong>${result.protocol.options.trials}</strong><span>repeats per arm</span></div><div><strong>${result.samples.length}</strong><span>model requests</span></div><div><strong>${errors}</strong><span>errors, not wrong answers</span></div></div>
    <section><h2>Shortest-action accuracy</h2>${table(["Provider", ...arms.map((arm) => armLabels[arm]), "Rule-arm adherence"], providers.map((provider) => [e(provider),
      ...arms.map((arm) => score(result.samples.filter((sample) => sample.solver === provider && sample.arm === arm))),
      ruleScore(result.samples.filter((sample) => sample.solver === provider && sample.arm === "rule")),
    ]))}<p class="note">Accuracy means choosing a shortest-route next node, not completing a maze. P(correct) is evaluator-correct probability mass, not API confidence. Errors are excluded from denominators. Rule adherence is measured separately from shortest-path correctness.</p>
    <p><strong>Code-only rule reference: ${result.cases.filter((checkpoint) => checkpoint.codeReference.correct).length} / ${result.cases.length} shortest actions.</strong> Evaluated once per checkpoint, not multiplied by repeats. It does not use a shortest-path solver and need not be optimal on other states; its opaque-ID tie-break is arbitrary.</p></section>
    <section><h2>Matched hypothesis comparisons</h2>${table(["Provider / hypothesis", "Comparison", "Δ P(correct)", "Control-only / treatment-only / error pairs"], providers.flatMap((provider) => contrasts.map((contrast) => {
      const matched = pairs.filter((pair) => pair.control.solver === provider && pair.contrast.id === contrast.id);
      const valid = matched.filter((pair) => pair.valid);
      const delta = valid.length ? valid.reduce((sum, pair) => sum + pair.probabilityDelta!, 0) / valid.length : null;
      return [`${e(provider)} / ${e(contrast.id)} · ${e(contrast.title)}`, `${e(armLabels[contrast.control])} → ${e(armLabels[contrast.treatment])}`,
        delta === null ? "—" : `${delta >= 0 ? "+" : ""}${(delta * 100).toFixed(1)} pp`,
        `${matched.filter((pair) => pair.outcome === "control-only").length} / ${matched.filter((pair) => pair.outcome === "treatment-only").length} / ${matched.filter((pair) => !pair.valid).length}`];
    })))}<p class="note">Only complete, error-free checkpoint/provider/trial pairs contribute to deltas and directional wins. Repeated requests on related checkpoints are not independent tasks. <a href="result.json">Raw inputs, outputs, and grading ↗</a></p>
    ${contrasts.map((contrast) => `<p><strong>${e(contrast.id)} / ${e(contrast.title)}:</strong> ${e(contrast.change)}</p>`).join("")}</section>
    ${result.cases.map((checkpoint) => `<section><div class="section-heading"><div><h2>${e(checkpoint.title)}</h2><p>${e(checkpoint.description)}</p><p class="note">Shortest-route answer(s): ${e(checkpoint.expectedAction.join(", "))} · code rule: ${e(checkpoint.codeReference.action)} (${checkpoint.codeReference.correct ? "shortest" : "not shortest"})</p></div></div>
      <div class="reference-card">${renderCheckpointBoard(checkpoint)}</div><p class="note">Human-only reconstruction. Models receive coordinate-free JSON, not this picture.</p>
      ${table(["Provider", ...arms.map((arm) => armLabels[arm]), "Rule-arm adherence"], providers.map((provider) => [e(provider),
        ...arms.map((arm) => score(result.samples.filter((sample) => sample.checkpoint === checkpoint.id && sample.solver === provider && sample.arm === arm))),
        ruleScore(result.samples.filter((sample) => sample.checkpoint === checkpoint.id && sample.solver === provider && sample.arm === "rule")),
      ]))}
      <details><summary>Exact requests and responses · ${e(checkpoint.id)}</summary>${result.samples.filter((sample) => sample.checkpoint === checkpoint.id).map((sample) => `<details class="state-inspector"><summary>${e(sample.solver)} · ${armLabels[sample.arm]} · trial ${sample.trial} · ${sample.status === "error" ? "ERROR" : sample.correct ? "correct" : "incorrect"} · P(correct) ${pct(sample.correctProbability)}</summary>
        <p>Chosen: ${e(sample.decision?.action ?? "—")} · rule agreement: ${sample.ruleAgrees === null ? "—" : String(sample.ruleAgrees)} · ${formatMs(sample.elapsedMs)}${sample.error ? ` · ${e(sample.error)}` : ""}</p>
        <h3>Request</h3><pre>${e(JSON.stringify(sample.decision?.metadata?.request ?? sample.modelStats.failure?.request, null, 2))}</pre>
        <h3>Response</h3><pre>${e(JSON.stringify(sample.decision?.metadata?.answer ?? sample.modelStats.failure?.response ?? null, null, 2))}</pre></details>`).join("")}</details></section>`).join("")}
    <section><details><summary>Protocol & interpretation limits</summary>
      <p>These six checkpoints and this label assignment are reused from the earlier diagnostic study. All arms have the same graph, goal, legal destinations, ID ordering, and visit counts. No coordinates, compass labels, distances, optimal actions, or model-generated factual answers are passed in.</p>
      <p>H1 adds correct, deterministic facts alongside every candidate: visits, previous-position flag, degree, and the degree-one dead-end predicate. It offloads factual extraction to code but supplies no preferred action or ordering by promise. Token length changes; this is a fact-scaffolding intervention, not a pure typography test.</p>
      <p>H2 removes chronological transitions while keeping the full graph, arrival counts, and last-position information in candidate flags. This is not lossless history compression and does not remove all memory. H1/H2 share one action question whose wording refers to supplied movement memory, not a required full trajectory. The fresh control uses that question too; do not attribute differences from historical diagnostics to the new intervention alone.</p>
      <p>H3 changes only the question relative to the facts arm. The explicit rule excludes the immediately previous node when alternatives exist, then minimizes visits, then breaks ties by node ID. Code applies exactly the same rule independently. This tests executing supplied policy, not inventing it. Rule agreement and goal-optimal action are distinct measurements, even when they coincide on these checkpoints.</p>
      <p>Oracle action labels are calculated outside model inputs. Each sample is one independent SDK request with no answer feedback or retries. No model decision is overridden. API failures are retained as errors. Repeats may be deterministic and do not replace independent maps, label permutations, or held-out tests. All current mazes are simple paths; no claim of general navigation ability follows.</p>
      <pre>${e(JSON.stringify(result.protocol, null, 2))}</pre></details></section>`;
}
