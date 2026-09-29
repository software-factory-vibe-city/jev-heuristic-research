# Seeded maze suite

`maze-generated` tests the **unchanged supplied-rule policy** from the successful three-maze study on new layouts. It compares local/hosted System One models with the same rule in code and a separate A* reference. This is a policy-execution generalization test, not a new prompt search.

## Generator

Implementation: [`src/experiments/maze/generated.ts`](../src/experiments/maze/generated.ts). Generator version: `seeded-maze-v1`. Randomness: explicitly seeded Mulberry32, with deterministic iteration order and no ambient `Math.random`.

| Family | Construction | What it exercises |
|---|---|---|
| `corridors` | Randomized depth-first spanning tree | Long corridors, branches, backtracking; acyclic |
| `branching` | Randomized Prim frontier-edge spanning tree | Tends to more short branches/dead ends; acyclic |
| `loops` | DFS base, then open 35% of remaining logical walls, rounded up | Multiple routes and cycles |
| `rooms` | DFS base, then carve seeded rectangular rooms | Open areas with many three-/four-way choices and cycles |

For rooms, carve `max(1, floor(width × height / 12))` rectangles, each spanning 2–3 logical cells per dimension, clamped to fit. Rooms may overlap. These family descriptions are tendencies, not guarantees about difficulty. Actual degree counts, junctions, dead ends, cycle rank, and optimal path lengths are measured and saved.

The generator accepts rectangular logical dimensions from 2 to 64. A logical `W×H` maze becomes a `(2W+1)×(2H+1)` raster: logical cells lie at odd coordinates, with one-cell connecting corridors between them. Outer walls remain closed. Start is always `(1,1)` and goal `(2W−1,2H−1)`, irrespective of search results. All layouts are connected. The CLI suite uses square logical sizes from 2 to 25 and allows at most 256 layout/encoding conditions per invocation; split larger sweeps into batches.

**Two separate kinds of seed:**

- Geometry seed controls carving. Same family, dimensions, seed, and generator version reproduce the same grid, regardless of execution or selection order.
- Encoding seed, together with the stable layout ID, controls opaque node IDs **and node ordering** using the existing graph encoder. It never changes the grid. Legal choices remain sorted by ID. This is not an IDs-only ablation.

Loops and rooms share the corridor family's DFS base for a given size and geometry seed. They are related layouts, not independent draws. Different seed/configuration tuples can also yield identical grids; SHA-256 grid hashes reveal duplicates, which are retained rather than silently filtered.

## First pilot: configuration fixed before model inference

- Families: all four.
- Logical sizes: `3,5` (raster `7×7` and `11×11`).
- Geometry seeds: `101,202`.
- Encoding seed: `20260928`.
- One rollout per solver/condition, not repeated measurements of the same checkpoint.
- Solvers: A*, code rule, local `imajev-4b`, hosted Jev.
- 16 layout configurations, 64 total rollouts.
- Default budget remains **4× optimal moves** per run; no outcome-dependent budget extensions.
- Solver order rotates by case and reverses on even trials.

Topology preflight found 16 distinct grids, 17–59 open cells, 1–29 junctions, and cycle ranks 0–18. Every grid has a genuine junction. The two model providers together can make at most **1,664 API calls** under these budgets. These settings are not selected by model or code-rule success; the complete configured suite is retained.

## Measurement and controls

The prompt, complete coordinate-free graph, candidate facts, and full movement history are unchanged from `maze-rule`. Models never receive family names, generation seeds, coordinates, topology summaries, shortest distances, or control-solver choices. Node IDs are mapped to compass actions only after a model chooses its destination.

The supplied rule is: exclude the previous position if an alternative exists; minimize visits among remaining candidates; break ties lexicographically by node ID. Every legal destination remains a model choice. Singletons are explicitly forced without inference and consume the normal budget. No compliance override, loop pruning, pathfinding rescue, retries, or history truncation.

Reports distinguish:

