# Amendment: summaries without chronological history

## Question

Does a complete movement transcript help the models execute our supplied exploration rule when the rule's required memory is already given explicitly?

This is an amendment to the [generated-maze investigation](generated-mazes.md), not a replacement for its earlier results. The [80×-budget full-history run](../reports/2026-09-28T22-54-23-913Z-maze-budget-sweep-a7a9a6e7/index.html) solved 16/16 with Jev and 11/16 with local. Five local runs were rejected by the server's 4,096-token processed-input limit. The earlier frozen-state chronology ablation used a different question (shortest route), not this end-to-end rule-guided task.

## Exact amendment

Set `memory=summary`:

- **Omit `state.history` from every model request**, including the initial request. No sliding window, adaptive truncation, or outcome-dependent switching.
- **No instruction to consult history.** The existing rule question already had no such instruction, so its text stays byte-for-byte identical. Choice descriptions and definitions also stay unchanged; tests reject history/chronology/trajectory wording anywhere in the serialized summary-only request.
- Retain the entire coordinate-free graph, start/current/goal IDs, legal destinations, visit counts, candidate facts, previous-position flags, and their definitions.
- Derive counts and previous-position flags from actual transitions, including forced moves, just as before. This is **not memoryless navigation**.
- Keep full traces in the harness for replay, auditing, and memory calculation. These transcripts are not model inputs in this arm.

At a matched state, the request change is **exactly deletion of the `history` field**. The rule still excludes the previous node when another option exists, minimizes candidate visits, then breaks ties by node ID. The independent code implementation therefore has the same decisions in both observation modes. All legal model choices remain available, including rule-violating ones.

The historical full-history arm remains the default. Summary-only rollouts are separately versioned: `maze-rule-summary-v1`, `maze-generated-summary-v1`, and the batch report `maze-summary-sweep-v1`.

## Frozen end-to-end design

- Same 16 physical layouts, four families, logical sizes 3 and 5, geometry seeds 101 and 202.
- Same opaque-ID and node-order encoding seed, 20260928.
- Same **80× optimal-move budget**: 640–1,920 moves, matching the prior enlarged-budget experiment.
- One fresh run per solver and condition: A*, code rule, Jev, and local; **64 rollouts**.
- Same solver-major schedule as the prior batch: all A*, then code, Jev, and local.
- Same provider adapter, SDK, timeout, credentials handling, and local backend configuration. No server input-limit change.
- No retries, pathfinding rescue, compliance correction, or discarded failures. Every run gets a separate static replay and raw artifact.
- The full-history comparator was selected before inference and recorded in the batch protocol.

The batch emits a checkpointed solution table; pending, running, exhausted, and errored attempts never masquerade as solution lengths. The input change can alter later trajectories: aggregate compliance rates are not automatically matched-state measurements. Comparisons should distinguish action changes at shared prefixes, completion, path length, request size, and infrastructure errors.

## Reproduce

```sh
# Same larger-budget suite, same full-history comparator, summary-only requests.
# This explicitly includes hosted Jev, as did the preceding budget sweep.
node --import tsx scripts/maze-budget-sweep.ts \
  --from reports/2026-09-28T20-45-45-526Z-maze-generated-9edd8a2d/result.json \
  --compare-with reports/2026-09-28T22-54-23-913Z-maze-budget-sweep-a7a9a6e7/result.json \
  --multiplier 80 --memory summary

# Ordinary CLI: full default suite, a uniform explicitly selected move budget.
npm run experiment -- maze-generated --solvers astar,rule,local,jev \
  --param memory=summary --max-steps 1920

# The amendment is also available for the three original fixtures.
npm run experiment -- maze-rule --solvers astar,rule,local,jev --param memory=summary
```

The latter commands have different budget configurations from the matched batch; they are examples, not the recorded run. Use `--solvers astar,rule` for entirely offline checks. `memory=full` reproduces the original observation contract. Unknown memory modes fail before model creation.

## Evidence

[Summary-only sweep](../reports/2026-09-29T00-15-59-848Z-maze-summary-sweep-1b721fad/index.html) · [Raw summary and frozen protocol](../reports/2026-09-29T00-15-59-848Z-maze-summary-sweep-1b721fad/result.json)

The completed sweep preserves all 64 subreports. The pre-inference checks passed type-checking and **70 offline tests**, including exact frozen request contrasts, all 16 code trajectories, evolving summary correctness, forced transitions, preserved API errors, a 400-move deliberately noncompliant loop, CLI subprocess evidence, and report labels.

[Independent audit](../reports/2026-09-29T00-15-59-848Z-maze-summary-sweep-1b721fad/analysis.json) · [Matched comparison](../reports/2026-09-29T00-15-59-848Z-maze-summary-sweep-1b721fad/comparison.json) · [Unchanged backend evidence](../reports/2026-09-29T00-15-59-848Z-maze-summary-sweep-1b721fad/backend-comparison.json).

## Results

**All four solvers solved all 16 mazes: 64/64 completed, with no API errors, exhausted budgets, stopped runs, or illegal moves.** Hosted responses resolved to `jev-1.13.0`; local remained `imajev-4b`.

