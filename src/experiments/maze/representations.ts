import type { Policy, Step } from "../../core/task.js";
import type { createChoiceModel } from "../../providers/system-one.js";
import { asciiState, createMazeTask, positionKey } from "./domain.js";
import type { Maze, Move, Position } from "./domain.js";
import { forcedMoveDecision, historyInstructions, moveCriteria } from "./policy.js";

export const representations = ["ascii", "graph"] as const;
export type Representation = typeof representations[number];
export const representationLabels: Record<Representation, string> = { ascii: "ASCII", graph: "Adjacency graph" };
export const representationPolicyVersion = "maze-representation-v3";
export const representationInstructions = "Choose the next single move on a shortest route from the current position to the goal. " +
  "Read the full map: walls can require moving away from the goal or backtracking from a dead end. " +
  historyInstructions;

export type GraphNode = { id: string; x: number; y: number; edges: Partial<Record<Move, string>> };
export type MazeEncoding =
  | { format: "ascii"; legend: string; grid: string }
  | { format: "adjacency-graph"; legend: string; nodes: GraphNode[] };

/** Enumerate every traversable cell and its immediate legal edges, in row-major order.
 * No traversal from the start, goal-distance computation, sorting by promise, or pruning.
 */
export function adjacencyGraph(maze: Maze): GraphNode[] {
  const task = createMazeTask(maze);
  return maze.rows.flatMap((row, y) => [...row].flatMap((cell, x) => {
    if (cell === "#") return [];
    const state = { x, y };
    return [{ id: positionKey(state), x, y, edges: Object.fromEntries(task.actions(state).map((move) =>
      [move, positionKey(task.transition(state, move).state)],
    )) }];
  }));
}

export function representationState(
  maze: Maze,
  representation: Representation,
  current: Position,
  history: readonly Step<Position, Move>[],
) {
  // Counts are a lossless summary of arrivals already present in history, supplied to BOTH arms.
  const counts = new Map([[positionKey(maze.start), 1]]);
  for (const step of history) {
    if (step.valid) counts.set(positionKey(step.after), (counts.get(positionKey(step.after)) ?? 0) + 1);
  }
  const nodes = adjacencyGraph(maze);
  const map: MazeEncoding = representation === "ascii" ? {
    format: "ascii",
    legend: "# = wall, . or space = open, S = start, G = goal, @ = current position (may cover S).",
    grid: asciiState(maze, current),
  } : {
    format: "adjacency-graph",
    legend: "Every open cell is a node. IDs are x,y. An edge maps a legal move to its destination node ID. Missing cells are walls; missing edges are blocked. All edges cost one move.",
    nodes,
  };
  return {
    map,
    coordinates: "Zero-based x (column) increases right; y (row) increases down.",
    dimensions: { width: maze.rows[0]!.length, height: maze.rows.length },
    start: { ...maze.start },
    current: { ...current },
    goal: { ...maze.goal },
    legal_moves: [...createMazeTask(maze).actions(current)],
    history: history.map((step) => ({
      from: { ...step.before }, action: step.action, to: { ...step.after }, valid: step.valid,
    })),
    visit_counts: nodes.filter(({ id }) => counts.has(id)).map(({ x, y, id }) => ({ x, y, count: counts.get(id)! })),
    visit_count_definition: "Arrivals per cell: the initial position counts once; each valid move adds one; invalid moves do not add arrivals. Unlisted cells have zero arrivals.",
  };
}

export function representationPolicy(
  maze: Maze,
  model: ReturnType<typeof createChoiceModel>,
  representation: Representation,
): Policy<Position, Move> {
  return (current, history) => {
    const state = representationState(maze, representation, current, history);
    if (!state.legal_moves.length) return null;
    const forced = forcedMoveDecision(state.legal_moves);
    if (forced) return forced;
    // Identical question and legal choices for both encodings at a given position/history.
    return model.decide<Move>(state, representationInstructions, moveCriteria(state.legal_moves));
  };
}
