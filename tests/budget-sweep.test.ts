import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGenerated } from "../src/experiments/maze-generated/experiment.js";
import { saveReport } from "../src/report/store.js";
import { childArguments, planSweep, renderSweep, solutionSteps } from "../scripts/maze-budget-sweep.js";
import type { SweepResult } from "../scripts/maze-budget-sweep.js";

const options = { solvers: ["astar"], cases: [], trials: 1, parameters: { families: "rooms", sizes: "3", seeds: "101", encodings: "0,1" } };

test("budget sweep preserves each frozen geometry/encoding and computes explicit per-case budgets", async () => {
  const baseline = await runGenerated(options);
  const rows = planSweep(baseline, 80, ["astar", "jev", "local"]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.budget, baseline.cases[0]!.optimalMoves * 80);
  assert.deepEqual(rows.map((row) => row.encodingSeed), [0, 1]);
  assert.deepEqual(rows[0]!.cells, { astar: { status: "pending" }, jev: { status: "pending" }, local: { status: "pending" } });
  const args = childArguments(baseline.cases[0]!, "local", rows[0]!.budget, "/tmp/test-out");
  assert.ok(args.includes("encodings=0")); assert.ok(args.includes("seeds=101")); assert.ok(args.includes("families=rooms"));
  assert.equal(args[args.indexOf("--max-steps") + 1], String(rows[0]!.budget));
  assert.equal(args[args.indexOf("--solvers") + 1], "local");
  assert.equal(args[args.indexOf("--cases") + 1], baseline.cases[0]!.layoutId);
  assert.ok(args.includes("memory=full"));
  assert.ok(childArguments(baseline.cases[0]!, "local", rows[0]!.budget, "/tmp/test-out", "summary").includes("memory=summary"));
  for (const multiplier of [0, -1, NaN, 1.5, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => planSweep(baseline, multiplier, ["astar"]));
  assert.throws(() => planSweep(baseline, 80, ["astar", "astar"]));
  assert.throws(() => planSweep({ ...baseline, protocol: { ...baseline.protocol, options: { ...options, trials: 2 } } }, 80, ["astar"]), /collapsed/);
});

test("solution-step table never presents an exhausted or missing run as a solution", async () => {
  assert.equal(solutionSteps({ status: "solved", steps: 66 }), "66");
  assert.equal(solutionSteps({ status: "budget-exhausted", steps: 1280 }), "Unsolved at 1280");
  assert.equal(solutionSteps({ status: "error", steps: 97 }), "API/run error after 97");
  assert.equal(solutionSteps({ status: "running" }), "Running…");
  assert.equal(solutionSteps({ status: "pending" }), "Pending");
  assert.equal(solutionSteps(undefined), "—");
  const baseline = await runGenerated({ ...options, parameters: { ...options.parameters, encodings: "0" } });
  const result: SweepResult = { status: "running", updatedAt: "test", protocol: { version: "test", baseline: "test", multiplier: 80,
    solvers: ["astar", "jev", "local"], instructions: "test", execution: "test", safeguards: "test" }, rows: planSweep(baseline, 80, ["astar", "jev", "local"]) };
  result.rows[0]!.cells.jev = { status: "solved", steps: 66, report: "runs/test/index.html" };
  result.rows[0]!.cells.local = { status: "budget-exhausted", steps: 640 };
  result.rows[0]!.title = "<script>";
  const html = renderSweep(result);
  assert.ok(html.includes("Unsolved at 640")); assert.ok(html.includes('href="runs/test/index.html">66</a>'));
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(html.includes("Pending")); assert.ok(html.includes("not a continuation"));
});

test("offline subprocess sweep saves child evidence and a checkpointed summary with unchanged maze and prompt", async () => {
  const root = await mkdtemp(join(tmpdir(), "maze-budget-test-"));
  try {
    const baseline = await runGenerated({ ...options, parameters: { ...options.parameters, encodings: "0" } });
    const index = await saveReport(root, { id: "maze-generated", title: "Offline fixture" }, { data: baseline, body: "offline" },
      { sourceHash: "fixture", node: process.version, sdk: "test", startedAt: "test" });
    let comparison: string | undefined;
    for (const memory of ["full", "summary"] as const) {
    const command = spawnSync(process.execPath, ["--import", "tsx", "scripts/maze-budget-sweep.ts", "--from", join(index, "..", "result.json"),
      "--multiplier", "80", "--solvers", "astar,rule", "--out", root, "--memory", memory,
      ...(comparison ? ["--compare-with", comparison] : [])], { encoding: "utf8", timeout: 30000 });
    assert.equal(command.status, 0, command.stderr + command.stdout);
    const directory = (await readdir(root)).find((name) => name.includes(memory === "summary" ? "maze-summary-sweep" : "maze-budget-sweep"))!;
    const { result } = JSON.parse(await readFile(join(root, directory, "result.json"), "utf8"));
    assert.equal(result.status, "completed"); assert.equal(result.active, undefined);
    assert.equal(result.protocol.memory, memory);
    if (memory === "summary") assert.ok(result.protocol.comparison);
    comparison = join(root, directory, "result.json");
    assert.equal(result.rows[0].budget, baseline.cases[0]!.optimalMoves * 80);
    for (const solver of ["astar", "rule"]) {
      const cell = result.rows[0].cells[solver];
      assert.equal(cell.status, "solved"); assert.ok(cell.report.startsWith("runs/"));
      const { result: child } = JSON.parse(await readFile(join(root, directory, cell.report, "..", "result.json"), "utf8"));
      assert.deepEqual(child.cases[0].maze, baseline.cases[0]!.maze);
      assert.deepEqual(child.cases[0].encoding, baseline.cases[0]!.encoding);
      assert.equal(child.protocol.instructions, baseline.protocol.instructions);
      assert.equal(child.protocol.memory, memory);
      assert.equal(child.cases[0].maxSteps, result.rows[0].budget);
      assert.equal(child.cases[0].runs[0].metrics.modelCalls, 0);
    }
    const html = await readFile(join(root, directory, "index.html"), "utf8");
    assert.ok(html.includes("Solution steps"));
    if (memory === "summary") assert.ok(html.includes("Summary-only amendment"));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
