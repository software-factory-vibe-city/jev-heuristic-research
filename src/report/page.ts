import { playerScript, styles } from "./assets.js";
import { escapeHtml } from "./html.js";

export function page(title: string, body: string, home = "../index.html"): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(title)} · Generalized heuristics</title><style>${styles}</style></head>
<body><div class="shell"><header><a class="brand" href="${escapeHtml(home)}">Generalized heuristics</a><span class="eyebrow">Applied research / experiment notebook</span></header>
<main>${body}</main><footer><span>System One / task-specific semantic heuristics</span><span>Computed in Node. Replayed in your browser. No inference on this page.</span></footer></div>
<script>${playerScript}</script></body></html>`;
}
