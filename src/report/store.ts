import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { escapeHtml as e } from "./html.js";
import { page } from "./page.js";

interface Manifest {
  id: string;
  experiment: string;
  title: string;
  createdAt: string;
  summary?: string;
}

export async function saveReport(
  root: string,
  experiment: { id: string; title: string },
  artifact: { data: unknown; body: string; summary?: string },
  provenance: { sourceHash: string; node: string; sdk: string; startedAt: string },
): Promise<string> {
  const createdAt = new Date().toISOString();
  const id = `${createdAt.replace(/[:.]/g, "-")}-${experiment.id}-${randomUUID().slice(0, 8)}`;
  const directory = join(root, id);
  await mkdir(directory, { recursive: true });
  const manifest: Manifest = { id, experiment: experiment.id, title: experiment.title, createdAt, summary: artifact.summary };
  const data = { schemaVersion: 1, ...manifest, provenance, result: artifact.data };
  await Promise.all([
    writeFile(join(directory, "result.json"), JSON.stringify(data, null, 2) + "\n"),
    writeFile(join(directory, "index.html"), page(experiment.title, artifact.body)),
    writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n"),
  ]);
  await writeIndex(root);
  return join(directory, "index.html");
}

async function writeIndex(root: string): Promise<void> {
  const entries: Manifest[] = [];
  for (const directory of await readdir(root, { withFileTypes: true })) {
    if (!directory.isDirectory()) continue;
    try {
      const manifest = JSON.parse(await readFile(join(root, directory.name, "manifest.json"), "utf8")) as Manifest;
      if (manifest.id === directory.name && typeof manifest.title === "string" && typeof manifest.createdAt === "string") entries.push(manifest);
    } catch { /* Other directories or incomplete reports are not notebook entries. */ }
  }
  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const body = `<div class="hero"><div><div class="eyebrow">Research notebook / ${entries.length} entries</div><h1>Generalized<br>heuristics.</h1><p class="lede">Small, visual experiments in learned decision-making.</p></div><div class="callout"><p>Can System One models amortize the creation of task-specific semantic heuristics across arbitrary problem domains?</p><p class="note">Every entry is a self-contained HTML report with its raw JSON trace.</p></div></div>
  <section><h2>Experiment log</h2><ul class="run-list">${entries.map((entry) => `<li><a href="${encodeURIComponent(entry.id)}/index.html"><span><strong>${e(entry.title)} ↗</strong><br><span class="note">${e(entry.summary ?? entry.experiment)}</span></span><span class="mono note">${e(entry.createdAt)}</span></a></li>`).join("")}</ul></section>`;
  await writeFile(join(root, "index.html"), page("Notebook", body, "index.html"));
}
