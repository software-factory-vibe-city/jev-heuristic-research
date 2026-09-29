import { createMazeTask, positionKey } from "../maze/domain.js";
import type { Maze, Move, Position } from "../maze/domain.js";
import type { Step } from "../../core/task.js";

/** The same observable state contract supports frozen probes and evolving rollouts. */
export interface MazeObservation { maze: Maze; current: Position; history: readonly Step<Position, Move>[] }

export const encodingSeed = 20260928;
export const conditions = ["coordinates", "topology"] as const;
export type Condition = typeof conditions[number];
export const conditionLabels: Record<Condition, string> = { coordinates: "With coordinates", topology: "Without coordinates" };
export interface NodeMapping { id: string; position: Position; neighbors: string[] }
export interface Encoding { seed: number; nodes: NodeMapping[]; byPosition: Record<string, string> }
type InputNode = { id: string; neighbors: string[] } | { id: string; neighbors: string[]; coordinates: { x: number; y: number } };

/** Deterministic Fisher-Yates permutations, unrelated to routes or goal distances. */
export function createEncoding(checkpoint: { mazeId: string; maze: Maze }, seed = encodingSeed): Encoding {
  let state = seed >>> 0;
  for (const char of checkpoint.mazeId) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const shuffled = <T>(input: readonly T[]) => {
    const result = [...input];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [result[i], result[j]] = [result[j]!, result[i]!];
    }
    return result;
  };
  const positions = checkpoint.maze.rows.flatMap((row, y) => [...row].flatMap((cell, x) => cell === "#" ? [] : [{ x, y }]));
  const ids = shuffled(positions.map((_position, i) => `n${String(i + 1).padStart(2, "0")}`));
  const byPosition = Object.fromEntries(positions.map((position, i) => [positionKey(position), ids[i]!]));
  const task = createMazeTask(checkpoint.maze);
  // Independent node-order shuffle; neighbors and choices use opaque-ID order, not compass order.
  const nodes = shuffled(positions).map((position) => ({
    id: byPosition[positionKey(position)]!, position,
    neighbors: task.actions(position).map((action) => byPosition[positionKey(task.transition(position, action).state)]!).sort(),
  }));
  return { seed, nodes, byPosition };
}

export function diagnosticState(checkpoint: MazeObservation, encoding: Encoding, condition: Condition) {
  const id = (position: Position) => encoding.byPosition[positionKey(position)]!;
  const current = id(checkpoint.current);
  const counts = new Map([[id(checkpoint.maze.start), 1]]);
  for (const step of checkpoint.history) if (step.valid) counts.set(id(step.after), (counts.get(id(step.after)) ?? 0) + 1);
  const nodes = encoding.nodes.map<InputNode>((node) => condition === "coordinates"
    ? { id: node.id, neighbors: [...node.neighbors], coordinates: { ...node.position } }
    : { id: node.id, neighbors: [...node.neighbors] });
  return {
    graph: { description: "Complete undirected graph. Every edge costs one move. Node IDs are arbitrary labels; neighbors lists give all legal transitions.", nodes },
    start: id(checkpoint.maze.start), current, goal: id(checkpoint.maze.goal),
    legal_destinations: [...encoding.nodes.find((node) => node.id === current)!.neighbors],
    history: checkpoint.history.map((step) => ({ from: id(step.before), to: id(step.after), valid: step.valid })),
    visit_counts: [...counts].sort(([a], [b]) => a.localeCompare(b)).map(([node, count]) => ({ node, count })),
    visit_count_definition: "Arrivals per node: start counts once; each valid transition adds one. Unlisted nodes have zero arrivals.",
  };
}
