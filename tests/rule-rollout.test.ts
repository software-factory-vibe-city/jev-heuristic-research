import { test } from "node:test";
import assert from "node:assert/strict";
import { runTask } from "../src/core/task.js";
import { createChoiceModel, providerConfig } from "../src/providers/system-one.js";
import { mazeCases } from "../src/experiments/maze/cases.js";
import { createMazeTask, parseMaze, positionKey } from "../src/experiments/maze/domain.js";
import { checkpointDefinitions, freezeCheckpoint } from "../src/experiments/maze-diagnostics/checkpoints.js";
import { createEncoding, diagnosticState } from "../src/experiments/maze-diagnostics/encoding.js";
import { probeCriteria } from "../src/experiments/maze-diagnostics/probes.js";
import { candidateFacts, explorationRule, hypothesisState, ruleInstructions } from "../src/experiments/maze-hypotheses/arms.js";
import { rulePolicy } from "../src/experiments/maze-rule/policy.js";
import { auditTrace, mazeRuleExperiment, runRuleMaze } from "../src/experiments/maze-rule/experiment.js";
import { renderRuleExperiment } from "../src/experiments/maze-rule/render.js";

const responseFor = (request: any, selected = explorationRule(request.state.candidate_facts)) => Response.json({
  model: "test-model", answers: { answer: { type: "choice", choice: selected, confidence: 1,
    probabilities: Object.fromEntries(Object.keys(request.questions.answer.criteria).map((label) => [label, label === selected ? 1 : 0])),
  } }, usage: { input_tokens: 10, output_tokens: 1 },
});

test("live rule policy exactly reproduces frozen-state rule inputs and decodes only the selected destination", async () => {
  for (const definition of checkpointDefinitions) {
    const checkpoint = freezeCheckpoint(definition);
    const encoding = createEncoding(checkpoint);
    let request: any;
    const model = createChoiceModel(providerConfig("local", {}), async (_input, init) => {
      request = JSON.parse(String(init?.body));
      return responseFor(request);
    });
    const decision = await rulePolicy(checkpoint.maze, encoding, model)(checkpoint.current, checkpoint.history);
    assert.deepEqual(request.state, hypothesisState(checkpoint, encoding, "rule"));
    assert.deepEqual(request.questions.answer.criteria, probeCriteria(checkpoint, encoding, "action"));
    assert.equal(request.questions.answer.instructions, ruleInstructions);
    assert.deepEqual(Object.keys(request.questions), ["answer"]);
    assert.ok(Object.keys(request.questions.answer.criteria).length >= 2);
    assert.ok(!/"(coordinates|x|y|ruleAudit|expectedDestination|distance)"/.test(JSON.stringify(request.state)));
    const next = createMazeTask(checkpoint.maze).transition(checkpoint.current, decision!.action);
    assert.equal(next.valid, true);
    const rawAnswer = decision!.metadata!.answer as { choice: string };
    assert.equal(encoding.byPosition[positionKey(next.state)], rawAnswer.choice);
    assert.equal(decision!.metadata!.destination, rawAnswer.choice);
    assert.equal(decision!.metadata!.source, "model");
    assert.equal(decision!.metadata!.ruleAudit, undefined);
    const previous = request.state.candidate_facts.find((fact: any) => fact.previous_position);
    if (previous) assert.ok(Object.hasOwn(request.questions.answer.criteria, previous.destination));
    assert.equal(model.stats.calls, 1);
  }
});

