import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { astar } from "../src/core/astar.js";
import { defineExperiment } from "../src/core/experiment.js";
import { seededRandom, shuffle } from "../src/core/random.js";
import { createChoiceModel } from "../src/providers/system-one.js";
import { createMazeTask, parseMaze, positionKey } from "../src/experiments/maze/domain.js";
import { generateMaze, mazeFamilies, mazeTopology } from "../src/experiments/maze/generated.js";
import { createEncoding } from "../src/experiments/maze-diagnostics/encoding.js";
import { explorationRule, hypothesisState, ruleInstructions } from "../src/experiments/maze-hypotheses/arms.js";
import { generatedSuite, suiteParameters } from "../src/experiments/maze-generated/suite.js";
import { runGenerated } from "../src/experiments/maze-generated/experiment.js";
import { renderGenerated } from "../src/experiments/maze-generated/render.js";
import { compareWithCode, summarizeGenerated } from "../src/experiments/maze-generated/comparison.js";

const options = { solvers: ["astar", "rule", "local"], cases: [], trials: 1,
  parameters: { families: "branching,loops,rooms", sizes: "3", seeds: "101", encodings: "0,1" } };
const respond = (request: any, selected = explorationRule(request.state.candidate_facts)) => Response.json({
  model: "test-model", answers: { answer: { type: "choice", choice: selected, confidence: 1,
    probabilities: Object.fromEntries(Object.keys(request.questions.answer.criteria).map((id) => [id, id === selected ? 1 : 0])) } },
  usage: { input_tokens: 10, output_tokens: 1 },
});
const compliant = (config: Parameters<typeof createChoiceModel>[0]) => createChoiceModel(config, async (_url, init) => respond(JSON.parse(String(init?.body))));

test("seeded randomness is repeatable, bounded, seed-zero-safe, and shuffles without mutation", () => {
  for (const seed of [0, 1, 101, 0xffffffff]) {
    const a = seededRandom(seed), b = seededRandom(seed);
    for (let i = 0; i < 100; i++) { const n = a(); assert.equal(n, b()); assert.ok(n >= 0 && n < 1); }
  }
  for (const seed of [-1, 1.5, NaN, Infinity, 0x100000000]) assert.throws(() => seededRandom(seed), /uint32/);
  const original = [1, 2, 3, 4];
  assert.deepEqual(shuffle(original, seededRandom(1)).sort(), original);
  assert.deepEqual(original, [1, 2, 3, 4]);
});

test("generator v1 has stable golden grids and never reads ambient randomness", () => {
  const hashes = ["8c7b4f8861a03e5502cdf274f98621cc46528b9cbf79a5bb2e5c26e409ae8717", "74082dcedd60f9581b5197004ee4e68b5c1f85a58b8b4e706f121462d3ded477",
    "57194ce2ab06587a34cc37f58fd1829369f63d550ef9500e5cfab397a28b4b2e", "ee3760e5926d982796695c733c967727a5a680bdedd2470e23e195aed0f5e11b"];
  const original = Math.random;
  try {
    Math.random = () => { throw new Error("Ambient randomness prohibited"); };
    for (const [index, family] of mazeFamilies.entries()) {
      const spec = { family, width: 3, height: 3, seed: 101 };
      const maze = generateMaze(spec);
      assert.deepEqual(maze, generateMaze(spec));
      assert.equal(createHash("sha256").update(maze.rows.join("\n")).digest("hex"), hashes[index]);
      assert.deepEqual(spec, { family, width: 3, height: 3, seed: 101 });
    }
  } finally { Math.random = original; }
});

