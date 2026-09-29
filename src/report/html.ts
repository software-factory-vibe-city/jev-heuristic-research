export function escapeHtml(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

export const formatMs = (ms: number) => ms < 1_000 ? `${ms.toFixed(1)} ms` : `${(ms / 1_000).toFixed(2)} s`;

export function badge(status: string): string {
  return `<span class="badge ${escapeHtml(status)}">${escapeHtml(status.replaceAll("-", " "))}</span>`;
}

/** Server-rendered frames; start at the outcome so the report is useful even without JavaScript. */
export function replay(frames: string[]): string {
  if (!frames.length) throw new Error("Replay needs at least one frame");
  const last = frames.length - 1;
  return `<div class="replay" data-replay>
    <div class="frames">${frames.map((frame, index) => `<div data-frame ${index !== last ? "hidden" : ""}>${frame}</div>`).join("")}</div>
    <div class="controls">
      <button type="button" data-play aria-label="Play replay">Play</button>
      <button type="button" data-reset aria-label="Reset replay">↺</button>
      <input type="range" min="0" max="${last}" value="${last}" aria-label="Replay step">
      <output>${last} / ${last}</output>
    </div>
  </div>`;
}

export function table(headers: string[], rows: string[][]): string {
  return `<div class="table-wrap"><table><thead><tr>${headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}
