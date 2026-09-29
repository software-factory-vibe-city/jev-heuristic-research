import { badge, escapeHtml as e, formatMs } from "../../report/html.js";
import { renderMazeBoard } from "../maze/render.js";
import type { RuleCaseResult, RuleRun } from "./experiment.js";

/** One SVG per run, not per step. Trace JSON is parsed only when that replay is first used. */
export function renderCompactRun(item: RuleCaseResult, run: RuleRun): string {
  const json = JSON.stringify({ initial: run.trace.initial, steps: run.trace.steps }).replaceAll("<", "\\u003c");
  const metrics = [
    ["moves / optimal", `${run.metrics.moves} / ${item.optimalMoves}`], ["total time", formatMs(run.trace.elapsedMs)],
    ["model calls", String(run.metrics.modelCalls)], ["forced moves", String(run.metrics.forcedMoves ?? 0)],
    ["revisits", String(run.metrics.revisits)], ["rule agreement", run.metrics.ruleChecks ? `${run.metrics.ruleMatches} / ${run.metrics.ruleChecks}` : "—"],
    ["junction agreement", run.metrics.junctionChecks ? `${run.metrics.junctionMatches} / ${run.metrics.junctionChecks}` : "—"],
    ["two-step returns", String(run.metrics.twoStepReturns)], ["longest no new cell", String(run.metrics.longestStagnation)],
  ];
  return `<article class="card" data-maze-replay><div class="card-head"><div><span class="eyebrow">Trial ${run.trial}</span><h3>${e(run.label)}</h3></div>${badge(run.trace.status)}</div>
    ${renderMazeBoard(item.maze, run, 0)}<div class="frame-caption"><span class="mono" data-caption>S₀ / initial state</span><span class="note" data-timing></span></div>
    <div class="probabilities note" data-probabilities>${run.solver === "astar" ? "Shading: states expanded during A* planning." : "Scrub a move to inspect the recorded decision."}</div>
    <p class="note" data-audit></p><details class="state-inspector" data-inspector hidden><summary></summary><pre></pre></details>
    <div class="controls"><button type="button" data-reset aria-label="Reset replay">↺</button><button type="button" data-play aria-label="Play replay" ${run.trace.steps.length ? "" : "disabled"}>Play</button><input type="range" min="0" max="${run.trace.steps.length}" value="0" aria-label="Replay step"><output>0 / ${run.trace.steps.length}</output></div>
    <dl class="metrics">${metrics.map(([label, value]) => `<div><dt>${e(label!)}</dt><dd>${e(value!)}</dd></div>`).join("")}</dl>
    ${run.trace.error ? `<p class="error-message">${e(run.trace.error)}</p>` : ""}
    ${run.modelStats?.failure ? `<details class="state-inspector"><summary>Failed model request (no move executed)</summary><pre>${e(JSON.stringify(run.modelStats.failure, null, 2))}</pre></details>` : ""}
    <script type="application/json" data-trace>${json}</script></article>`;
}

// This is only presentation: no model requests, grading, or domain transitions occur in the browser.
export const compactReplayScript = `
for (const player of document.querySelectorAll('[data-maze-replay]')) {
  const slider = player.querySelector('input[type=range]'), play = player.querySelector('[data-play]');
  const board = player.querySelector('svg'), probabilities = player.querySelector('[data-probabilities]');
  const inspector = player.querySelector('[data-inspector]');
  const initialNote = probabilities.textContent;
  let data, timer, index = 0;
  const load = () => data ??= JSON.parse(player.querySelector('[data-trace]').textContent);
  const pause = () => { clearInterval(timer); timer = undefined; play.textContent = 'Play'; play.setAttribute('aria-label', 'Play replay'); };
  const show = (next) => {
    const trace = load(); index = next;
    const step = trace.steps[index - 1], meta = step?.metadata, answer = meta?.answer;
    const position = step?.after ?? trace.initial;
    const points = [trace.initial, ...trace.steps.slice(0, index).map(step => step.after)];
    board.querySelector('.trail').setAttribute('points', points.map(p => (p.x*32+16)+','+(p.y*32+16)).join(' '));
    board.querySelector('.agent').setAttribute('cx', String(position.x*32+16));
    board.querySelector('.agent').setAttribute('cy', String(position.y*32+16));
    board.setAttribute('aria-label', 'Maze at step '+index+'; position '+position.x+', '+position.y);
    const forced = meta?.source === 'forced', code = meta?.source === 'code-rule';
    player.querySelector('[data-caption]').textContent = step ? step.action+' '+(step.valid ? '→' : '× wall')+' ('+position.x+', '+position.y+')'+(forced ? ' · forced' : code ? ' · code rule' : '') : 'S₀ / initial state';
    player.querySelector('[data-timing]').textContent = step ? (answer ? 'confidence '+Math.round(answer.confidence*100)+'% · ' : '')+step.decisionMs.toFixed(1)+' ms' : '';
    probabilities.replaceChildren();
    if (answer) {
      probabilities.classList.remove('note');
      for (const label of Object.keys(answer.probabilities).sort()) {
        const row = document.createElement('div'); row.className = 'probability'+(answer.choice === label ? ' selected' : '');
        row.append(document.createTextNode(label+(meta.destinationMoves?.[label] ? ' → '+meta.destinationMoves[label] : '')));
        const bar = document.createElement('i'), fill = document.createElement('b');
        fill.style.width = (answer.probabilities[label]*100).toFixed(1)+'%'; bar.append(fill); row.append(bar);
        row.append(document.createTextNode(Math.round(answer.probabilities[label]*100)+'%')); probabilities.append(row);
      }
    } else { probabilities.classList.add('note'); probabilities.textContent = forced ? 'Forced move · only legal destination; no model call.' : code ? 'Code rule · no model call.' : initialNote; }
    const audit = meta?.ruleAudit;
    player.querySelector('[data-audit]').textContent = audit ? 'Post-run rule audit: expected '+audit.expectedDestination+' · '+(audit.agrees ? 'match' : 'VIOLATION')+(forced ? ' · forced, excluded from score' : '') : '';
    inspector.hidden = !meta?.request && !forced && !code;
    inspector.querySelector('summary').textContent = meta?.request ? 'Model input before move '+index : forced ? 'Forced move (no model request)' : 'Code rule decision (no model request)';
    inspector.querySelector('pre').textContent = inspector.hidden ? '' : JSON.stringify(meta?.request ?? meta, null, 2);
    slider.value = String(index); player.querySelector('output').textContent = index+' / '+trace.steps.length;
  };
  slider.addEventListener('input', () => { pause(); show(Number(slider.value)); });
  player.querySelector('[data-reset]').addEventListener('click', () => { pause(); show(0); });
  play.addEventListener('click', () => {
    if (timer) { pause(); return; }
    if (index === Number(slider.max)) show(0);
    play.textContent = 'Pause'; play.setAttribute('aria-label', 'Pause replay');
    timer = setInterval(() => { show(index+1); if (index === Number(slider.max)) pause(); }, 450);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
}
`;
