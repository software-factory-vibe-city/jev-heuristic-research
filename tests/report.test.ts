import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mazeExperiment } from "../src/experiments/maze/experiment.js";
import { escapeHtml } from "../src/report/html.js";
import { page } from "../src/report/page.js";
import { saveReport } from "../src/report/store.js";

test("report escapes untrusted text and uses no external runtime assets", () => {
  assert.equal(escapeHtml('<script>"&\''), "&lt;script&gt;&quot;&amp;&#39;");
  const html = page("</title><script>alert(1)</script>", "safe");
  assert.ok(html.includes("&lt;/title&gt;"));
  assert.ok(html.includes("Content-Security-Policy"));
  assert.ok(!html.includes("<script src="));
  assert.ok(!html.includes("<link"));
});

test("experiment produces static replay + raw data and appends notebook entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "heuristics-report-"));
  try {
    const artifact = await mazeExperiment.execute({ solvers: ["astar"], cases: ["detour"], trials: 1 });
    assert.equal(artifact.data.cases[0]?.runs[0]?.trace.status, "solved");
    assert.equal(artifact.data.cases[0]?.runs[0]?.metrics.efficiency, 1);
    assert.equal(artifact.data.protocol.providers.length, 0);
    assert.equal(artifact.data.protocol.policyVersion, "maze-next-move-v3");
    assert.equal(artifact.data.protocol.actionSpace, "legal-only");
    assert.equal(artifact.data.protocol.singleLegalMove, "forced");
    assert.ok(artifact.body.includes("only the legal directions"));
    assert.equal((artifact.body.match(/data-frame/g) ?? []).length, 11);
    const provenance = { sourceHash: "test", node: process.version, sdk: "test", startedAt: new Date().toISOString() };
    const path = await saveReport(root, mazeExperiment, artifact, provenance);
    const second = await saveReport(root, mazeExperiment, artifact, provenance);
    assert.notEqual(path, second);
    const data = JSON.parse(await readFile(join(dirname(path), "result.json"), "utf8"));
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.result.cases[0].maze.rows[1], "#S#....G#");
    const index = await readFile(join(root, "index.html"), "utf8");
    assert.ok(index.includes("2 entries"));
    assert.ok((await readFile(path, "utf8")).startsWith("<!doctype html>"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("unknown cases and solvers fail before any work", async () => {
  await assert.rejects(mazeExperiment.execute({ solvers: ["bad"], cases: [], trials: 1 }), /Maze solvers/);
  await assert.rejects(mazeExperiment.execute({ solvers: ["astar"], cases: ["bad"], trials: 1 }), /Maze cases/);
});