- Completion, budget exhaustion, API errors, and stopped runs.
- Path stretch **among solved runs**, reported alongside completion to avoid hiding failures.
- Model calls, forced transitions, revisits, two-step returns, and longest no-new-cell streak.
- Rule agreement over executed non-forced actions.
- Rule agreement at junctions (at least three legal neighbors).
- Rule agreement when multiple eligible candidates tie for minimum visits. This and the junction subset overlap; both score agreement with the whole rule, not an isolated reasoning stage.
- Matched model/code outcomes at the same layout, encoding, and trial. Error pairs are not directional wins.
- Captured request sizes, exact evidence, returned model IDs, and runtime/source provenance.

A model can violate the exploration rule yet reach the goal sooner. A code-rule failure can indicate an inadequate strategy or budget. Neither compliance nor completion alone identifies the cause. Four-times-optimal can be a restrictive exploration budget on highly branching graphs; exhaustion does not prove a policy would never solve the maze.

Larger graphs and longer histories also increase payloads. An API/context-limit error is a system limit, not a scored action mistake. It remains in the completion denominator with its saved failed request.

## First pilot results

[Interactive report](../reports/2026-09-28T20-45-45-526Z-maze-generated-9edd8a2d/index.html) · [Raw data](../reports/2026-09-28T20-45-45-526Z-maze-generated-9edd8a2d/result.json) · [Post-hoc analysis](../reports/2026-09-28T20-45-45-526Z-maze-generated-9edd8a2d/analysis.json)

All 64 rollouts completed their scheduled evaluation. There were **1,012 model calls, no API errors, and no illegal moves**. Failures below mean budget exhaustion.

| Solver | Solved | Rule agreement | Junction agreement | Calls | Forced moves |
|---|---:|---:|---:|---:|---:|
| A* | 16/16 | — | — | 0 | 0 |
| Code rule | 15/16 | 379/379 | 120/120 | 0 | 21 |
| Hosted `jev-1.13.0` | **15/16** | **379/379** | **120/120** | 379 | 21 |
| Local `imajev-4b` | **9/16** | **519/633 (82.0%)** | **74/184 (40.2%)** | 633 | 37 |

Completion by family, with four layouts per family:

| Family | Local | Jev | Code rule | A* |
|---|---:|---:|---:|---:|
| Corridors | 2/4 | 4/4 | 4/4 | 4/4 |
| Branching | 3/4 | 4/4 | 4/4 | 4/4 |
| Loops | 2/4 | 4/4 | 4/4 | 4/4 |
| Rooms | 2/4 | 3/4 | 3/4 | 4/4 |

### Jev generalized rule execution; local reliability broke mainly at junctions

Jev's **entire action sequence matched the code reference on all 16 layouts**, including the exhausted run. This extends the earlier supplied-policy result to genuine branches, cycles, and rooms. It does not demonstrate independent strategy creation or an advantage over the code implementation.

Local agreement outside junctions was **445/449 (99.1%)**, versus 40.2% at junctions. Of 114 rule violations, 110 occurred where at least three moves were legal. Classifying each violation by the first unmet priority gave:

- 2 violations of previous-position exclusion.
- 45 violations of minimum visit count among eligible candidates.
- 67 violations of the lexicographic tie-break among minimum-visit candidates.

This localizes the observed problem to choosing among multiple eligible destinations much more than to ordinary corridor continuation. It does **not** establish the model's internal reasoning failure. These measurements follow each solver's own trajectory; repeated visits are dependent, and states cease to be matched after divergence. Maze size, history length, label assignment, and topology have not been isolated as separate causes.

### A single deviation can dominate a rollout

In `corridors-5x5-s101`, local and code took the same first 42 moves. At move 43, the agent was two moves from the goal. The legal candidate facts were:

| Destination | Visits | Previous position | Rule status |
|---|---:|---|---|
| `n02` | 2 | true | Excluded while alternatives exist |
| `n26` | 0 | false | Required choice: right |
| `n46` | 1 | false | Chosen by local: up |

The code rule finished at move 44. Local chose the visited branch, subsequently followed the rule at every remaining decision, and exhausted its **96-move** budget. Its aggregate agreement was still **92/93 (98.9%)**. High per-decision agreement did not translate into task completion.

Conversely, deviations were not uniformly harmful. Local solved `branching-3x3-s202` in **8 moves**, versus the rule's 24, with one rule violation. Compliance is not shortest-path optimality; neither observation proves that the model deliberately found a better strategy.

