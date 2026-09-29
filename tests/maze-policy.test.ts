import { test } from "node:test";
import assert from "node:assert/strict";
import type { SystemOneRequest } from "@typesafe-ai/sdk";
import { runTask } from "../src/core/task.js";
import { createChoiceModel, providerConfig } from "../src/providers/system-one.js";
import { createMazeTask, parseMaze } from "../src/experiments/maze/domain.js";
import type { Move, Position } from "../src/experiments/maze/domain.js";
import { historyInstructions, mazePolicy } from "../src/experiments/maze/policy.js";
import { representationPolicy } from "../src/experiments/maze/representations.js";

const policies: Record<string, typeof mazePolicy> = {
  baseline: mazePolicy,
  ascii: (maze, model) => representationPolicy(maze, model, "ascii"),
  graph: (maze, model) => representationPolicy(maze, model, "graph"),
};

for (const [name, createPolicy] of Object.entries(policies)) {
  test(`${name}: choices follow current legality, retain backtracking, and share strong history instructions`, async () => {
    const maze = parseMaze("S.G\n.##");
    const task = createMazeTask(maze);
    const requests: SystemOneRequest[] = [];
    // Enter a dead end, take its sole exit without a call, then choose the other route.
    const script: Move[] = ["down", "up", "right", "right"];
    const model = createChoiceModel(providerConfig("local", {}), async (_input, init) => {
      const request = JSON.parse(String(init?.body)) as SystemOneRequest;
      const state = request.state as unknown as { current: Position; legal_moves: Move[]; history: unknown[] };
      const question = request.questions.move!;
      assert.equal(question.type, "choice");
      if (question.type !== "choice") throw new Error("Expected choice");
      const labels = Object.keys(question.criteria);
      assert.deepEqual(labels, task.actions(state.current));
      assert.deepEqual(labels, state.legal_moves);
      assert.ok(labels.length >= 2, "The local API requires at least two options");
      assert.ok(String(question.instructions).includes(historyInstructions));
      assert.ok(String(question.instructions).includes("NEVER repeat an unsuccessful loop"));
      const action = script[state.history.length]!;
      assert.ok(labels.includes(action));
      requests.push(request);
      return Response.json({
        model: "test-model",
        answers: { move: { type: "choice", choice: action, confidence: 1,
          probabilities: Object.fromEntries(labels.map((label) => [label, label === action ? 1 : 0])),
        } },
        usage: { input_tokens: 10, output_tokens: 1 },
      });
    });
    const run = await runTask(task, createPolicy(maze, model), script.length);
    assert.equal(run.status, "solved");
    assert.deepEqual(run.steps.map((step) => step.action), script);
    assert.ok(run.steps.every((step) => step.valid));
    assert.equal(model.stats.calls, script.length - 1);
    assert.equal(model.stats.inputTokens, 30);
    assert.equal(model.stats.outputTokens, 3);
    assert.deepEqual(run.steps[1]!.metadata, { source: "forced", reason: "only-legal-move", legalMoves: ["up"] });
    const states = requests.map((request) => request.state as Record<string, unknown>);
    assert.deepEqual(states.map((state) => (state.history as unknown[]).length), [0, 2, 3]);
    assert.deepEqual((states[1]!.history as unknown[])[1], {
      from: { x: 0, y: 1 }, action: "up", to: { x: 0, y: 0 }, valid: true,
    });
    if (name !== "baseline") {
      assert.deepEqual(states[1]!.visit_counts, [{ x: 0, y: 0, count: 2 }, { x: 0, y: 1, count: 1 }]);
    }
    assert.deepEqual(requests.map((request) => {
      const question = request.questions.move!;
      return question.type === "choice" ? Object.keys(question.criteria) : [];
    }), [["right", "down"], ["right", "down"], ["right", "left"]]);
    // "down" remains offered after returning: the harness does not enforce the loop-avoidance instruction.
  });
}

test("forced moves count against budgets, can reach the goal, and never claim model evidence for either provider", async () => {
  for (const createPolicy of Object.values(policies)) {
    for (const provider of ["local", "jev"] as const) {
      for (const [ascii, budget, status, attempts] of [
        ["S.G", 1, "budget-exhausted", 1],
        ["SG", 5, "solved", 1],
        ["S.#G", 5, "budget-exhausted", 5], // Two-cell forced loop: no hidden loop pruning or free steps.
      ] as const) {
        const maze = parseMaze(ascii);
        const model = createChoiceModel(providerConfig(provider, { TYPESAFE_API_KEY: "test" }), async () => {
          throw new Error("Forced moves must not call the model");
        });
        const run = await runTask(createMazeTask(maze), createPolicy(maze, model), budget);
        assert.equal(run.status, status);
        assert.equal(run.steps.length, attempts);
        assert.equal(model.stats.calls, 0);
        assert.equal(model.stats.inputTokens, 0);
        assert.equal(model.stats.outputTokens, 0);
        assert.deepEqual(model.stats.responseModels, []);
        for (const step of run.steps) {
          assert.equal(step.valid, true);
          assert.deepEqual(step.metadata, { source: "forced", reason: "only-legal-move", legalMoves: [step.action] });
        }
      }
    }
  }
});

test("all maze policies stop without a request if no legal move exists", async () => {
  const maze = parseMaze("S#G");
  for (const createPolicy of Object.values(policies)) {
    const model = createChoiceModel(providerConfig("local", {}), async () => {
      throw new Error("No request should be sent");
    });
    const run = await runTask(createMazeTask(maze), createPolicy(maze, model), 5);
    assert.equal(run.status, "stopped");
    assert.equal(run.steps.length, 0);
    assert.equal(model.stats.calls, 0);
  }
});
