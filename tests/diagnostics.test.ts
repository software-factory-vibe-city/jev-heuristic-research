import { test } from "node:test";
import assert from "node:assert/strict";
import { createChoiceModel, providerConfig } from "../src/providers/system-one.js";
import { checkpointDefinitions, freezeCheckpoint } from "../src/experiments/maze-diagnostics/checkpoints.js";
import type { FrozenCheckpoint } from "../src/experiments/maze-diagnostics/checkpoints.js";
import { conditions, createEncoding, diagnosticState } from "../src/experiments/maze-diagnostics/encoding.js";
import { expectedAnswers, probeCriteria, probeInstructions, probes } from "../src/experiments/maze-diagnostics/probes.js";
import { diagnosticSchedule, mazeDiagnosticsExperiment, runDiagnostics } from "../src/experiments/maze-diagnostics/experiment.js";
import { diagnosticPairs, summarizeSamples } from "../src/experiments/maze-diagnostics/comparison.js";
import { renderDiagnostics } from "../src/experiments/maze-diagnostics/render.js";
import { createMazeTask, parseMaze, positionKey } from "../src/experiments/maze/domain.js";

const checkpoints = checkpointDefinitions.map(freezeCheckpoint);
const options = { solvers: ["local"], cases: ["fork-start"], trials: 1 };
const answer = (request: any) => {
  const criteria = request.questions.answer.criteria;
  const labels = Object.keys(criteria);
  assert.ok(labels.length >= 2);
  return Response.json({ model: "test-model", answers: { answer: {
    type: "choice", choice: labels[0], confidence: 1,
    probabilities: Object.fromEntries(labels.map((label, i) => [label, i === 0 ? 1 : 0])),
  } }, usage: { input_tokens: 10, output_tokens: 1 } });
};

test("frozen checkpoints reconstruct legal historical prefixes and reject inconsistent definitions", () => {
  assert.equal(checkpoints.length, 6);
  for (const checkpoint of checkpoints) {
    assert.deepEqual(checkpoint.current, checkpointDefinitions.find((item) => item.id === checkpoint.id)!.current);
    assert.equal(checkpoint.history.length, checkpoint.actions.length);
    assert.ok(checkpoint.history.every((step) => step.valid));
    assert.equal(createMazeTask(checkpoint.maze).actions(checkpoint.current).length, 2);
  }
  assert.throws(() => freezeCheckpoint({ ...checkpointDefinitions[0]!, current: { x: 0, y: 0 } }), /position/);
  assert.throws(() => freezeCheckpoint({ ...checkpointDefinitions[0]!, actions: ["up"] }), /Invalid checkpoint move/);
});

test("paired states differ only in node coordinates; IDs and ordering are stable without geometry leaks", () => {
  for (const checkpoint of checkpoints) {
    const encoding = createEncoding(checkpoint);
    assert.deepEqual(createEncoding(checkpoint), encoding);
    assert.notDeepEqual(createEncoding(checkpoint, 123), encoding);
    const withCoordinates = diagnosticState(checkpoint, encoding, "coordinates");
    const without = diagnosticState(checkpoint, encoding, "topology");
    const stripped = { ...withCoordinates, graph: { ...withCoordinates.graph,
      nodes: withCoordinates.graph.nodes.map((node) => ({ id: node.id, neighbors: node.neighbors })),
    } };
    assert.deepEqual(stripped, without);
    assert.equal(withCoordinates.graph.nodes.length, checkpoint.maze.rows.join("").replaceAll("#", "").length);
    const task = createMazeTask(checkpoint.maze);
    for (const node of encoding.nodes) {
      assert.match(node.id, /^n\d+$/);
      assert.deepEqual(node.neighbors, task.actions(node.position).map((action) => encoding.byPosition[positionKey(task.transition(node.position, action).state)]!).sort());
    }
    assert.deepEqual(without.legal_destinations, [...without.legal_destinations].sort());
    const json = JSON.stringify(without);
    assert.ok(!/"(coordinates|x|y|dimensions|grid|maze|expected|distance|instructions|answers)"/.test(json));
    assert.ok(!/\b(up|right|down|left)\b/.test(json));
    assert.ok(!/\d+,\d+/.test(json));
    assert.equal(without.history.length, checkpoint.actions.length);
    assert.equal(without.visit_counts.reduce((sum, entry) => sum + entry.count, 0), checkpoint.history.length + 1);
    assert.deepEqual(without.history.map((step) => [step.from, step.to]), checkpoint.history.map((step) => [encoding.byPosition[positionKey(step.before)], encoding.byPosition[positionKey(step.after)]]));
    assert.equal(without.goal, encoding.byPosition[positionKey(checkpoint.maze.goal)]);
    assert.equal(without.current, encoding.byPosition[positionKey(checkpoint.current)]);
  }
  assert.deepEqual(createEncoding(checkpoints[0]!), createEncoding(checkpoints[1]!));
  assert.deepEqual(createEncoding(checkpoints[2]!), createEncoding(checkpoints[3]!));
});

