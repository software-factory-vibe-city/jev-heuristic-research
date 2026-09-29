# From looping to navigation: what our maze experiments taught us

Our working hypothesis is that **a System One model amortizes the creation of task-specific semantic heuristics across arbitrary problem domains**.

We began with a small test: give a model a maze, a goal, and its movement history, then ask it to choose the next move. We compared a local `imajev-4b` model and hosted Jev with A*. The models made structured choices through the TypeSafe TypeScript SDK; code executed those choices and recorded what happened. Hosted responses in the latest experiments resolved to `jev-1.13.0`.

The investigation did not initially produce reliable navigation. It produced loops, representation-sensitive decisions, and a useful distinction between **having the relevant information**, **answering factual questions about it**, and **using it to choose an effective action**.

This is the story of those failures, the experiments they motivated, and the narrower success we eventually established.

**Follow-up:** the [seeded maze study](generated-mazes.md#first-pilot-results) extends this investigation to genuine junctions, cycles, and rooms. The account below preserves the original three-maze findings.

## 1. What did not work

### Asking for the next good move was not enough

The first experiment used three fully observable, unit-cost, four-neighbor mazes:

- **Corridor:** follow a bent corridor to the goal; optimal length 14 moves.
- **Detour:** initially move away from a nearby goal to get around a wall; optimal length 10.
- **Fork:** choose between a tempting dead-end corridor and the route to the goal; optimal length 12.

The default budget was four times the optimal path length: 56, 40, and 48 attempted moves. The original policy offered all four compass directions. Illegal moves left the agent in place but consumed budget.

In the [first full comparison][baseline-v1]:

| Solver | Mazes completed |
|---|---:|
| A* with Manhattan distance | 3/3 |
| Local `imajev-4b` | 1/3 |
| Hosted Jev | 0/3 |

The local model solved the detour optimally. Neither model solved the corridor or fork. The problem was not simply that these tasks needed more room to maneuver: the traces showed repeated unproductive movement.

This comparison needs an important qualification. A* combines a heuristic with a search algorithm that maintains a frontier and compares alternative paths. The models were choosing one action at a time, without that search machinery. We were testing a **direct navigation policy**, not replacing the heuristic inside an otherwise identical A* controller.

### A clearer map encoding did not consistently repair navigation

Perhaps the models were struggling to interpret ASCII. We built a [paired representation experiment][representation-v1] comparing the grid with an explicit adjacency graph.

Within each policy version, the two arms shared the same coordinates, legal moves, full history, visit counts, question, and budget. Only the map encoding differed. The graph enumerated every open cell and legal edge; it did not supply path scores or a recommended route.

The result was not “graphs work; ASCII does not.” The local model could solve the corridor with the graph but not ASCII, while solving the detour and fork with ASCII but not the graph. Hosted Jev did not complete any of those paired runs.

We then restricted choices to legal directions and strengthened the history instructions: do not repeat unsuccessful loops or re-enter a known unproductive dead end, but allow necessary backtracking. We deliberately did **not** ban visited cells. A blanket prohibition would prevent legitimate recovery from a wrong branch.

That revision exposed a separate engineering problem. The local API rejected requests with only one choice:

> `List should have at least 2 items after validation, not 1`

Eight of the nine local runs across the revised baseline and paired studies stopped on this restriction; one completed without encountering it. Those errors were not evidence about navigation ability.

We fixed the interface consistently for both providers: when exactly one legal move exists, the controller executes it without inference. These **forced moves** are labeled, consume the normal movement budget, and enter subsequent history. They have no fabricated model answer or probabilities. The old error-containing reports remain preserved.

The resulting **v3** runs had no API errors or illegal moves. But eliminating those problems did not eliminate navigation failure:

| Maze | Local baseline ASCII | Local paired ASCII | Local paired graph |
|---|---|---|---|
| Corridor | Budget exhausted | Budget exhausted | Solved in 14 moves |
| Detour | Solved in 14 moves | Solved in 12 moves | Budget exhausted |
| Fork | Budget exhausted | Solved in 12 moves | Budget exhausted |

A* solved all cases. Hosted Jev exhausted its budget in **all nine model rollouts** across the [v3 baseline][baseline-v3] and [v3 paired study][representation-v3]. Each configuration had one trial at this stage. The standalone and paired ASCII policies are not an encoding-only comparison; the matched ASCII/graph arms are.

**What failed here was the combination of full observation, legal choices, movement memory, and general anti-loop instructions—not merely wall detection or API compatibility.**

### History was present, but did not reliably correct behavior

The saved requests let us examine decisions before the trajectories diverged.

At the first local-model disagreement in each v3 paired maze, the requests were identical except for the map field:

| Shared state | ASCII choice | Graph choice |
|---|---|---|
| Corridor, after five rightward moves | Turn back left, 77% | Continue right, 65% |
| Detour, after one downward move | Continue down, 86% | Return up, 54% |
| Fork, at the start | Take the lower route, 67% | Enter the dead-end branch, 94% |

These percentages are the returned probabilities for the chosen actions, not independently calibrated measures of correctness.

The detour trace was especially revealing. In the graph arm, the local model returned to the start. After the forced move brought it back to the same decision point, its probability of returning upward rose from about **54% to 93%**. The request now included the unsuccessful excursion, but the next choice repeated it more strongly.

That observation does not prove that longer history caused the mistake. It does show that **recording an experience and exposing it again is not sufficient to make behavior improve**.

### Apparent progress could be actual regression

We also compared hosted Jev's v3 actions with two quantities computed afterward:

1. Manhattan distance to the goal—the coordinate distance ignoring walls.
2. Actual shortest-path distance through the maze.

Across those nine runs, **all 225 model-selected actions reduced Manhattan distance and increased actual shortest-path distance**. Forced transitions were excluded. Every selected action was also a maximum-probability answer in the returned distribution.

This is a striking behavioral match to greedy geometric attraction, but not proof of the model's internal algorithm. The 225 decisions occurred at only **eight distinct maze-position pairs**, mostly revisited in loops. They are not 225 independent tests.

We had not supplied computed Manhattan distances, “closer to goal” labels, or oracle paths to the models. Coordinates and the map were available. The observation therefore suggested a testable question: **could geometric information distract from the graph connectivity and movement history?**

It also clarified why A* could succeed with Manhattan distance while these actions failed. A useful heuristic inside search is not necessarily a useful greedy next-action rule.

## 2. How we turned the failures into experiments

### External examples suggested interventions, not a verdict

We reviewed other Jev navigation projects rather than treating our initial failures as a rejection of the broad hypothesis. Their systems made different divisions of labor between model and controller: direct action selection, explicit exploration rules, model-assisted search, and, in some demonstrations, code-supplied navigation or corrections.

[Jev-Quantum's writeup][external-article] was particularly useful. On its single, partially observed 10×10 maze, full movement history did not prevent prolonged looping. Explicit exploration priorities did lead to completion. Its authors also implemented those priorities in code, which completed the task without a model.

That supplied a useful direction for investigation, not a result we could simply import. Its [exploration rule][external-strategies] prioritizes least-traversed **bidirectional edges**, followed by exploration-related tie-breaks. Our later rule is different. Its distance-removal intervention also removed several explicit derived signals that our prompts had never contained.

The methodological lesson was to separate three questions:

- Can the model recognize relevant facts?
- Can it select a useful action from those facts?
- Can it execute an effective strategy when that strategy is supplied?

### We stopped changing entire journeys and froze individual decisions

A full rollout is a poor tool for isolating why one decision changed. Once two policies take different actions, they encounter different positions and histories. A better final score might reflect avoiding a difficult situation rather than handling it better.

We therefore selected **six checkpoints** from observed failures and representation disagreements, before running the diagnostics:

- Corridor before a turnback, and at the same position after an unsuccessful loop.
- Detour at the first choice, and after returning to it through a loop.
- Fork at the start, and after reversing out of the dead end.

Each checkpoint preserved its actual movement prefix. We reconstructed it against the maze rather than copying an unexplained state description.

We also replaced coordinate-based node names and compass choices with fixed, shuffled opaque IDs such as `n05`. Node order was shuffled separately. The two experimental conditions shared the same graph, IDs, ordering, goal, legal destinations, history, and visit counts. **Only one condition included node coordinates.**

This mattered: changing the names, ordering, and coordinates together would not have isolated the coordinate effect.

### Recognition and action became separate measurements

At each checkpoint, we made four independent requests:

1. Which node did the agent just come from?
2. Which legal neighbor is unvisited?
3. Which legal neighbor is a dead end, defined as having exactly one graph neighbor?
4. Which destination is a next step on a shortest route to the goal?

The factual answers were **not fed into the action request**. Each question stood alone. Factual answer keys and shortest-path answers were computed only for evaluation; all equally short next actions were accepted.

Six checkpoints × four questions × two coordinate conditions × three repeats × two providers produced **288 requests**. These were repeated measurements of frozen states, not 288 maze trials.

The [diagnostic results][diagnostics] were:

| Probe | Local, coordinates | Local, no coordinates | Jev, coordinates | Jev, no coordinates |
|---|---:|---:|---:|---:|
| Previous node | 15/18 | 15/18 | 18/18 | 18/18 |
| Unvisited neighbor | 18/18 | 18/18 | 18/18 | 18/18 |
| Dead-end neighbor | 9/18 | 9/18 | 17/17 | 17/17 |
| Shortest-route next action | 9/18 | **12/18** | 9/18 | **13/18** |

Two Jev dead-end requests timed out, one per coordinate condition. They remain errors, not correct answers or silently retried observations.

Removing coordinates helped action selection, but did not solve it. Mean probability assigned to correct actions rose by about **15 percentage points locally** and **10.1 points for Jev**.

More importantly, Jev answered **106/106 completed factual probes correctly**, yet still chose wrong actions in separate requests about the same states. The local model had additional factual weaknesses, especially identifying dead-end neighbors.

This narrowed the explanation. In Jev's case, the information was accessible when directly queried; simply saying that it could not read the graph or history was inadequate. But factual accessibility is not proof that the same facts were computed or used during action selection.

## 3. What helped—and what still did not

The next experiment retained those six checkpoints and used coordinate-free graphs throughout. We tested four arms:

| Arm | What the model received |
|---|---|
| Control | Graph, full history, visit counts, and a shortest-route action question |
| Facts | Control plus deterministic facts about every legal candidate |
| Summary | Facts arm with chronological history removed; summarized memory retained |
| Rule | Exactly the facts arm's state, including history, but an explicit exploration rule instead of the shortest-route question |

The candidate facts were arrival count, whether the candidate was the immediately previous position, graph degree, and whether its degree was one. They were ordinary lookups from the supplied observations—not model-generated answers, distance estimates, or route recommendations.

The contrasts were deliberately narrow:

- **H1, control → facts:** does making facts explicit help?
- **H2, facts → summary:** does removing chronology help?
- **H3, facts → rule:** does specifying the decision policy help?

We reran a fresh control. Its instruction referred to “supplied movement memory,” rather than requiring “full movement history,” so the summary condition would not be penalized by an instruction referring to a field it lacked. That same action question was used in control, facts, and summary.

The [hypothesis experiment][hypotheses] made **144 requests**, with no errors:

| Provider | Control | + Candidate facts | Facts, no chronology | Facts + explicit rule |
|---|---:|---:|---:|---:|
| Local | 12/18 | **15/18** | 15/18 | **18/18** |
| Jev | 12/18 | 12/18 | 12/18 | **18/18** |

These are shortest-action correctness scores at frozen checkpoints—not full-task completion.

Three findings emerged:

**Explicit facts helped the local model, but not Jev's action accuracy.** Local mean probability on correct actions rose from 70.62% to 84.47%. Jev's fell slightly, from 72.17% to 69.89%, with the same number of correct choices. Fact extraction alone did not explain its remaining action failures.

**Removing chronology did not help in this setup.** Neither model improved its selected-action accuracy. Mean probability on correct actions fell by approximately 5.39 percentage points locally and 5.89 points for Jev. This was not a test of having no memory: previous-position flags and visit counts remained. Nor was the summary a lossless compression of the trajectory.

**The explicit rule fixed the remaining sampled choices.** Both models reached 18/18. Jev's mean probability on correct actions rose from 69.89% in the facts arm to 99.22% in the rule arm. Local accuracy also improved, but its mean probability barely changed: 84.47% to 84.70%. That distinction is one reason we retained probabilities as well as selected answers.

The strongest controlled result was not that “more information works.” It was that **changing what decision the model was instructed to make worked, with the state held constant**.

## 4. The rule that worked

The successful rule was simple and fully specified:

1. If any legal destination is **not the immediately previous position**, restrict consideration to those destinations. Otherwise consider all legal destinations.
2. Among the remaining destinations, choose the one with the **fewest visits**.
3. Break remaining ties by choosing the **lexicographically smallest node ID**.

Avoiding immediate reversal takes priority over visit count. Returning is allowed when there is no alternative.

For example, after `A → B → C (dead end) → B`, the previous position at B is now C. The rule continues toward A rather than immediately re-entering C. At C itself, the sole legal transition back to B is handled as a logged forced move.

The question explicitly instructed the model to apply this rule, **not calculate a shortest route**. The rule uses previous-position flags, visit counts, and node IDs. Dead-end flags and graph degrees remained in the state, but are not part of its priorities. No goal distances or oracle recommendations were supplied.

We also implemented the exact same rule in code. This was a separate reference, not a filter on model outputs. All legal destinations—including the previous node—remained available to the model. A violation would be executed, not corrected.

Both models agreed with the rule **18/18 times** in the frozen experiment. The code reference chose a shortest-route action at **6/6 distinct checkpoints**. Its score was not inflated by repeating a deterministic calculation three times.

That qualification matters. Rule agreement and shortest-action correctness happened to coincide at these checkpoints; they are different properties. Executing a supplied heuristic is also a different task from inventing one.

At this point we had demonstrated improved **next decisions**, not solved mazes. The next experiment tested whether those decisions composed into complete journeys.

## 5. The end-to-end test

We started every solver at each maze entrance, with fresh history, and ran:

- A* as the search reference.
- The exploration rule implemented in code.
- The local model given that rule.
- Hosted Jev given that rule.

There were three trials per maze: **36 complete rollouts**, including 18 model rollouts.

The model policies reused the exact coordinate-free graph encoding, candidate-facts state, and rule question from the frozen experiment. State was rebuilt after each actual transition. Node labels remained fixed. Each model's returned destination ID was mapped to its corresponding legal physical move without changing the choice.

Singleton moves remained forced, logged, and budgeted for both providers and the code rule. Otherwise, no rule-based action masking, loop pruning, search fallback, or retries were introduced. Compliance was audited **after** each rollout against that run's own history.

The [result][rollouts] was unambiguous within this test:

| Solver | Completed | Non-forced decisions obeying the rule | Model calls | Forced moves |
|---|---:|---:|---:|---:|
| Local `imajev-4b` | **9/9** | **102/102** | 102 | 6 |
| Hosted Jev | **9/9** | **102/102** | 102 | 6 |
| Same rule in code | **9/9** | 102/102 | 0 | 6 |
| A* | **9/9** | Not applicable | 0 | 0 |

All four solvers took **14 moves on corridor, 10 on detour, and 12 on fork**, in every trial. All paths were optimal. There were no revisits, illegal moves, or API errors. The models' action sequences matched the code rule's sequences exactly.

Each model's total was 108 physical moves: 102 model-selected transitions and six forced transitions. The two providers together made 204 requests, comprising **68 distinct request bodies repeated three times**. This is evidence of repeatability on fixed inputs, not 204 independent decision problems.

We also checked the bridge between studies: the 18 rollout requests that encountered previously tested frozen prefixes exactly matched the corresponding historical rule-arm requests. The final rollout did not quietly introduce a more helpful prompt or hidden path hint.

**The local decision successes did compose into successful end-to-end navigation.**

## 6. What we can—and cannot—claim

### These mazes are simpler than their drawings suggest

A topology audit revealed that all three fixtures are **single paths as undirected graphs**:

| Fixture | Open cells | Edges | Degree-one endpoints | Cycles |
|---|---:|---:|---:|---:|
| Corridor | 15 | 14 | 2 | 0 |
| Detour | 15 | 14 | 2 | 0 |
| Fork | 19 | 18 | 2 | 0 |

Every other node has degree two. There are no three-way junctions. The “fork” starts inside a path, giving two initial directions, rather than containing a genuine branching junction.

Once moving along such a path, avoiding immediate reversal largely determines the next move. The final rollouts therefore did not substantially test prioritization among several non-previous candidates or exploration of cycles.

The fixed ID assignment also happened to make the lexicographic tie-break select the shortest initial branch in the fork. In an **offline code-only test**, changing the label assignment made the same rule enter the wrong branch first, recover, and finish in **24 rather than 12 moves**. We have not yet run the models across those alternative assignments.

Thus, the observed optimal paths do not establish that the supplied rule is generally a shortest-path algorithm—or that the models independently planned those routes.

### The successful system assigned more of the decision logic to us

The progression was:

> Ask for a useful move → inspect failures → isolate facts and representation → expose candidate facts → supply a decision rule → test composition.

In the model-guided runs, the model still selected every non-forced action. But we had moved important work out of its task: code assembled explicit facts, and we specified how to prioritize them.

This is a meaningful result about **supplied-policy execution**. It is not yet evidence that the model amortized the **creation** of a task-specific heuristic. Nor does it demonstrate a model advantage over code: the code-only rule completed the same routes without inference calls.

Conversely, the earlier direct-action failures do not refute the broad hypothesis. They concern particular interfaces on a small symbolic navigation task, without a fixed search controller. They do not establish how the models would perform as semantic scorers or candidate rankers inside a different system.

### The evidence is developmental, not held out

The checkpoints were selected from observed failures. We iterated on the same three maps. The ID assignment and option ordering stayed fixed, and repeated calls need not be independent. The experiments identify useful interventions in this setting; they do not estimate broad maze-solving reliability, cross-domain generalization, training amortization, or an economic advantage.

Our strongest conclusion is narrower and more useful:

> **Relevant information being present was not enough. Correctly answering factual questions about it was not enough. With explicit candidate facts and a precise exploration policy, both models executed that policy without observed deviations and completed these mazes end to end.**

## 7. Why we trust that narrower conclusion

The investigation depended as much on measurement discipline as on prompt changes:

- **We preserved failures.** Historical protocols and reports were not overwritten by later successes. API errors, budget exhaustion, forced transitions, and model choices remained distinguishable.
- **We inspected exact requests and traces.** Aggregate completion scores alone would have missed encoding-sensitive choices, repeated reversals, and the mismatch between geometric and actual progress.
- **We used matched interventions.** Coordinate presence, explicit facts, trajectory removal, and the rule question were tested through defined contrasts. The larger historical improvement is not attributable to any one change in isolation.
- **We kept evaluator information separate.** Shortest paths graded choices and set default budgets; they were not model inputs. The code rule was a control, never a rescue.
- **We measured different kinds of success separately.** Factual correctness, shortest-action correctness, rule compliance, and full-task completion answer different questions.
- **We verified the implementation.** The rollout implementation passed 53 offline tests and type-checking. Tests included deliberately noncompliant model outputs that had to be executed unchanged. Saved-data audits checked request contents, destination-to-move mapping, counts, compliance, and credential exclusion. Static reports were checked in desktop, mobile, and direct-file playback.

## 8. What should come next

The next useful step is not to keep tuning against these same successful traces. It is to freeze this interface and test where its apparent simplicity stops being enough:

1. **Vary opaque IDs and option order.** Separate rule execution from favorable tie-breaks and fixed-label effects.
2. **Use held-out mazes with genuine junctions and cycles.** Compare model compliance and completion with the unchanged code rule. If the code policy fails too, distinguish a weak strategy from weak model execution.
3. **Return to the original hypothesis under a fixed controller.** Let a model rank candidates or supply heuristic judgments inside the same search procedure used by code-only controls. Compare with uninformed, geometric, and explicit-rule alternatives.
4. **Move to domains requiring semantic judgment.** The strongest case for a learned heuristic is not a rule already reducible to three exact comparisons, but useful judgments that are harder to enumerate in code.

For now, we have a concrete progression from failure to success—and a clearer account of whose work made the success possible.

---

## Evidence and reproduction

The linked reports are local artifacts in this checkout; `reports/` is not committed. Every report has an adjacent `result.json` containing exact requests, responses, outcomes, and provenance. Reports open directly from disk or through `npm run serve`.

| Stage | Saved evidence |
|---|---|
| Original navigation | [Baseline v1][baseline-v1] · [Paired representation v1][representation-v1] |
| Legal-only API failure | [Baseline v2][baseline-v2] · [Paired representation v2][representation-v2] |
| Forced-move repair and continuing loops | [Baseline v3][baseline-v3] · [Paired representation v3][representation-v3] |
| Recognition/action and coordinate diagnostics | [Frozen-state diagnostics][diagnostics] |
| Facts, memory, and policy contrasts | [Action-selection hypotheses][hypotheses] |
| Full rule-guided navigation | [End-to-end rollouts][rollouts] |

To run the current studies again, with the configured local endpoint and hosted API key:

```sh
npm run experiment -- maze-diagnostics --solvers local,jev --trials 3
npm run experiment -- maze-hypotheses --solvers local,jev --trials 3
npm run experiment -- maze-rule --solvers astar,rule,local,jev --trials 3
```

These commands create new artifacts; they do not reproduce historical v1/v2 protocols or guarantee identical future model responses. The implementation of the successful rule and its input facts is in [`arms.ts`](../src/experiments/maze-hypotheses/arms.ts); the rollout policy and post-run audits are in [`maze-rule/`](../src/experiments/maze-rule/).

[baseline-v1]: ../reports/2026-09-28T04-39-19-870Z-maze-d00623b3/index.html
[representation-v1]: ../reports/2026-09-28T05-09-21-900Z-maze-representation-955295e0/index.html
[baseline-v2]: ../reports/2026-09-28T05-33-52-445Z-maze-e870d7bd/index.html
[representation-v2]: ../reports/2026-09-28T05-34-29-816Z-maze-representation-d3a0946f/index.html
[baseline-v3]: ../reports/2026-09-28T05-42-15-544Z-maze-9dbf7c7e/index.html
[representation-v3]: ../reports/2026-09-28T05-44-16-001Z-maze-representation-dc66a0e7/index.html
[diagnostics]: ../reports/2026-09-28T06-10-48-068Z-maze-diagnostics-a74b97e9/index.html
[hypotheses]: ../reports/2026-09-28T06-43-17-103Z-maze-hypotheses-f75fe88f/index.html
[rollouts]: ../reports/2026-09-28T18-10-28-550Z-maze-rule-d92dbe05/index.html
[external-article]: https://github.com/songshikang0111/Jev-Quantum/blob/main/docs/jev-maze-article.md
[external-strategies]: https://github.com/songshikang0111/Jev-Quantum/blob/main/docs/maze-strategies.md
