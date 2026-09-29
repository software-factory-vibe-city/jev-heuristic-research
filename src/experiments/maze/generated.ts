import { seededRandom, shuffle } from "../../core/random.js";
import { createMazeTask, parseMaze, positionKey } from "./domain.js";
import type { Maze } from "./domain.js";

export const generatorVersion = "seeded-maze-v1";
export const mazeFamilies = ["corridors", "branching", "loops", "rooms"] as const;
export type MazeFamily = typeof mazeFamilies[number];
export const familyDescriptions: Record<MazeFamily, string> = {
  corridors: "Randomized depth-first spanning tree; tends to long corridors. Junction counts are measured, not guaranteed.",
  branching: "Randomized Prim frontier-edge spanning tree; tends to shorter branches and more dead ends.",
  loops: "The same DFS base as corridors, then open 35% (rounded up) of remaining logical-cell walls to introduce cycles.",
  rooms: "The same DFS base as corridors, then carve seeded rectangular rooms spanning 2–3 logical cells per dimension.",
};
export interface MazeSpec { family: MazeFamily; width: number; height: number; seed: number }

/** Pure generation. Logical dimensions become a (2w+1) × (2h+1) raster. Endpoints never depend on a solver. */
export function generateMaze(spec: MazeSpec): Maze {
  const { family, width, height, seed } = spec;
  if (!mazeFamilies.includes(family)) throw new Error(`Unknown maze family: ${family}`);
  for (const value of [width, height]) if (!Number.isSafeInteger(value) || value < 2 || value > 64) throw new Error("Logical maze dimensions must be integers from 2 to 64");
  const random = seededRandom(seed);
  const count = width * height;
  const neighbors = (node: number) => {
    const x = node % width, y = Math.floor(node / width);
    return [y > 0 ? node - width : -1, x < width - 1 ? node + 1 : -1,
      y < height - 1 ? node + width : -1, x > 0 ? node - 1 : -1].filter((value) => value >= 0);
  };
  const key = (a: number, b: number) => `${Math.min(a, b)}:${Math.max(a, b)}`;
  const edges = new Set<string>();
  const start = Math.floor(random() * count);
  const visited = new Set([start]);
  if (family === "branching") {
    const frontier: [number, number][] = neighbors(start).map((next) => [start, next]);
    while (frontier.length) {
      const index = Math.floor(random() * frontier.length);
      const [from, to] = frontier[index]!;
      frontier[index] = frontier.at(-1)!; frontier.pop();
      if (visited.has(to)) continue;
      edges.add(key(from, to)); visited.add(to);
      for (const next of neighbors(to)) if (!visited.has(next)) frontier.push([to, next]);
    }
  } else {
    const stack = [start];
    while (stack.length) {
      const from = stack.at(-1)!;
      const candidates = neighbors(from).filter((next) => !visited.has(next));
      if (!candidates.length) { stack.pop(); continue; }
      const to = candidates[Math.floor(random() * candidates.length)]!;
      edges.add(key(from, to)); visited.add(to); stack.push(to);
    }
  }
  if (family === "loops") {
    const closed: string[] = [];
    for (let node = 0; node < count; node++) for (const next of neighbors(node)) {
      if (next > node && !edges.has(key(node, next))) closed.push(key(node, next));
    }
    for (const edge of shuffle(closed, random).slice(0, Math.ceil(closed.length * 0.35))) edges.add(edge);
  }
  const rows = Array.from({ length: height * 2 + 1 }, () => Array<string>(width * 2 + 1).fill("#"));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows[y * 2 + 1]![x * 2 + 1] = ".";
  for (const edge of edges) {
    const [a, b] = edge.split(":").map(Number) as [number, number];
    rows[Math.floor(a / width) + Math.floor(b / width) + 1]![(a % width) + (b % width) + 1] = ".";
  }
  if (family === "rooms") {
    for (let i = 0; i < Math.max(1, Math.floor(count / 12)); i++) {
      const w = Math.min(width, 2 + Math.floor(random() * 2)), h = Math.min(height, 2 + Math.floor(random() * 2));
      const x0 = Math.floor(random() * (width - w + 1)), y0 = Math.floor(random() * (height - h + 1));
      for (let y = 2 * y0 + 1; y <= 2 * (y0 + h - 1) + 1; y++) {
        for (let x = 2 * x0 + 1; x <= 2 * (x0 + w - 1) + 1; x++) rows[y]![x] = ".";
      }
    }
  }
  rows[1]![1] = "S";
  rows[height * 2 - 1]![width * 2 - 1] = "G";
  return parseMaze(rows.map((row) => row.join("")).join("\n"));
}

/** Evaluator metadata only. Never add these measurements to a model request. */
export function mazeTopology(maze: Maze) {
  const task = createMazeTask(maze);
  const cells = maze.rows.flatMap((row, y) => [...row].flatMap((cell, x) => cell === "#" ? [] : [{ x, y }]));
  const degrees = cells.map((position) => task.actions(position).length);
  const edges = degrees.reduce((sum, degree) => sum + degree, 0) / 2;
  const seen = new Set<string>();
  let components = 0;
  for (const cell of cells) {
    if (seen.has(positionKey(cell))) continue;
    components++;
    const queue = [cell]; seen.add(positionKey(cell));
    for (const current of queue) for (const action of task.actions(current)) {
      const next = task.transition(current, action).state, key = positionKey(next);
      if (!seen.has(key)) { seen.add(key); queue.push(next); }
    }
  }
  const distances = new Map([[positionKey(maze.start), 0]]), queue = [maze.start];
  for (const current of queue) for (const action of task.actions(current)) {
    const next = task.transition(current, action).state, key = positionKey(next);
    if (!distances.has(key)) { distances.set(key, distances.get(positionKey(current))! + 1); queue.push(next); }
  }
  return { openCells: cells.length, edges, components, cycleRank: edges - cells.length + components,
    deadEnds: degrees.filter((degree) => degree === 1).length, junctions: degrees.filter((degree) => degree >= 3).length,
    degreeCounts: Object.fromEntries([0, 1, 2, 3, 4].map((degree) => [degree, degrees.filter((value) => value === degree).length])),
    optimalMoves: distances.get(positionKey(maze.goal)) ?? null };
}