test("complete rollouts start fresh, match a compliant model to code, count forced moves, and render node probabilities", async () => {
  const solvers = ["astar", "rule", "local"];
  let clients = 0;
  const firstHistoryLengths: number[] = [];
  const result = await runRuleMaze({ solvers, cases: [], trials: 2 }, (config) => {
    clients++;
    let first = true;
    return createChoiceModel(config, async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      if (first) { firstHistoryLengths.push(request.state.history.length); first = false; }
      assert.ok(Object.keys(request.questions.answer.criteria).length >= 2);
      assert.equal(request.state.visit_counts.reduce((sum: number, entry: any) => sum + entry.count, 0), request.state.history.length + 1);
      assert.ok(!JSON.stringify(request.state).includes("ruleAudit"));
      return responseFor(request);
    });
  });
  assert.deepEqual(mazeRuleExperiment.defaultSolvers, ["astar", "rule", "local"]);
  assert.equal(clients, 6);
  assert.deepEqual(firstHistoryLengths, [1, 1, 1, 1, 0, 0]);
  assert.deepEqual(solvers, ["astar", "rule", "local"]);
  assert.equal(result.protocol.instructions, ruleInstructions);
  assert.ok(!JSON.stringify(result.protocol).includes("apiKey"));
  for (const item of result.cases) {
    assert.deepEqual(item.runs.map((run) => run.solver), ["astar", "rule", "local", "local", "rule", "astar"]);
    for (const run of item.runs) {
      assert.equal(run.trace.status, "solved");
      assert.equal(run.metrics.moves, item.optimalMoves);
      assert.equal(run.metrics.invalidMoves, 0);
      assert.equal(run.metrics.ruleViolations, 0);
      assert.equal(run.metrics.revisits, 0);
      assert.equal(run.metrics.longestStagnation, 0);
      assert.equal(run.metrics.twoStepReturns, 0);
      if (run.solver === "astar") {
        assert.equal(run.metrics.ruleChecks, 0);
        assert.equal(run.metrics.forcedMoves, 0);
        assert.ok(run.metrics.expandedStates! > 0);
      } else {
        assert.equal(run.metrics.ruleChecks, run.trace.steps.length - run.metrics.forcedMoves!);
        assert.equal(run.metrics.ruleMatches, run.metrics.ruleChecks);
        for (const step of run.trace.steps) assert.equal((step.metadata!.ruleAudit as any).agrees, true);
      }
      if (run.solver === "local") {
        const code = item.runs.find((other) => other.solver === "rule" && other.trial === run.trial)!;
        assert.deepEqual(run.trace.steps.map((step) => step.action), code.trace.steps.map((step) => step.action));
        assert.equal(run.metrics.modelCalls + run.metrics.forcedMoves!, run.trace.steps.length);
        assert.equal(run.modelStats!.inputTokens, run.metrics.modelCalls * 10);
        for (const [index, step] of run.trace.steps.entries()) {
          if (step.metadata!.source === "forced") {
            assert.equal(step.metadata!.request, undefined);
            assert.equal(step.metadata!.answer, undefined);
          } else {
            const request = step.metadata!.request as any;
            assert.equal(request.state.history.length, index);
            assert.equal(request.state.current, item.encoding.byPosition[positionKey(step.before)]);
            assert.equal((step.metadata!.answer as any).choice, item.encoding.byPosition[positionKey(step.after)]);
          }
        }
      } else assert.equal(run.metrics.modelCalls, 0);
    }
  }
  const html = renderRuleExperiment(result);
  assert.ok(html.includes("Same rule."));
  assert.ok(html.includes("Code rule decision (no model request)"));
  assert.ok(html.includes("Forced move (no model request)"));
  assert.ok(html.includes("Post-run rule audit"));
  assert.ok(html.includes("Model input before move 2"));
  assert.ok(html.includes("→ right<i>"));
  assert.ok(html.includes('class="probability selected"'));
  assert.ok(html.includes("rule agreement"));
  assert.ok(html.includes("two-step returns"));
});

test("model rule violations are executed without rescue, consume budget, and get audited after the run", async () => {
  const observedHistoryLengths: number[] = [];
  const result = await runRuleMaze({ solvers: ["local"], cases: ["corridor"], trials: 1, maxSteps: 6 }, (config) => createChoiceModel(config, async (_input, init) => {
    const request = JSON.parse(String(init?.body));
    observedHistoryLengths.push(request.state.history.length);
    const previous = request.state.candidate_facts.find((fact: any) => fact.previous_position).destination;
    assert.ok(Object.hasOwn(request.questions.answer.criteria, previous));
    assert.ok(!JSON.stringify(request.state).includes("ruleAudit"));
    return responseFor(request, previous);
  }));
  const run = result.cases[0]!.runs[0]!;
  assert.equal(run.trace.status, "budget-exhausted");
  assert.deepEqual(run.trace.steps.map((step) => step.action), ["right", "left", "right", "left", "right", "left"]);
  assert.deepEqual(observedHistoryLengths, [1, 3, 5]);
  assert.equal(run.metrics.moves, 6);
  assert.equal(run.metrics.modelCalls, 3);
  assert.equal(run.metrics.forcedMoves, 3);
  assert.equal(run.metrics.ruleChecks, 3);
  assert.equal(run.metrics.ruleMatches, 0);
  assert.equal(run.metrics.ruleViolations, 3);
  assert.equal(run.metrics.revisits, 5);
  assert.equal(run.metrics.twoStepReturns, 5);
  assert.equal(run.metrics.longestStagnation, 5);
  assert.equal(run.metrics.uniqueCells, 2);
  assert.ok(renderRuleExperiment(result).includes("VIOLATION"));
});

