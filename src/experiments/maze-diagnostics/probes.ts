import { createMazeTask, positionKey } from "../maze/domain.js";
import { historyInstructions } from "../maze/policy.js";
import type { FrozenCheckpoint } from "./checkpoints.js";
import type { Encoding } from "./encoding.js";

export const probes = ["previous", "unvisited", "dead-end", "action"] as const;
export type Probe = typeof probes[number];
export const probeLabels: Record<Probe, string> = {
  previous: "Previous node", unvisited: "Unvisited neighbor", "dead-end": "Dead-end neighbor", action: "Next action",
};
export const probeInstructions: Record<Probe, string> = {
  previous: "Which node did the agent come from on the most recent transition in history? Choose none if the history is empty. This is a factual question, not a request to move.",
  unvisited: "Which legal neighboring node has never been visited? Choose none if all have been visited, or multiple if more than one has never been visited. This is a factual question, not a request to move.",
  "dead-end": "Which legal neighboring node is a dead end, defined as having exactly one neighbor in the full graph? Choose none if no legal neighbor qualifies, or multiple if more than one qualifies. This is a factual question, not a request to move.",
  action: "Choose the next destination node on a shortest route from the current node to the goal node. Read the full graph: reaching the goal can require moving away from it or backtracking from a dead end. " + historyInstructions,
};

export function probeCriteria(checkpoint: Pick<FrozenCheckpoint, "current">, encoding: Encoding, probe: Probe): Record<string, string> {
  const current = encoding.byPosition[positionKey(checkpoint.current)];
  const neighbors = encoding.nodes.find((node) => node.id === current)!.neighbors;
  const criteria = Object.fromEntries(neighbors.map((id) => [id, probe === "action" ? `Move to node ${id}.` : `Node ${id}.`]));
  if (probe !== "action") criteria.none = "No qualifying node.";
  if (probe === "unvisited" || probe === "dead-end") criteria.multiple = "More than one legal neighboring node qualifies.";
  return criteria;
}

/** Evaluator only. None of these answers or distances is included in model inputs. */
export function expectedAnswers(checkpoint: FrozenCheckpoint, encoding: Encoding, probe: Probe): string[] {
  const id = (position: { x: number; y: number }) => encoding.byPosition[positionKey(position)]!;
  const current = id(checkpoint.current);
  const neighbors = encoding.nodes.find((node) => node.id === current)!.neighbors;
  const categorical = (matches: string[]) => matches.length === 0 ? ["none"] : matches.length === 1 ? matches : ["multiple"];
  if (probe === "previous") return checkpoint.history.length ? [id(checkpoint.history.at(-1)!.before)] : ["none"];
  if (probe === "unvisited") {
    const visited = new Set([id(checkpoint.maze.start), ...checkpoint.history.filter((step) => step.valid).map((step) => id(step.after))]);
    return categorical(neighbors.filter((node) => !visited.has(node)));
  }
  if (probe === "dead-end") return categorical(neighbors.filter((id) => encoding.nodes.find((node) => node.id === id)!.neighbors.length === 1));
  const task = createMazeTask(checkpoint.maze);
  const distances = new Map([[positionKey(checkpoint.maze.goal), 0]]);
  const queue = [checkpoint.maze.goal];
  for (let i = 0; i < queue.length; i++) {
    const position = queue[i]!;
    for (const action of task.actions(position)) {
      const next = task.transition(position, action).state;
      const key = positionKey(next);
      if (!distances.has(key)) {
        distances.set(key, distances.get(positionKey(position))! + 1);
        queue.push(next);
      }
    }
  }
  const scored = neighbors.map((id) => ({ id, distance: distances.get(positionKey(encoding.nodes.find((node) => node.id === id)!.position)) ?? Infinity }));
  const best = Math.min(...scored.map((node) => node.distance));
  if (!Number.isFinite(best)) throw new Error("Diagnostic goal is unreachable");
  return scored.filter((node) => node.distance === best).map((node) => node.id);
}