### The shared failure was a budget cutoff, not a Jev execution error

Both Jev and the code rule exhausted 64 moves on `rooms-5x5-s101`. In a separate, explicitly post-hoc [code-only budget diagnostic](../reports/2026-09-28T20-42-52-867Z-maze-generated-b3824c4c/index.html), the same code rule reached the goal at **move 66** under a 256-move limit. Its first 64 actions exactly matched the original run.

The original failure remains recorded. **That diagnostic was code-only**, so Jev's pilot score remains 15/16. The later [80×-budget model follow-up](#large-budget-follow-up) below directly tests the larger-budget question. The diagnostic shows why an exploration rule's budget-relative completion must be distinguished from policy execution and from A*'s optimal routing.

### Verification and limits

All 16 grids and encoding mappings were regenerated and matched against the saved artifacts. A* lengths matched independent BFS. Post-run audits independently reconstructed facts, checked actual node-ID-to-move execution, verified every compliance count, and confirmed the code trajectories matched the [offline preflight](../reports/2026-09-28T20-30-12-433Z-maze-generated-0eb075ca/index.html). Credentials were absent from the artifacts. Browser checks exercised all 1,742 replay states across 64 players, including raw requests, forced moves, and violations, on desktop, mobile, and direct-file loading. The implementation passes 62 offline tests and type-checking.

This is a small, fixed-policy pilot: two geometry seeds per family/size, one encoding seed, one trial, and related generation families. The important new finding is the separation between **faithful execution of an inefficient exploration policy** and **execution errors at real choice points**. More seeds and encoding assignments are needed before treating these completion fractions as stable success rates.

## Run

```sh
# Offline preflight: generate the whole suite and run both code controls.
npm run experiment -- maze-generated --solvers astar,rule

# Both models plus controls, default 16-layout suite.
npm run experiment -- maze-generated --solvers astar,rule,local,jev

# A reproducible larger sweep with multiple encodings of each physical layout.
npm run experiment -- maze-generated --solvers astar,rule,local,jev \
  --param families=branching,loops --param sizes=5,9 --param seeds=101,202 \
  --param encodings=20260928,20260929

# Select one configured layout; retain every configured encoding.
npm run experiment -- maze-generated --solvers astar,rule,local \
  --cases branching-5x5-s101
```

Use `--trials` for repeats of the same geometry/encoding and `--max-steps` for an explicitly different budget. Unknown parameters, duplicate parameter keys, invalid seeds, and unsupported sizes are rejected. Defaults omit hosted Jev unless selected explicitly.

Reports are static, work directly from disk, and can be served with `npm run serve`. The scalable replay stores one SVG per rollout, parses trace data only on first interaction, and exposes exact request evidence on demand. No browser inference or runtime fetch is required. Previous reports and the original hand-authored fixtures are not replaced.

## Large-budget follow-up

To rerun the exact saved suite with substantially more time to explore:

```sh
node --import tsx scripts/maze-budget-sweep.ts \
  --from reports/2026-09-28T20-45-45-526Z-maze-generated-9edd8a2d/result.json \
  --multiplier 80
```

This uses **80× optimal moves**, twenty times the pilot budget: 640–1,920 moves per run on this suite. It invokes the existing, unmodified experiment CLI with explicit per-case `--max-steps` values. Each invocation reloads the normal `.env` settings. Defaults run A*, the code rule, Jev, then local, across all 16 conditions: 64 fresh runs, not continuations of the old prefixes. `--solvers astar,rule` provides an entirely offline check; hosted inference is included in the sweep's default, unlike the ordinary experiment defaults.

The sweep validates grids, hashes, ID mappings, optimum lengths, rule prompts, and source fingerprints. Source files governing inference are unchanged; the orchestrator has its own recorded hash. Only budgets, scheduling, and artifact packaging change. Longer histories are not truncated, decisions are not repaired, and API/context/timeout errors remain errors rather than being confused with budget exhaustion.

A lightweight solution-step table is saved immediately and checkpointed after each finished subreport. Each solver/case runs in a separate process and saves a full replay under the sweep's `runs/` directory. This avoids holding an entire large sweep's detailed traces in memory. Completed results survive a later interruption; a killed in-flight process may have no complete trace. There is no automatic resume or retry. Pending/running/errored/exhausted entries are explicitly labeled, never shown as solution lengths.

