import type { Task } from "./task.js";

export interface SearchResult<S, A> {
  actions: A[] | null;
  expanded: S[];
}

/** Unit-cost A*. An admissible, consistent h (e.g. Manhattan distance) gives a shortest path.
 * A simple array frontier is deliberate: these are tiny, inspectable experiments, not a speed benchmark.
 */
export function astar<S, A>(task: Task<S, A>, heuristic: (state: S) => number): SearchResult<S, A> {
  type Node = { state: S; g: number; f: number; parent?: Node; action?: A };
  const open: Node[] = [{ state: task.initial, g: 0, f: heuristic(task.initial) }];
  const best = new Map([[task.key(task.initial), 0]]);
  const expanded: S[] = [];
  while (open.length) {
    // Stable ties preserve task.actions order.
    open.sort((a, b) => a.f - b.f);
    const current = open.shift()!;
    if (current.g !== best.get(task.key(current.state))) continue;
    if (task.isTerminal(current.state)) {
      const actions: A[] = [];
      let node = current;
      while (node.parent) {
        actions.push(node.action!);
        node = node.parent;
      }
      return { actions: actions.reverse(), expanded };
    }
    expanded.push(current.state);
    for (const action of task.actions(current.state)) {
      const next = task.transition(current.state, action);
      if (!next.valid) continue;
      const g = current.g + 1;
      const key = task.key(next.state);
      if (g >= (best.get(key) ?? Infinity)) continue;
      best.set(key, g);
      open.push({ state: next.state, g, f: g + heuristic(next.state), parent: current, action });
    }
  }
  return { actions: null, expanded };
}