test("factual and action grading matches independent hand-checked checkpoint answers", () => {
  const expected = [
    { previous: "5,1", unvisited: "7,1", "dead-end": "none", action: "7,1" },
    { previous: "5,1", unvisited: "7,1", "dead-end": "none", action: "7,1" },
    { previous: "1,1", unvisited: "1,3", "dead-end": "1,1", action: "1,3" },
    { previous: "1,1", unvisited: "1,3", "dead-end": "1,1", action: "1,3" },
    { previous: "none", unvisited: "multiple", "dead-end": "none", action: "1,2" },
    { previous: "7,1", unvisited: "none", "dead-end": "7,1", action: "5,1" },
  ];
  for (const [i, checkpoint] of checkpoints.entries()) {
    const encoding = createEncoding(checkpoint);
    for (const probe of probes) {
      const target = expected[i]![probe];
      const label = encoding.byPosition[target] ?? target;
      assert.deepEqual(expectedAnswers(checkpoint, encoding, probe), [label]);
      const criteria = probeCriteria(checkpoint, encoding, probe);
      assert.ok(Object.hasOwn(criteria, label));
      assert.ok(Object.keys(criteria).length >= 2);
      if (probe === "action") assert.deepEqual(Object.keys(criteria), diagnosticState(checkpoint, encoding, "topology").legal_destinations);
    }
  }
});

test("evaluator accepts tied best actions and handles multiple qualifying dead ends", () => {
  const checkpoint: FrozenCheckpoint = { ...checkpoints[0]!, maze: parseMaze("S.\n.G"), current: { x: 0, y: 0 }, history: [], actions: [] };
  const encoding = createEncoding(checkpoint);
  assert.deepEqual(expectedAnswers(checkpoint, encoding, "action"), diagnosticState(checkpoint, encoding, "topology").legal_destinations);
  const branch: FrozenCheckpoint = { ...checkpoint, maze: parseMaze("#G#\n.S.\n###"), current: { x: 1, y: 1 } };
  assert.deepEqual(expectedAnswers(branch, createEncoding(branch), "dead-end"), ["multiple"]);
});

test("diagnostic schedule balances arm order, rotates questions, and reverses providers without mutating inputs", () => {
  const solvers = ["local", "jev"] as const;
  const a = diagnosticSchedule(solvers, 1, 0);
  const b = diagnosticSchedule(solvers, 2, 0);
  assert.equal(a.length, 16);
  assert.equal(a[0]!.solver, "local");
  assert.equal(b[0]!.solver, "jev");
  assert.notEqual(a[0]!.probe, b[0]!.probe);
  assert.deepEqual(a.slice(0, 2).map((item) => item.condition), ["coordinates", "topology"]);
  assert.deepEqual(a.slice(2, 4).map((item) => item.condition), ["topology", "coordinates"]);
  assert.equal(new Set(a.map((item) => JSON.stringify(item))).size, 16);
  for (const solver of solvers) for (const probe of probes) {
    const armOrder = (schedule: ReturnType<typeof diagnosticSchedule>) => schedule.filter((item) => item.solver === solver && item.probe === probe).map((item) => item.condition);
    assert.deepEqual(armOrder(a), armOrder(b).reverse());
    assert.deepEqual(armOrder(a), armOrder(diagnosticSchedule(solvers, 1, 1)).reverse());
  }
  assert.deepEqual(solvers, ["local", "jev"]);
});

test("custom neutral SDK question keys preserve typed evidence and validation", async () => {
  const model = createChoiceModel(providerConfig("local", {}), async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(request.questions), ["answer"]);
    return answer(request);
  });
  const decision = await model.decide("state", "Fact?", { a: "A", b: "B" }, "answer");
  assert.equal(decision.action, "a");
  assert.ok(decision.metadata?.answer);
  assert.equal(model.stats.calls, 1);
});

