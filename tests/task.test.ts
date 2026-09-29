import { test } from "node:test";
import assert from "node:assert/strict";
import { runTask } from "../src/core/task.js";
import type { Task } from "../src/core/task.js";

const counter: Task<number, number> = {
  initial: 0,
  isTerminal: (state) => state === 3,
  actions: () => [1],
  transition: (state, action) => ({ state: action === 1 ? state + 1 : state, valid: action === 1 }),
  key: String,
};

test("task applies transitions and records ordered history until the terminal predicate", async () => {
  const result = await runTask(counter, (state, history) => {
    assert.equal(state, history.length);
    return { action: 1, metadata: { test: true } };
  }, 3);
  assert.equal(result.status, "solved");
  assert.equal(result.final, 3);
  assert.deepEqual(result.steps.map((step) => step.before), [0, 1, 2]);
  assert.ok(result.steps.every((step) => step.valid && step.decisionMs >= 0));
});

test("invalid moves consume budget without changing state", async () => {
  const result = await runTask(counter, () => ({ action: -1 }), 2);
  assert.equal(result.status, "budget-exhausted");
  assert.equal(result.final, 0);
  assert.equal(result.steps.length, 2);
  assert.ok(result.steps.every((step) => !step.valid));
});

test("zero budget and already-terminal initial states do not call the policy", async () => {
  const policy = () => { throw new Error("must not execute"); };
  assert.equal((await runTask(counter, policy, 0)).status, "budget-exhausted");
  assert.equal((await runTask({ ...counter, initial: 3 }, policy, 0)).status, "solved");
});

test("errors preserve partial traces; null stops; invalid budgets fail", async () => {
  const result = await runTask(counter, (state) => {
    if (state === 1) throw new Error("unavailable");
    return { action: 1 };
  }, 3);
  assert.equal(result.status, "error");
  assert.equal(result.error, "unavailable");
  assert.equal(result.steps.length, 1);
  assert.equal(result.final, 1);
  assert.equal((await runTask(counter, () => null, 3)).status, "stopped");
  for (const budget of [-1, 1.5, Infinity, NaN]) await assert.rejects(runTask(counter, () => null, budget));
});
