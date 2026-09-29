import { test } from "node:test";
import assert from "node:assert/strict";
import type { SystemOneRequest } from "@typesafe-ai/sdk";
import type { Step } from "../src/core/task.js";
import { createChoiceModel, providerConfig } from "../src/providers/system-one.js";
import { mazeCases } from "../src/experiments/maze/cases.js";
import { createMazeTask, moves, parseMaze, positionKey } from "../src/experiments/maze/domain.js";
import type { Move, Position } from "../src/experiments/maze/domain.js";
import { adjacencyGraph, representationPolicy, representationState } from "../src/experiments/maze/representations.js";
import { runMaze, scheduleRuns } from "../src/experiments/maze/experiment.js";
import { representationPairs, representationSummary } from "../src/experiments/maze/comparison.js";
import { renderRepresentationExperiment } from "../src/experiments/maze/representation-experiment.js";

const rightAnswer = (labels: readonly string[]) => Response.json({
  model: "test-model",
  answers: { move: { type: "choice", choice: "right", confidence: 1, probabilities: Object.fromEntries(labels.map((label) => [label, label === "right" ? 1 : 0])) } },
  usage: { input_tokens: 10, output_tokens: 1 },
});

test("graph contains all and only legal edges, including isolated cells and dead ends", () => {
  for (const ascii of [...mazeCases.map((item) => item.ascii), "S#G", " S \n G "]) {
    const maze = parseMaze(ascii);
    const task = createMazeTask(maze);
    const graph = adjacencyGraph(maze);
    assert.equal(graph.length, maze.rows.join("").replaceAll("#", "").length);
    assert.equal(new Set(graph.map((node) => node.id)).size, graph.length);
    for (const node of graph) {
      assert.equal(node.id, positionKey(node));
      assert.notEqual(maze.rows[node.y]![node.x], "#");
      assert.deepEqual(Object.keys(node.edges), task.actions(node));
      for (const action of moves) {
        const next = task.transition(node, action);
        assert.equal(node.edges[action], next.valid ? positionKey(next.state) : undefined);
      }
    }
    // Bounds + omitted cells reconstruct exactly the original obstacle map.
    const ids = new Set(graph.map((node) => node.id));
    for (const [y, row] of maze.rows.entries()) for (const [x, cell] of [...row].entries()) {
      assert.equal(ids.has(positionKey({ x, y })), cell !== "#");
    }
  }
});

test("arms differ only in map; visit counts summarize arrivals without changing legality", () => {
  const maze = parseMaze("S.G");
  const task = createMazeTask(maze);
  const history: Step<Position, Move>[] = [];
  let current = maze.start;
  for (const action of ["right", "left", "up"] as const) {
    const transition = task.transition(current, action);
    history.push({ before: current, after: transition.state, action, valid: transition.valid, decisionMs: 0 });
    current = transition.state;
  }
  const { map: ascii, ...sharedAscii } = representationState(maze, "ascii", current, history);
  const { map: graph, ...sharedGraph } = representationState(maze, "graph", current, history);
  assert.deepEqual(sharedAscii, sharedGraph);
  assert.equal(ascii.format, "ascii");
  assert.equal(graph.format, "adjacency-graph");
  assert.deepEqual(sharedAscii.visit_counts, [{ x: 0, y: 0, count: 2 }, { x: 1, y: 0, count: 1 }]);
  assert.deepEqual(sharedAscii.legal_moves, ["right"]); // Visited destinations are NOT masked.
  assert.equal(sharedAscii.history.length, 3);
  assert.equal(sharedAscii.history[2]!.valid, false);
});

test("paired policies send identical questions, model selection, and non-map state fields", async () => {
  const requests: SystemOneRequest[] = [];
  const model = createChoiceModel(providerConfig("local", {}), async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    requests.push(request);
    return rightAnswer(Object.keys(request.questions.move.criteria));
  });
  const maze = parseMaze("S.G\n.##");
  await representationPolicy(maze, model, "ascii")(maze.start, []);
  await representationPolicy(maze, model, "graph")(maze.start, []);
  assert.deepEqual(requests[0]!.questions, requests[1]!.questions);
  assert.equal(requests[0]!.model, requests[1]!.model);
  const question = requests[0]!.questions.move!;
  assert.equal(question.type, "choice");
  assert.deepEqual(Object.keys(question.type === "choice" ? question.criteria : {}), ["right", "down"]);
  const stripMap = (request: SystemOneRequest) => {
    const { map: _map, ...shared } = request.state as Record<string, unknown>;
    return shared;
  };
  assert.deepEqual(stripMap(requests[0]!), stripMap(requests[1]!));
});

test("schedule alternates arm order, reverses providers, and never duplicates A*", () => {
  const solvers = ["astar", "local", "jev"];
  const first = scheduleRuns(solvers, 1, 0, "representation");
  assert.deepEqual(first.map((run) => run.representation), [null, "ascii", "graph", "ascii", "graph"]);
  assert.deepEqual(scheduleRuns(solvers, 1, 1, "representation").filter((run) => run.solver === "local").map((run) => run.representation), ["graph", "ascii"]);
  const second = scheduleRuns(solvers, 2, 0, "representation");
  assert.equal(second[0]!.solver, "jev");
  assert.deepEqual(second.filter((run) => run.solver === "local").map((run) => run.representation), ["graph", "ascii"]);
  assert.equal(second.filter((run) => run.solver === "astar").length, 1);
  assert.equal(scheduleRuns(solvers, 1, 0, "baseline").length, 3);
  assert.deepEqual(solvers, ["astar", "local", "jev"]);
});