test("diagnostics repeat identical isolated requests, exclude evaluator data, grade, and render evidence", async () => {
  const requests: any[] = [];
  let clients = 0;
  const result = await runDiagnostics({ ...options, cases: ["corridor-before-turn", "fork-start"], trials: 3 }, (config) => {
    clients++;
    return createChoiceModel(config, async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(request.questions), ["answer"]);
      assert.ok(Object.values(probeInstructions).includes(request.questions.answer.instructions));
      assert.deepEqual(Object.keys(request.state), ["graph", "start", "current", "goal", "legal_destinations", "history", "visit_counts", "visit_count_definition"]);
      requests.push(request);
      return answer(request);
    });
  });
  assert.deepEqual(mazeDiagnosticsExperiment.defaultSolvers, ["local"]);
  assert.equal(result.samples.length, 48);
  assert.equal(clients, 48);
  assert.equal(requests.length, 48);
  assert.equal(result.protocol.providers[0]!.retries, 0);
  assert.ok(!JSON.stringify(result.protocol).includes("apiKey"));
  for (const sample of result.samples) {
    assert.equal(sample.status, "ok");
    assert.equal(sample.modelStats.calls, 1);
    assert.equal(sample.modelStats.inputTokens, 10);
    assert.deepEqual(sample.modelStats.responseModels, ["test-model"]);
    const checkpoint = result.cases.find((item) => item.id === sample.checkpoint)!;
    assert.equal(sample.correct, checkpoint.expected[sample.probe].includes(sample.decision!.action));
    assert.equal(sample.correctProbability, sample.correct ? 1 : 0);
    const first = result.samples.find((item) => item.checkpoint === sample.checkpoint && item.condition === sample.condition && item.probe === sample.probe && item.trial === 1)!;
    assert.deepEqual(sample.decision!.metadata!.request, first.decision!.metadata!.request);
    assert.deepEqual((sample.decision!.metadata!.request as any).state, diagnosticState(checkpoint, checkpoint.encoding, sample.condition));
  }
  const pairs = diagnosticPairs(result);
  assert.equal(pairs.length, 24);
  assert.ok(pairs.every((pair) => pair.valid && pair.probabilityDelta === 0));
  for (const pair of pairs) {
    const withCoordinates = structuredClone(pair.coordinates.decision!.metadata!.request) as any;
    const without = pair.topology.decision!.metadata!.request;
    for (const node of withCoordinates.state.graph.nodes) delete node.coordinates;
    assert.deepEqual(withCoordinates, without);
  }
  const html = renderDiagnostics(result);
  assert.ok(html.includes("Human-only reconstruction"));
  assert.ok(html.includes("Recognition versus action"));
  assert.ok(html.includes("With-only / without-only / error pairs"));
  assert.ok(html.includes("&quot;answer&quot;"));
  assert.ok(html.includes("Evaluator answer(s)"));
  assert.ok(!html.includes("<script"));
  assert.ok(!html.includes("data-replay"));
});

test("errors remain separate from accuracy and paired wins; other probes continue without retries", async () => {
  let calls = 0;
  const result = await runDiagnostics(options, (config) => createChoiceModel(config, async (_input, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    return request.state.graph.nodes[0].coordinates && request.questions.answer.instructions === probeInstructions.previous
      ? Response.json({ message: "offline <script>" }, { status: 503 }) : answer(request);
  }));
  assert.equal(calls, 8);
  assert.equal(result.samples.length, 8);
  const summary = summarizeSamples(result.samples);
  assert.equal(summary.valid, 7);
  assert.equal(summary.errors, 1);
  const failed = result.samples.find((sample) => sample.status === "error")!;
  assert.equal(failed.correct, null);
  assert.equal(failed.correctProbability, null);
  assert.equal(failed.decision, undefined);
  assert.ok(failed.modelStats.failure?.request);
  assert.equal(failed.modelStats.calls, 1);
  const pair = diagnosticPairs(result).find((pair) => !pair.valid)!;
  assert.equal(pair.outcome, "error");
  assert.equal(pair.probabilityDelta, null);
  const html = renderDiagnostics(result);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("offline <script>"));
  assert.throws(() => diagnosticPairs({ ...result, samples: [...result.samples, result.samples[0]!] }), /Duplicate/);
  assert.throws(() => diagnosticPairs({ ...result, samples: result.samples.slice(1) }), /Incomplete/);
  assert.equal(summarizeSamples([failed]).meanCorrectProbability, null);
});

test("invalid diagnostic options fail before requests", async () => {
  const factory = () => { throw new Error("Must not create a client"); };
  for (const invalid of [
    { ...options, solvers: ["astar"] }, { ...options, cases: ["unknown"] },
    { ...options, trials: 0 }, { ...options, maxSteps: 10 },
  ]) await assert.rejects(runDiagnostics(invalid, factory), /Diagnostic|Trials|Frozen-state/);
  assert.equal(conditions.length * probes.length * checkpointDefinitions.length * 3 * 2, 288);
});