[Completed 80×-budget sweep](../reports/2026-09-28T22-54-23-913Z-maze-budget-sweep-a7a9a6e7/index.html) · [Summary data](../reports/2026-09-28T22-54-23-913Z-maze-budget-sweep-a7a9a6e7/result.json) · [Independent audit](../reports/2026-09-28T22-54-23-913Z-maze-budget-sweep-a7a9a6e7/analysis.json) · [Matched backend errors](../reports/2026-09-28T22-54-23-913Z-maze-budget-sweep-a7a9a6e7/backend-diagnostic.json). The original 4×-budget reports remain untouched.

### Results: two local recoveries, then an input ceiling

| Maze | Seed | Optimal | A* | Jev | Local |
|---|---:|---:|---:|---:|---:|
| Corridors 3×3 | 101 | 8 | 8 | 8 | 8 |
| Corridors 3×3 | 202 | 8 | 8 | 12 | 36 |
| Corridors 5×5 | 101 | 24 | 24 | 44 | 100 |
| Corridors 5×5 | 202 | 20 | 20 | 24 | 54 |
| Branching 3×3 | 101 | 8 | 8 | 24 | 12 |
| Branching 3×3 | 202 | 8 | 8 | 24 | 8 |
| Branching 5×5 | 101 | 16 | 16 | 20 | Error after 111 |
| Branching 5×5 | 202 | 20 | 20 | 32 | 68 |
| Loops 3×3 | 101 | 8 | 8 | 16 | 8 |
| Loops 3×3 | 202 | 8 | 8 | 12 | 32 |
| Loops 5×5 | 101 | 16 | 16 | 24 | Error after 78 |
| Loops 5×5 | 202 | 16 | 16 | 24 | Error after 88 |
| Rooms 3×3 | 101 | 8 | 8 | 22 | 20 |
| Rooms 3×3 | 202 | 8 | 8 | 8 | 12 |
| Rooms 5×5 | 101 | 16 | 16 | 66 | Error after 77 |
| Rooms 5×5 | 202 | 16 | 16 | 42 | Error after 78 |

Plain numbers are **solution steps**, including forced moves. Error rows show executed moves before the rejected request, not solution lengths. No run exhausted its new move budget.

- **Jev and code both solved 16/16**, with identical trajectories and 381/381 compliant non-forced decisions. Jev directly finished the previously cut-off room maze at move 66; this is now a measured model result, not a prediction from the earlier code diagnostic.
- **Local solved 11/16**, up from 9/16. The two recovered corridor cases finished four moves beyond their old cutoffs: 36 instead of a stop at 32; 100 instead of a stop at 96.
- **The other five local runs encountered the server's 4,096-token processed-input limit.** The SDK recorded `500 ValueError`; read-only backend logs supplied `Processed request exceeds the 4096-token limit`, matched by timestamp to each failed run. Full histories were retained; neither the observation contract nor the backend configuration was changed to get past the errors. Their results beyond the API cutoff remain unknown.
- **Every rerun reproduced its entire old action prefix**, and shared-prefix model request bodies matched exactly. The recoveries happened after the old budget boundary, rather than through newly favorable early choices. These are repeated conditions on the same 16 layouts, not 16 new independent maze samples.

There were **1,133 model calls**: 381 Jev and 752 local, including five rejected local requests. Local made 747 model-selected moves with **620/747 rule agreement**, plus 43 forced transitions. Failed calls have no selected action and are excluded from compliance. All 64 saved traces were independently audited; the 65 offline tests and type-checking passed. Browser checks cover the solution table, replay links, desktop/mobile widths, direct-file loading, and the formerly cut-off Jev run at its actual goal.

The large move budget therefore answered part of the question, but did not give five local trajectories their full allotted opportunity. A larger supported local input limit would allow a separately recorded continuation of the full-history condition. Instead, the next user-requested [summary-only amendment](history-amendment.md) keeps the server unchanged and omits chronology while retaining the rule's memory summaries. Increasing a move budget alone cannot bypass an input-length ceiling, and these API errors do not establish that local cannot solve those mazes.
