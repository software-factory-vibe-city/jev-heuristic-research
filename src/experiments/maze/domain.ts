import type { Task } from "../../core/task.js";

export interface Position { x: number; y: number }
export type Move = "up" | "right" | "down" | "left";
export interface Maze {
  rows: string[];
  start: Position;
  goal: Position;
}
export const deltas: Record<Move, Position> = {
  up: { x: 0, y: -1 }, right: { x: 1, y: 0 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 },
};
export const moves = Object.keys(deltas) as Move[];
export const positionKey = (p: Position) => `${p.x},${p.y}`;
export const samePosition = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

export function parseMaze(ascii: string): Maze {
  const rows = ascii.split(/\r?\n/);
  // Strip blank boundary lines, not open cells represented by spaces.
  while (rows[0] === "") rows.shift();
  while (rows.at(-1) === "") rows.pop();
  if (!rows[0]?.length || rows.some((row) => row.length !== rows[0]!.length)) {
    throw new Error("Maze must be a nonempty rectangle");
  }
  let start: Position | undefined;
  let goal: Position | undefined;
  rows.forEach((row, y) => [...row].forEach((cell, x) => {
    if (!"# .SG".includes(cell)) throw new Error(`Unknown maze cell: ${cell}`);
    if (cell === "S") {
      if (start) throw new Error("Maze must have exactly one S");
      start = { x, y };
    }
    if (cell === "G") {
      if (goal) throw new Error("Maze must have exactly one G");
      goal = { x, y };
    }
  }));
  if (!start || !goal) throw new Error("Maze needs one S and one G");
  return { rows, start, goal };
}

export function createMazeTask(maze: Maze): Task<Position, Move> {
  const transition = (state: Position, action: Move) => {
    const delta = deltas[action];
    if (!delta) return { state, valid: false };
    const next = { x: state.x + delta.x, y: state.y + delta.y };
    const cell = maze.rows[next.y]?.[next.x];
    const valid = cell !== undefined && cell !== "#";
    return { state: valid ? next : state, valid };
  };
  return {
    initial: maze.start,
    key: positionKey,
    isTerminal: (state) => samePosition(state, maze.goal),
    actions: (state) => moves.filter((move) => transition(state, move).valid),
    transition,
  };
}

export function asciiState(maze: Maze, current: Position): string {
  return maze.rows.map((row, y) => [...row].map((cell, x) =>
    x === current.x && y === current.y ? "@" : cell,
  ).join("")).join("\n");
}