| Layout | Optimal / A* | Jev | Local: full history | Local: summaries only |
|---|---:|---:|---:|---:|
| corridors-3x3-s101 | 8 | 8 | 8 | 8 |
| corridors-3x3-s202 | 8 | 12 | 36 | 36 |
| corridors-5x5-s101 | 24 | 44 | 100 | 154 |
| corridors-5x5-s202 | 20 | 24 | 54 | 84 |
| branching-3x3-s101 | 8 | 24 | 12 | 28 |
| branching-3x3-s202 | 8 | 24 | 8 | 8 |
| branching-5x5-s101 | 16 | 20 | Error after 111 | 154 |
| branching-5x5-s202 | 20 | 32 | 68 | 86 |
| loops-3x3-s101 | 8 | 16 | 8 | 8 |
| loops-3x3-s202 | 8 | 12 | 32 | 32 |
| loops-5x5-s101 | 16 | 24 | Error after 78 | 72 |
| loops-5x5-s202 | 16 | 24 | Error after 88 | 108 |
| rooms-3x3-s101 | 8 | 22 | 20 | 18 |
| rooms-3x3-s202 | 8 | 8 | 12 | 42 |
| rooms-5x5-s101 | 16 | 66 | Error after 77 | 324 |
| rooms-5x5-s202 | 16 | 42 | Error after 78 | 92 |

Numbers are solution moves, including forced transitions. Old error entries are executed moves before the rejected request, **not** solution lengths. A* equals the optimum in every row. Jev and the code rule have identical full-history and summary-only trajectories, so the Jev column applies to both conditions and also gives the code rule's lengths. Every row uses the same encoding and 80× optimal budget in both conditions.

| Solver | Solved | Model calls | Forced moves | Rule agreement | Junction agreement | Minimum-visit-tie agreement |
|---|---:|---:|---:|---:|---:|---:|
| A* | 16/16 | 0 | 0 | — | — | — |
| Code rule | 16/16 | 0 | 21 | 381/381 | 121/121 | 100/100 |
| Jev | 16/16 | 381 | 21 | 381/381 | 121/121 | 100/100 |
| Local | 16/16 | 1,169 | 85 | 928/1,169 | 144/309 | 74/164 |

### Chronology was unnecessary for Jev on this suite

All **381 model decisions** and all **16 complete action sequences** match the full-history run. At corresponding states, the request bodies match after deleting only `history`. The question and other observable information are unchanged. The same code control also produces identical trajectories.

This directly establishes that the chronological transcript was not necessary for Jev's observed success **given this rule and these external memory summaries**. It does not say that movement memory itself is unnecessary: visit counts and previous-position flags remain.

### Local finishes more cases, but is not uniformly more efficient

Local completed **16/16**, compared with 11/16 before. All five formerly input-limited cases now finish. Its largest reported processed input was **2,807 tokens**, below the unchanged 4,096-token server limit; the largest captured request was 5,790 bytes. Before/after backend metadata and container identity/start time match. No server change was needed.

But among the **11 cases solved in both conditions**, summary-only paths were:

- Shorter on **1** case.
- Equal in length on **5** cases.
- Longer on **5** cases.

Only three complete local action sequences were identical. Equal lengths do not imply equal trajectories. Aggregate local rule agreement was **928/1,169 (79.4%)**, versus **620/747 (83.0%)** in the larger-budget full-history run, but these counts follow different state distributions and the earlier run was censored by five API failures. Completion improvement should not be confused with more faithful rule execution or shorter routes.

### Even an empty-history field can matter

On `corridors-5x5-s101`, local's **first move** changed. Both candidates (`n27` and `n36`) had zero visits, `previous_position=false`, and degree two. The rule required `n27`; full history selected it, while summaries-only selected `n36`.

At this point the removed field was just **`history: []`**. No actual past moves were lost. The observed difference therefore cannot be explained solely as forgetting an experienced route. Field presence, input formatting/length, interpretation of the state, and possible prediction variability must remain distinct from a claim that chronology's semantic content caused the change. Repeated matched frozen requests would be the next way to isolate this effect.

### Verification

All 64 saved runs were independently audited: geometry and encoding identity, BFS optimum, legal node-ID execution, visit counts and previous flags, lack of transcript/history wording in every request, exact shared-prefix contrasts, and rule/junction/tie scores. Provider configurations and reported model IDs matched the comparator. The sweep made **1,550 model calls**, with no retries or failures.

Browser checks traversed **2,330 replay states** across all 64 subreports, matched embedded traces to the raw artifacts by hash, checked every model input inspector and selected probability bar, and verified forced/code labeling, playback/reset, mobile layout, and direct-file loading. Full traces remain inspectable even though they were withheld from the models.

This tests chronology's contribution to a particular externally supplied rule with external memory summaries. It does not test whether all memory is unnecessary, whether the models invented the rule, or whether the findings generalize across domains. A single rerun on the same 16 layouts is not a new independent maze sample. Removing a field also changes input length and token positions; any benefit need not identify an internal reasoning mechanism.