test("generated rectangles are connected, bounded, solvable, and have the intended tree/cycle invariants", () => {
  for (const [width, height] of [[2, 2], [3, 5], [8, 4]]) for (const seed of [0, 1, 101, 202, 0xffffffff]) {
    const base = generateMaze({ family: "corridors", width: width!, height: height!, seed });
    for (const family of mazeFamilies) {
      const maze = generateMaze({ family, width: width!, height: height!, seed });
      assert.equal(maze.rows.length, height! * 2 + 1);
      assert.ok(maze.rows.every((row) => row.length === width! * 2 + 1 && row.startsWith("#") && row.endsWith("#")));
      assert.match(maze.rows[0]!, /^#+$/); assert.match(maze.rows.at(-1)!, /^#+$/);
      assert.deepEqual(maze.start, { x: 1, y: 1 }); assert.deepEqual(maze.goal, { x: width! * 2 - 1, y: height! * 2 - 1 });
      const stats = mazeTopology(maze);
      assert.equal(stats.components, 1); assert.equal(stats.degreeCounts[0], 0);
      assert.equal(Object.values(stats.degreeCounts).reduce((a, b) => a + b, 0), stats.openCells);
      const task = createMazeTask(maze);
      const search = astar(task, (p) => Math.abs(p.x - maze.goal.x) + Math.abs(p.y - maze.goal.y));
      assert.equal(search.actions!.length, stats.optimalMoves);
      let current = maze.start;
      for (const action of search.actions!) { const next = task.transition(current, action); assert.ok(next.valid); current = next.state; }
      assert.deepEqual(current, maze.goal);
      if (family === "corridors" || family === "branching") {
        assert.equal(stats.openCells, 2 * width! * height! - 1); assert.equal(stats.cycleRank, 0);
      } else {
        assert.ok(stats.cycleRank > 0);
        if (stats.cycleRank > 1) assert.ok(stats.junctions > 0); // A single cycle can be a degree-two ring.
        for (const [y, row] of base.rows.entries()) for (const [x, cell] of [...row].entries()) if (cell !== "#") assert.notEqual(maze.rows[y]![x], "#");
        if (family === "loops") assert.equal(stats.cycleRank, Math.ceil((width! - 1) * (height! - 1) * 0.35));
      }
    }
  }
  const disconnected = mazeTopology(parseMaze("S#G"));
  assert.equal(disconnected.components, 2); assert.equal(disconnected.cycleRank, 0); assert.equal(disconnected.optimalMoves, null);
  assert.equal(mazeTopology(parseMaze("S..\n..G")).cycleRank, 2);
});

test("invalid generator dimensions, families, seeds, and suite parameters fail explicitly", () => {
  const spec = { family: "corridors" as const, width: 3, height: 3, seed: 0 };
  for (const invalid of [{ ...spec, width: 1 }, { ...spec, height: 65 }, { ...spec, width: 2.5 }, { ...spec, seed: -1 }]) assert.throws(() => generateMaze(invalid));
  assert.throws(() => generateMaze({ ...spec, family: "unknown" as any }), /family/);
  const invalidParameters: Record<string, string>[] = [{ sizes: "" }, { sizes: "3,3" }, { sizes: "3,03" }, { sizes: "3.5" }, { sizes: "26" },
    { seeds: "-1" }, { seeds: "4294967296" }, { seeds: "1,,2" }, { families: "bogus" }, { encodings: "NaN" }, { unknown: "1" }];
  for (const invalid of invalidParameters) assert.throws(() => suiteParameters(invalid));
  assert.throws(() => suiteParameters({ seeds: Array.from({ length: 40 }, (_, i) => i).join(",") }), /256/);
});

test("suite selection preserves geometry across independent encodings and is independent of list order", () => {
  const defaults = generatedSuite({ ...options, parameters: undefined });
  assert.equal(defaults.fixtures.length, 16);
  assert.equal(new Set(defaults.fixtures.map((f) => f.generation.hash)).size, 16);
  const suite = generatedSuite(options);
  assert.equal(suite.fixtures.length, 6);
  for (const fixture of suite.fixtures.filter((f) => f.encodingSeed === 0)) {
    const alternate = suite.fixtures.find((f) => f.layoutId === fixture.layoutId && f.encodingSeed === 1)!;
    assert.equal(alternate.ascii, fixture.ascii); assert.deepEqual(alternate.generation, fixture.generation);
    const maze = parseMaze(fixture.ascii);
    assert.notDeepEqual(createEncoding({ mazeId: fixture.encodingId!, maze }, 0).byPosition, createEncoding({ mazeId: fixture.encodingId!, maze }, 1).byPosition);
  }
  const reordered = generatedSuite({ ...options, parameters: { ...options.parameters, families: "rooms,loops,branching", encodings: "1,0" } });
  for (const fixture of suite.fixtures) assert.deepEqual(reordered.fixtures.find((f) => f.id === fixture.id), fixture);
  const selected = generatedSuite({ ...options, cases: ["loops-3x3-s101"] });
  assert.equal(selected.fixtures.length, 2); assert.ok(selected.fixtures.every((f) => f.layoutId === "loops-3x3-s101"));
  assert.throws(() => generatedSuite({ ...options, cases: ["unknown"] }), /--cases/);
});

test("generated rollouts preserve the exact rule interface, match code on evolving states, rotate providers, and keep evaluator fields out", async () => {
  const result = await runGenerated(options, compliant);
  assert.equal(result.protocol.version, "maze-generated-v1"); assert.equal(result.protocol.encodingSeed, null);
  assert.equal(result.suite.layouts, 3); assert.equal(result.suite.conditions, 6); assert.equal(result.suite.scheduledRollouts, 18);
  assert.equal(result.protocol.instructions, ruleInstructions); assert.deepEqual(result.protocol.options, options);
  let junctions = 0, ties = 0;
  for (const [caseIndex, item] of result.cases.entries()) {
    assert.equal(item.optimalMoves, item.topology.optimalMoves);
    const offset = caseIndex % options.solvers.length;
    assert.deepEqual(item.runs.map((r) => r.solver), [...options.solvers.slice(offset), ...options.solvers.slice(0, offset)]);
    const model = item.runs.find((run) => run.solver === "local")!, code = item.runs.find((run) => run.solver === "rule")!;
    assert.deepEqual(model.trace.steps.map((s) => s.action), code.trace.steps.map((s) => s.action));
    assert.equal(model.metrics.ruleViolations, 0);
    assert.equal(model.metrics.modelCalls + model.metrics.forcedMoves!, model.trace.steps.length);
    junctions += model.metrics.junctionChecks; ties += model.metrics.tieChecks;
    for (const [i, step] of model.trace.steps.entries()) {
      if (step.metadata!.source === "forced") { assert.equal(step.metadata!.request, undefined); continue; }
      const request = step.metadata!.request as any;
      assert.deepEqual(request.state, hypothesisState({ maze: item.maze, current: step.before, history: model.trace.steps.slice(0, i) }, item.encoding, "rule"));
      assert.equal(request.questions.answer.instructions, ruleInstructions);
      assert.deepEqual(Object.keys(request.questions.answer.criteria), request.state.legal_destinations);
      assert.ok(request.state.legal_destinations.length >= 2);
      assert.equal((step.metadata!.answer as any).choice, item.encoding.byPosition[positionKey(step.after)]);
      assert.ok(!/"(coordinates|x|y|generation|hash|seed|topology|optimalMoves|ruleAudit)"/.test(JSON.stringify(request.state)));
    }
  }
  assert.ok(junctions > 0); assert.ok(ties > 0);
  const summary = summarizeGenerated(result.cases, "local");
  assert.equal(summary.runs, 6); assert.equal(summary.layouts, 3); assert.equal(summary.errors, 0);
  assert.equal(summary.junctionMatches, summary.junctionChecks); assert.equal(summary.tieMatches, summary.tieChecks);
  assert.ok(summary.maxRequestBytes > 0);
  const pairs = compareWithCode(result.cases, "local");
  assert.equal(pairs.pairs, 6); assert.equal(pairs.identicalActions, 6); assert.equal(pairs.errorPairs, 0);
  const html = renderGenerated(result);
  assert.equal((html.match(/<svg /g) ?? []).length, 18);
  assert.equal((html.match(/<script type="application\/json" data-trace>/g) ?? []).length, 18);
  assert.ok(html.includes("Matched code-rule control")); assert.ok(html.includes("With minimum-visit ties"));
  assert.ok(html.includes("case index")); assert.ok(!html.includes("fetch("));
});

test("errors and exhaustion remain in denominators and do not become paired wins", async () => {
  const result = await runGenerated({ ...options, solvers: ["rule", "local"], maxSteps: 6,
    parameters: { families: "branching", sizes: "3", seeds: "101", encodings: "0" } }, (config) => createChoiceModel(config, async () => Response.json({ message: "offline <script>" }, { status: 503 })));
  const item = result.cases[0]!, model = item.runs.find((run) => run.solver === "local")!;
  assert.equal(model.trace.status, "error"); assert.equal(model.metrics.modelCalls, 1); assert.equal(model.metrics.ruleChecks, 0);
  const summary = summarizeGenerated(result.cases, "local");
  assert.equal(summary.runs, 1); assert.equal(summary.errors, 1); assert.equal(summary.solved, 0); assert.equal(summary.meanSolvedStretch, null);
  assert.equal(compareWithCode(result.cases, "local").errorPairs, 1); assert.equal(compareWithCode(result.cases, "local").codeOnly, 0);
  assert.ok(renderGenerated(result).includes("Failed model request (no move executed)"));
  assert.ok(renderGenerated(result).includes("offline &lt;script&gt;"));
  assert.equal(item.runs.find((run) => run.solver === "rule")!.trace.status, "budget-exhausted");
});

test("noncompliant generated-maze choices execute without rescue and embedded trace evidence cannot close its script", async () => {
  const result = await runGenerated({ ...options, solvers: ["local"], maxSteps: 8, parameters: { families: "branching", sizes: "3", seeds: "101" } }, (config) => createChoiceModel(config, async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    const previous = request.state.candidate_facts.find((fact: any) => fact.previous_position);
    return respond(request, previous?.destination ?? Object.keys(request.questions.answer.criteria)[0]);
  }));
  const run = result.cases[0]!.runs[0]!;
  assert.equal(run.trace.status, "budget-exhausted"); assert.ok(run.metrics.ruleViolations > 0);
  assert.equal(run.trace.steps.length, 8); assert.ok(run.metrics.revisits > 0);
  const step = run.trace.steps.find((s) => s.metadata?.request)!;
  (step.metadata!.request as any).untrusted = "</script><script>alert('bad')</script>";
  const html = renderGenerated(result);
  assert.ok(!html.includes("</script><script>alert('bad')"));
  const data = JSON.parse(/<script type="application\/json" data-trace>(.*?)<\/script>/s.exec(html)![1]!);
  assert.equal(data.steps.find((s: any) => s.metadata?.request).metadata.request.untrusted, "</script><script>alert('bad')</script>");
});

test("experiment parameters are opt-in and CLI rejects malformed/duplicate settings before inference", async () => {
  let called = false;
  const experiment = defineExperiment({ id: "test", title: "Test", run: async () => { called = true; return null; }, render: () => "" });
  await assert.rejects(experiment.execute({ solvers: [], cases: [], trials: 1, parameters: { sizes: "3" } }), /Unsupported parameter/);
  assert.equal(called, false);
  for (const args of [["--param", "sizes"], ["--param", "sizes=3", "--param", "sizes=5"], ["--param", "unknown=3"]]) {
    const command = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "maze-generated", "--solvers", "astar", ...args], { encoding: "utf8" });
    assert.equal(command.status, 1); assert.match(command.stderr, /--param|Unsupported parameter/);
  }
});