test("API errors preserve the forced prefix and do not contaminate the independent code reference", async () => {
  const result = await runRuleMaze({ solvers: ["local", "rule"], cases: ["corridor"], trials: 1 }, (config) => createChoiceModel(config, async () => Response.json({ message: "offline" }, { status: 503 })));
  const [failed, code] = result.cases[0]!.runs;
  assert.equal(failed!.trace.status, "error");
  assert.equal(failed!.trace.steps.length, 1);
  assert.equal(failed!.metrics.forcedMoves, 1);
  assert.equal(failed!.metrics.modelCalls, 1);
  assert.equal(failed!.metrics.ruleChecks, 0);
  assert.equal((failed!.modelStats!.failure!.request as any).state.history.length, 1);
  assert.equal(code!.trace.status, "solved");
  assert.equal(code!.trace.steps.length, 14);
  assert.equal(code!.metrics.modelCalls, 0);
});

test("singleton transitions remain budgeted without model evidence for both providers; no-action states stop", async () => {
  for (const provider of ["local", "jev"] as const) {
    for (const [ascii, budget, status, steps] of [["SG", 3, "solved", 1], ["S.#G", 5, "budget-exhausted", 5], ["S#G", 5, "stopped", 0]] as const) {
      const maze = parseMaze(ascii);
      const encoding = createEncoding({ mazeId: "test", maze });
      const model = createChoiceModel(providerConfig(provider, { TYPESAFE_API_KEY: "test" }), async () => { throw new Error("No transport call expected"); });
      const trace = await runTask(createMazeTask(maze), rulePolicy(maze, encoding, model), budget);
      assert.equal(trace.status, status);
      assert.equal(trace.steps.length, steps);
      assert.equal(model.stats.calls, 0);
      assert.equal(model.stats.inputTokens, 0);
      for (const step of trace.steps) {
        assert.equal(step.metadata!.source, "forced");
        assert.equal(step.metadata!.request, undefined);
        assert.equal(step.metadata!.answer, undefined);
      }
    }
  }
});

test("code rule recovers from the wrong initial fork without optimal-path hints", async () => {
  const maze = parseMaze(mazeCases.find((item) => item.id === "fork")!.ascii);
  let encoding = createEncoding({ mazeId: "fork", maze });
  let found = false;
  for (let seed = 1; seed <= 50; seed++) {
    const candidate = createEncoding({ mazeId: "fork", maze }, seed);
    const decision = await rulePolicy(maze, candidate)(maze.start, []);
    if (decision!.action === "right") { encoding = candidate; found = true; break; }
  }
  assert.equal(found, true);
  const trace = await runTask(createMazeTask(maze), rulePolicy(maze, encoding), 48);
  assert.equal(trace.status, "solved");
  assert.equal(trace.steps.length, 24);
  const metrics = auditTrace(maze, encoding, trace, true);
  assert.equal(metrics.ruleViolations, 0);
  assert.equal(metrics.ruleChecks, 23);
  assert.equal(metrics.forcedMoves, 1);
  assert.equal(metrics.revisits, 6);
  assert.equal(metrics.twoStepReturns, 1);
  assert.equal(metrics.longestStagnation, 6);
  assert.equal(metrics.uniqueCells, 19);
  assert.equal(explorationRule(candidateFacts(diagnosticState({ maze, current: maze.start, history: [] }, encoding, "topology"))), encoding.byPosition["2,1"]);
});

test("a compass-label response cannot bypass node-ID validation or be treated as an execution command", async () => {
  const maze = parseMaze("S.G");
  const encoding = createEncoding({ mazeId: "test", maze });
  const model = createChoiceModel(providerConfig("local", {}), async (_input, init) => responseFor(JSON.parse(String(init?.body)), "right"));
  const trace = await runTask(createMazeTask(maze), rulePolicy(maze, encoding, model), 5);
  assert.equal(trace.status, "error");
  assert.match(trace.error!, /invalid choice/);
  assert.equal(trace.steps.length, 1);
  assert.equal(model.stats.calls, 1);
  assert.ok(model.stats.failure?.response);
});

test("rule rollout rejects invalid options before creating model clients", async () => {
  const options = { solvers: ["local"], cases: [], trials: 1 };
  const factory = () => { throw new Error("Must not create a client"); };
  for (const invalid of [{ ...options, solvers: ["unknown"] }, { ...options, cases: ["fork-start"] }, { ...options, trials: 0 }, { ...options, maxSteps: 0 }]) {
    await assert.rejects(runRuleMaze(invalid, factory), /Rule maze|Trials|Step budget/);
  }
});
