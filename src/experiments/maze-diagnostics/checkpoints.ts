import type { Step } from "../../core/task.js";
import { mazeCases } from "../maze/cases.js";
import { createMazeTask, parseMaze, samePosition } from "../maze/domain.js";
import type { Maze, Move, Position } from "../maze/domain.js";

export interface CheckpointDefinition {
  id: string;
  mazeId: typeof mazeCases[number]["id"];
  title: string;
  description: string;
  actions: readonly Move[];
  current: Position;
}

/** Fixed prefixes from v3 traces, reconstructed without depending on git-ignored reports. */
export const checkpointDefinitions: readonly CheckpointDefinition[] = [
  { id: "corridor-before-turn", mazeId: "corridor", title: "Corridor / before the turn",
    description: "The first ASCII/graph disagreement: continue toward the bend or turn back?",
    actions: ["right", "right", "right", "right", "right"], current: { x: 6, y: 1 } },
  { id: "corridor-after-loop", mazeId: "corridor", title: "Corridor / after one loop",
    description: "Same cell after the ASCII trace went left and immediately returned.",
    actions: ["right", "right", "right", "right", "right", "left", "right"], current: { x: 6, y: 1 } },
  { id: "detour-first-choice", mazeId: "detour", title: "Detour / first model choice",
    description: "After the forced first move, continue away from the goal's row or return to the start?",
    actions: ["down"], current: { x: 1, y: 2 } },
  { id: "detour-after-loop", mazeId: "detour", title: "Detour / after one loop",
    description: "Same cell after the graph trace returned to the start and was forced down again.",
    actions: ["down", "up", "down"], current: { x: 1, y: 2 } },
  { id: "fork-start", mazeId: "fork", title: "Fork / initial choice",
    description: "Empty history: choose between the route to the goal and the tempting dead-end corridor.",
    actions: [], current: { x: 1, y: 1 } },
  { id: "fork-after-dead-end", mazeId: "fork", title: "Fork / after the dead end",
    description: "After entering the dead end and taking its sole exit, continue backtracking or re-enter it?",
    actions: ["right", "right", "right", "right", "right", "right", "left"], current: { x: 6, y: 1 } },
];

export interface FrozenCheckpoint extends CheckpointDefinition {
  maze: Maze;
  history: Step<Position, Move>[];
}

export function freezeCheckpoint(definition: CheckpointDefinition): FrozenCheckpoint {
  const fixture = mazeCases.find((item) => item.id === definition.mazeId);
  if (!fixture) throw new Error(`Unknown checkpoint maze: ${definition.mazeId}`);
  const maze = parseMaze(fixture.ascii);
  const task = createMazeTask(maze);
  let current = maze.start;
  const history: Step<Position, Move>[] = [];
  for (const action of definition.actions) {
    if (task.isTerminal(current)) throw new Error("Checkpoint history continues after the goal");
    const next = task.transition(current, action);
    if (!next.valid) throw new Error(`Invalid checkpoint move: ${action}`);
    history.push({ before: current, after: next.state, action, valid: true, decisionMs: 0 });
    current = next.state;
  }
  if (!samePosition(current, definition.current) || task.isTerminal(current)) throw new Error(`Invalid checkpoint position: ${definition.id}`);
  if (task.actions(current).length < 2) throw new Error("Diagnostics require at least two legal destinations");
  return { ...definition, current, maze, history };
}
