export const styles = `
:root { color-scheme: light; --paper:#f5f4ee; --panel:#fffef9; --ink:#242c2b; --muted:#626c66; --line:#d5d9ce; --accent:#a34122; --teal:#276855; }
* { box-sizing:border-box; }
body { margin:0; background:var(--paper); color:var(--ink); font-family:Inter,ui-sans-serif,system-ui,sans-serif; line-height:1.55; }
a { color:inherit; text-underline-offset:4px; } a:hover { color:var(--accent); }
button,input { font:inherit; } button { cursor:pointer; }
button:focus-visible,input:focus-visible,a:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
[hidden] { display:none !important; }
.shell { max-width:1480px; margin:auto; padding:0 40px 64px; }
header { display:flex; align-items:center; justify-content:space-between; gap:20px; min-height:90px; border-bottom:1px solid var(--ink); }
.brand { text-decoration:none; font-weight:650; letter-spacing:-.035em; font-size:21px; }
.brand::before { content:'◈'; color:var(--accent); margin-right:10px; }
.mono,.eyebrow,th,.badge,.controls,dt { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; }
.eyebrow { text-transform:uppercase; font-size:11px; letter-spacing:.13em; color:var(--accent); }
header .eyebrow { color:var(--muted); }
.hero { padding:48px 0 32px; display:grid; grid-template-columns:1.3fr 1fr; gap:48px; align-items:end; }
h1 { font-size:clamp(36px,4.8vw,68px); line-height:1.03; letter-spacing:-.06em; font-weight:550; margin:15px 0; }
h2 { font-size:26px; letter-spacing:-.04em; font-weight:550; margin:0 0 8px; }
h3 { font-size:17px; letter-spacing:-.025em; margin:0 0 8px; }
p { margin:0 0 12px; }.lede { font-size:17px; color:var(--muted); max-width:600px; }
.note { color:var(--muted); font-size:13px; }.note code { color:var(--ink); }
.callout { border-left:2px solid var(--accent); padding:4px 0 4px 18px; }
.summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); border:1px solid var(--line); margin:12px 0 28px; background:var(--panel); }
.summary > div { padding:20px 24px; border-right:1px solid var(--line); }.summary > div:last-child { border:0; }
.summary strong { display:block; font-size:28px; font-weight:550; letter-spacing:-.04em; }.summary span { color:var(--muted); font-size:12px; }
section { margin:42px 0; }.section-heading { display:flex; gap:24px; align-items:start; justify-content:space-between; margin-bottom:18px; }
.section-heading > div:first-child { max-width:700px; }
.cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,330px),1fr)); gap:18px; align-items:start; }
.card { border:1px solid var(--line); background:var(--panel); padding:20px; min-width:0; }
.card-head { display:flex; justify-content:space-between; align-items:start; gap:12px; min-height:66px; }
.card-head h3 { overflow-wrap:anywhere; }.badge { display:inline-block; padding:4px 7px; font-size:10px; white-space:nowrap; background:#eaece4; color:var(--muted); }
.badge.solved { background:#e1eee6; color:#215d42; }.badge.error,.badge.budget-exhausted { background:#f8e5da; color:#8d391d; }
.board { display:block; width:100%; height:auto; margin:10px 0; border:1px solid var(--line); }
.wall { fill:#303b37; }.floor { fill:#f0f0e7; }.grid { stroke:#d4d9cf; stroke-width:.4; }.expanded { fill:#d5dfd6; }
.trail { fill:none; stroke:#95bbae; stroke-width:8; stroke-linecap:round; stroke-linejoin:round; }
.cell-label { fill:#45574a; font:12px ui-monospace,monospace; text-anchor:middle; dominant-baseline:central; }
.agent { fill:#ba4c2d; stroke:#fffef9; stroke-width:2; }.goal { fill:#276855; }.goal-label { fill:#fffef9; font:bold 14px ui-monospace,monospace; text-anchor:middle; dominant-baseline:central; }
.frame-caption { display:flex; justify-content:space-between; gap:12px; font-size:12px; margin:12px 0 7px; min-height:24px; }
.probabilities { display:flex; gap:8px; height:44px; }.probability { flex:1; font-size:10px; color:var(--muted); }.probability i { display:block; height:4px; background:#e1e5da; margin:5px 0; }.probability b { display:block; height:100%; background:#879f92; }.probability.selected b { background:var(--accent); }
.controls { display:flex; align-items:center; gap:8px; font-size:11px; margin:16px 0; }.controls button { border:1px solid var(--line); background:transparent; padding:5px 8px; color:var(--ink); }
.controls input { width:100%; min-width:30px; accent-color:var(--accent); }.controls output { white-space:nowrap; min-width:48px; text-align:right; }
.metrics { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; border-top:1px solid var(--line); padding-top:14px; margin:0; }.metrics dt { font-size:10px; color:var(--muted); }.metrics dd { margin:2px 0 0; font-size:16px; }
.error-message { overflow-wrap:anywhere; font-size:12px; color:#8d391d; margin:10px 0; }
.representation-pair { margin-bottom:20px; }.state-inspector { margin-top:12px; padding-top:10px; }.state-inspector summary { font-size:12px; }.state-inspector pre { max-height:360px; overflow:auto; font-size:11px; }
.reference { margin-top:18px; }.reference-card { max-width:440px; margin-top:16px; }
.table-wrap { overflow:auto; border:1px solid var(--line); }table { border-collapse:collapse; width:100%; font-size:12px; background:var(--panel); text-align:left; }
th { font-size:10px; color:var(--muted); font-weight:500; background:#ebeee5; white-space:nowrap; }th,td { padding:12px 15px; border-bottom:1px solid var(--line); }tbody tr:last-child td { border:0; }
details { border-top:1px solid var(--line); padding-top:20px; }summary { cursor:pointer; font-size:14px; }details p { margin-top:16px; max-width:950px; }
pre { white-space:pre-wrap; overflow-wrap:anywhere; background:#ebeee5; padding:20px; font-size:12px; }code { font-family:ui-monospace,monospace; }
footer { border-top:1px solid var(--ink); padding-top:20px; display:flex; justify-content:space-between; gap:20px; font-size:11px; color:var(--muted); }
.run-list { list-style:none; padding:0; }.run-list li { border-bottom:1px solid var(--line); padding:20px 0; }.run-list a { display:flex; justify-content:space-between; gap:20px; text-decoration:none; }
@media(max-width:760px) { .shell { padding:0 18px 32px; }.hero { grid-template-columns:1fr; gap:20px; padding-top:32px; }header { min-height:74px; }header .eyebrow { display:none; }.section-heading { display:block; }.summary > div { padding:16px; }.cards { grid-template-columns:1fr; }footer { flex-direction:column; } }
@media(prefers-reduced-motion:reduce) { * { scroll-behavior:auto; } }
`;

export const playerScript = `
for (const player of document.querySelectorAll('[data-replay]')) {
  const frames = [...player.querySelectorAll('[data-frame]')];
  const slider = player.querySelector('input');
  const output = player.querySelector('output');
  const play = player.querySelector('[data-play]');
  let timer;
  let index = Number(slider.value);
  const pause = () => { clearInterval(timer); timer = undefined; play.textContent = 'Play'; play.setAttribute('aria-label', 'Play replay'); };
  const show = (next) => {
    frames[index].hidden = true;
    index = next;
    frames[index].hidden = false;
    slider.value = String(index);
    output.textContent = index + ' / ' + (frames.length - 1);
  };
  slider.addEventListener('input', () => { pause(); show(Number(slider.value)); });
  player.querySelector('[data-reset]').addEventListener('click', () => { pause(); show(0); });
  play.disabled = frames.length < 2;
  play.addEventListener('click', () => {
    if (timer) { pause(); return; }
    if (index === frames.length - 1) show(0);
    play.textContent = 'Pause'; play.setAttribute('aria-label', 'Pause replay');
    timer = setInterval(() => { show(index + 1); if (index === frames.length - 1) pause(); }, 450);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
}
`;
