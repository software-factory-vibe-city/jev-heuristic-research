# Generalized heuristics

**Hypothesis:** a [System One model](https://docs.typesafe.ai/concepts/system-one) amortizes the creation of task-specific semantic heuristics across arbitrary problem domains.

We’re testing this through small, visual experiments:

```text
S₀ = initial state          G(S) = terminal-state predicate
T(S, a) → S′               π(S) → action
Task = repeatedly apply T(S, π(S)) until G(S), or a budget is exhausted
```

The environment owns transitions; the model supplies decisions. We want to learn which representations, decision models, and domains make that useful—not assume generalization from one success.

**Research write-up:** [From looping to navigation](docs/maze-investigation.md) — what failed, how we investigated it, and what finally worked.

## First experiment: ASCII maze

A* (Manhattan distance) vs. hosted Jev and a local System One model. Models see the full map, position, legal moves, and movement history, then choose only among legal directions through the **TypeSafe TypeScript SDK**. History instructions strongly prohibit repeating unsuccessful loops while allowing necessary backtracking; visited moves are not masked. A sole legal move is executed without calling either model, explicitly logged as forced, and included in the budget and subsequent history. No A* hints or fallback. Three fixed mazes probe corridors, detours, and dead ends.

Reports show replayable paths, success, efficiency, revisits, invalid moves, latency, model calls, and forced moves. Raw JSON preserves requests, probabilities, model IDs, and provenance. This tests a next-action policy, **not** a learned admissible search heuristic; tiny mazes cannot establish cross-domain generalization or amortization benefits.

## Representation ablation

`maze-representation` reruns ASCII against an explicit adjacency graph. Both arms share a representation-neutral next-move question, coordinates, history, visit counts, and budgets. Only the map encoding differs; no path scores or pruning. A* remains a separate reference. Reports pair outcomes and expose exact model inputs alongside each replay.

Both experiments now use **v3 policies**: v2's legal-only choices and stronger history instructions, with single-option moves handled as forced transitions (the local API requires at least two choices). Historical v1/v2 reports are preserved. Compare **paired arms within the same policy version**, not new results against historical ASCII results as an encoding-only test.

## Frozen-state diagnostics

`maze-diagnostics` compares identical opaque-ID graphs with versus without node coordinates. Six fixed checkpoints get separate previous-node, unvisited-neighbor, dead-end-neighbor, and next-action probes; answers never coach later requests. Destination IDs replace compass choices in both arms. Reports expose grading, paired probability changes, and exact evidence. This tests recognition versus action, not rollout success; evaluator answers/distances are never model inputs.

Use `--trials 3` for repeated identical requests (not independent maps). Checkpoints: `corridor-before-turn`, `corridor-after-loop`, `detour-first-choice`, `detour-after-loop`, `fork-start`, `fork-after-dead-end`. Defaults to local only; no A* or `--max-steps` for this experiment.

## Action-selection hypotheses

`maze-hypotheses` reuses those checkpoints without coordinates: a fresh control, explicit candidate facts, facts without chronological history, and facts with an exact exploration rule. Three matched contrasts isolate fact scaffolding, trajectory removal, and supplied policy. A separate code implementation of the rule prevents crediting the model with inventing it. Reports distinguish shortest-action correctness from rule adherence; these are not movement rollouts.

## End-to-end rule navigation

`maze-rule` runs the frozen experiment's exact rule prompt and coordinate-free candidate-facts state from each maze entrance, updating full history after every actual move. Compare local/hosted models with `rule` (the same policy in code) and A*. All legal choices remain available; violations are audited afterward, never corrected. Single-option moves remain logged, budgeted, and forced. Reports distinguish completion, path efficiency, loops, model calls, and rule adherence. These are still development mazes, not held-out generalization tests.

## Seeded maze suite

`maze-generated` scales the unchanged rule policy to deterministic DFS trees, branching trees, looped mazes, and rooms. Defaults: two sizes × two geometry seeds × four families = 16 layouts. Geometry and graph-encoding seeds are independent. Compare models with the same code rule and A*; reports separate completion from rule compliance at junctions and tie-breaks. [Generator, controls, and sweep parameters](docs/generated-mazes.md).

**[Summary-only amendment](docs/history-amendment.md):** add `--param memory=summary` to `maze-rule` or `maze-generated` to omit chronological history and history-consulting prompts while retaining visit counts and previous-position flags. Full traces remain available for audit and replay; the full-history arm remains the default.

## Run

Node 22.9+:

```sh
npm install
# Add settings from .env.example to .env; don't overwrite an existing key.
npm run experiment -- maze                         # A* + local :8765
npm run experiment -- maze --solvers astar,local,jev # also hosted Jev (API key required)
npm run experiment -- maze --solvers astar          # offline
npm run experiment -- maze-representation --solvers astar,local,jev
npm run experiment -- maze-diagnostics --solvers local,jev --trials 3
npm run experiment -- maze-hypotheses --solvers local,jev --trials 3
npm run experiment -- maze-rule --solvers astar,rule,local,jev --trials 3
npm run experiment -- maze-generated --solvers astar,rule,local,jev
npm run serve                                     # http://127.0.0.1:3000
```

Open `reports/index.html` directly if you prefer. All computation runs in Node; HTML is self-contained, with browser code only for replay. Credentials stay server-side. Each invocation creates a separate notebook entry; reports are git-ignored.

Use `--cases detour --trials 3 --max-steps 48` to narrow/repeat runs. Default budget: 4× optimal moves, including invalid attempts. Requests have timeouts and no retries; failures are saved, never replaced with an A* result. Local defaults: `http://localhost:8765`, model `imajev-4b`; configure endpoints/model names in `.env`.

## Layout

- `src/core/` — generic task loop, policies, A*, experiment contract.
- `src/providers/` — SDK adapter shared by local and hosted models.
- `src/experiments/maze/` — domain, fixtures, decision policy, measurements, visualization.
- `src/experiments/maze-diagnostics/` — frozen checkpoints, matched encodings, independent probes, offline grading.
- `src/experiments/maze-hypotheses/` — controlled fact, memory, and policy interventions.
- `src/experiments/maze-rule/` — complete rule-guided rollouts, code reference, and post-run compliance audits.
- `src/experiments/maze-generated/` — seeded suites, matched code comparisons, and scalable replay reports.
- `src/report/` — reusable HTML shell, replay, artifact store; `src/serve.ts` serves artifacts only.

Add an experiment with `defineExperiment({ id, title, run, render })` and register it in `src/experiments/index.ts`. Keep domain logic separate from model access and rendering.

`npm test` runs offline tests; `npm run check` checks types. Next probes: larger seeded suites, further state/prompt ablations, then other domains under the same task abstraction.
