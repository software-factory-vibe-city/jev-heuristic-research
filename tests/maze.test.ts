import { test } from "node:test";
import assert from "node:assert/strict";
import { astar } from "../src/core/astar.js";
import { runTask } from "../src/core/task.js";
import { mazeCases } from "../src/experiments/maze/cases.js";
import { asciiState, createMazeTask, parseMaze } from "../src/experiments/maze/domain.js";
import type { Maze } from "../src/experiments/maze/domain.js";

function bfs(maze: Maze): number | null {
  const task = createMazeTask(maze);
  const queue = [{ state: task.initial, distance: 0 }];
  const seen = new Set([task.key(task.initial)]);
  for (let i = 0; i < queue.length; i++) {
    const { state, distance } = queue[i]!;
    if (task.isTerminal(state)) return distance;
    for (const action of task.actions(state)) {
      const next = task.transition(state, action).state;
      if (!seen.has(task.key(next))) {
        queue.push({ state: next, distance: distance + 1 });
        seen.add(task.key(next));
      }
    }
  }
  return null;
}

test("maze validates shape, alphabet, and unique endpoints", () => {
  for (const ascii of ["", "SG\n#", "...", "SSG", "SGG", "S?G"]) assert.throws(() => parseMaze(ascii));
  assert.equal(parseMaze("###\r\n#SG\r\n###").rows.length, 3);
  assert.deepEqual(parseMaze("\n S \n G \n").start, { x: 1, y: 0 });
});

test("maze transitions enforce walls/bounds, and ASCII observes the current position", () => {
  const maze = parseMaze("S.G");
  const task = createMazeTask(maze);
  assert.deepEqual(task.actions(task.initial), ["right"]);
  assert.equal(task.transition(task.initial, "up").valid, false);
  assert.equal(task.transition(task.initial, "left").valid, false);
  assert.deepEqual(task.transition(task.initial, "right").state, { x: 1, y: 0 });
  assert.equal(asciiState(maze, maze.start), "@.G");
  assert.equal(maze.rows[0], "S.G");
});

test("A* solves every fixed fixture optimally and its plan obeys T", async () => {
  const expected = [14, 10, 12];
  for (const [index, fixture] of mazeCases.entries()) {
    const maze = parseMaze(fixture.ascii);
    const task = createMazeTask(maze);
    const plan = astar(task, (p) => Math.abs(p.x - maze.goal.x) + Math.abs(p.y - maze.goal.y));
    assert.equal(plan.actions?.length, bfs(maze));
    assert.equal(plan.actions?.length, expected[index]);
    const run = await runTask(task, (_state, steps) => ({ action: plan.actions![steps.length]! }), plan.actions!.length);
    assert.equal(run.status, "solved");
    assert.ok(run.steps.every((step) => step.valid));
  }
});

test("A* agrees with independent BFS on seeded random maps, including unreachable goals", () => {
  let seed = 42;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let trial = 0; trial < 80; trial++) {
    const rows: string[][] = Array.from({ length: 7 }, () => Array.from({ length: 9 }, () => random() < .3 ? "#" : "."));
    rows[0]![0] = "S";
    rows[6]![8] = "G";
    const maze = parseMaze(rows.map((row) => row.join("")).join("\n"));
    const task = createMazeTask(maze);
    const plan = astar(task, (p) => Math.abs(p.x - maze.goal.x) + Math.abs(p.y - maze.goal.y));
    assert.equal(plan.actions?.length ?? null, bfs(maze));
  }
  assert.equal(astar(createMazeTask(parseMaze("S#G")), () => 0).actions, null);
  const task = createMazeTask(parseMaze("SG"));
  assert.deepEqual(astar({ ...task, initial: { x: 1, y: 0 } }, () => 0).actions, []);
});