test("paired runs start fresh, use equal budgets, preserve evidence, and pair across reversed order", async () => {
  const requests: ReturnType<typeof representationState>[] = [];
  let clients = 0;
  const result = await runMaze({ solvers: ["astar", "local"], cases: ["corridor"], trials: 2, maxSteps: 2 }, "representation", (config) => {
    clients++;
    return createChoiceModel(config, async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      requests.push(request.state);
      return rightAnswer(Object.keys(request.questions.move.criteria));
    });
  });
  assert.equal(clients, 4);
  assert.equal(result.protocol.actionSpace, "legal-only");
  assert.equal(result.protocol.policyVersion, "maze-representation-v3");
  assert.equal(result.protocol.singleLegalMove, "forced");
  assert.equal(result.cases[0]!.runs.length, 6);
  assert.ok(result.cases[0]!.runs.every((run) => run.trace.steps.length === 2 && run.trace.status === "budget-exhausted"));
  assert.deepEqual(requests.map((state) => state.history.length), [1, 1, 1, 1]);
  assert.ok(requests.every((state) => state.legal_moves.length >= 2));
  assert.ok(result.cases[0]!.runs.filter((run) => run.solver === "astar").every((run) => run.metrics.forcedMoves === 0));
  const pairs = representationPairs(result);
  assert.equal(pairs.length, 2);
  for (const pair of pairs) {
    assert.equal(pair.ascii.trial, pair.graph.trial);
    assert.deepEqual(pair.ascii.trace.initial, pair.graph.trace.initial);
    assert.equal(pair.ascii.modelStats!.calls, 1);
    assert.equal(pair.graph.modelStats!.calls, 1);
    assert.equal(pair.ascii.metrics.forcedMoves, 1);
    assert.equal(pair.graph.metrics.forcedMoves, 1);
  }
  assert.equal(representationSummary(result)[0]!.neitherSolved, 2);
  const html = renderRepresentationExperiment(result);
  assert.ok(html.includes("Adjacency graph"));
  assert.ok(html.includes("Model input before move 2"));
  assert.ok(html.includes("&quot;adjacency-graph&quot;"));
  assert.equal((html.match(/data-pair=/g) ?? []).length, 2);
  assert.ok(html.includes("Only legal directions"));
  assert.ok(html.includes("Forced move · only legal direction; no model call."));
  assert.ok(html.includes("Forced move (no model request)"));
  assert.ok(!html.includes("Model input for first decision"));
  assert.ok(!html.includes("Even a single legal option is sent to the model"));
  assert.ok(html.includes("1 forced"));
  assert.ok(html.includes(">right<i>"));
  assert.ok(html.includes(">left<i>"));
  assert.ok(!html.includes(">up<i>"));
  assert.ok(!html.includes(">down<i>"));
  // Historical full-choice traces must retain their original probability bars and protocol.
  const legacy = structuredClone(result);
  delete legacy.protocol.actionSpace;
  delete legacy.protocol.singleLegalMove;
  legacy.protocol.policyVersion = "maze-representation-v1";
  for (const run of legacy.cases[0]!.runs.filter((run) => run.solver !== "astar")) {
    delete run.metrics.forcedMoves;
    run.metrics.modelCalls = run.modelStats!.calls = 2;
    for (const step of run.trace.steps) {
      step.metadata = { answer: { type: "choice", choice: step.action, confidence: 1,
        probabilities: Object.fromEntries(moves.map((move) => [move, move === step.action ? 1 : 0])),
      } };
    }
  }
  const legacyHtml = renderRepresentationExperiment(legacy);
  assert.ok(legacyHtml.includes("All four directions remain answer options"));
  assert.ok(legacyHtml.includes("Even a single legal option is sent to the model"));
  assert.ok(!legacyHtml.includes("Forced move (no model request)"));
  assert.ok(legacyHtml.includes(">up<i>"));
  assert.ok(legacyHtml.includes(">down<i>"));
  // Infrastructure errors do not turn an unsuccessful pair into evidence for the other arm.
  pairs[0]!.ascii.trace.status = "error";
  pairs[0]!.graph.trace.status = "solved";
  const summary = representationSummary(result)[0]!;
  assert.equal(summary.errorPairs, 1);
  assert.equal(summary.graphOnly, 0);
});

test("an HTTP failure is saved per arm, without fallback or preventing its paired control", async () => {
  const result = await runMaze({ solvers: ["local"], cases: ["detour"], trials: 1, maxSteps: 2 }, "representation", (config) =>
    createChoiceModel(config, async () => Response.json({ message: "offline" }, { status: 503 })),
  );
  const runs = result.cases[0]!.runs;
  assert.equal(runs.length, 2);
  for (const run of runs) {
    assert.equal(run.trace.status, "error");
    assert.equal(run.trace.steps.length, 1);
    assert.equal(run.trace.steps[0]!.metadata?.source, "forced");
    assert.equal(run.metrics.forcedMoves, 1);
    assert.equal(run.modelStats!.calls, 1);
    assert.ok(run.modelStats!.failure?.request);
  }
  assert.equal(representationSummary(result)[0]!.errorPairs, 1);
});
