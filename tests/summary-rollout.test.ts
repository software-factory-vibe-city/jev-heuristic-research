import { test } from "node:test";
import assert from "node:assert/strict";
import { createChoiceModel, providerConfig } from "../src/providers/system-one.js";
import { checkpointDefinitions, freezeCheckpoint } from "../src/experiments/maze-diagnostics/checkpoints.js";
import { createEncoding } from "../src/experiments/maze-diagnostics/encoding.js";
import { explorationRule, hypothesisState, ruleInstructions } from "../src/experiments/maze-hypotheses/arms.js";
import { rulePolicy } from "../src/experiments/maze-rule/policy.js";
import { runRuleMaze } from "../src/experiments/maze-rule/experiment.js";
import { ruleObservation } from "../src/experiments/maze-rule/observation.js";
import { runGenerated } from "../src/experiments/maze-generated/experiment.js";
import { generatedSuite, suiteParameters } from "../src/experiments/maze-generated/suite.js";
import { renderGenerated } from "../src/experiments/maze-generated/render.js";

const response = (request: any, selected = explorationRule(request.state.candidate_facts)) => Response.json({
  model: "test-model", answers: { answer: { type: "choice", choice: selected, confidence: 1,
    probabilities: Object.fromEntries(Object.keys(request.questions.answer.criteria).map((id) => [id, id === selected ? 1 : 0])) } },
  usage: { input_tokens: 10, output_tokens: 1 },
});
const noHistory = (request: any) => {
  assert.ok(!Object.hasOwn(request.state, "history"));
  assert.doesNotMatch(JSON.stringify(request), /\b(history|chronolog\w*|trajectory)\b/i);
  assert.equal(request.questions.answer.instructions, ruleInstructions);
  assert.deepEqual(Object.keys(request.questions.answer.criteria), request.state.legal_destinations);
};

test("summary amendment changes only the history field, with no history prompting anywhere in the request", async () => {
  for (const definition of checkpointDefinitions) {
    const observation = freezeCheckpoint(definition), encoding = createEncoding(observation);
    const { history, ...expected } = hypothesisState(observation, encoding, "rule") as any;
    assert.equal(history.length, observation.history.length);
    assert.deepEqual(ruleObservation(observation, encoding, "summary"), expected);
    assert.deepEqual(ruleObservation(observation, encoding), hypothesisState(observation, encoding, "rule"));
    const bodies: any[] = [];
    for (const memory of ["full", "summary"] as const) {
      const model = createChoiceModel(providerConfig("local", {}), async (_url, init) => {
        const body = JSON.parse(String(init?.body)); bodies.push(body); return response(body);
      });
      await rulePolicy(observation.maze, encoding, model, memory)(observation.current, observation.history);
    }
    const full = structuredClone(bodies[0]); delete full.state.history;
    assert.deepEqual(bodies[1], full); noHistory(bodies[1]);
  }
});

test("all 16 generated code trajectories and geometry remain identical without chronology", async () => {
  const options = { solvers: ["astar", "rule"], cases: [], trials: 1, maxSteps: 2000 };
  const full = await runGenerated(options), summary = await runGenerated({ ...options, parameters: { memory: "summary" } });
  assert.equal(summary.cases.length, 16);
  assert.equal(summary.protocol.version, "maze-generated-summary-v1");
  assert.equal(summary.protocol.memory, "summary");
  assert.equal(full.protocol.version, "maze-generated-v1");
  assert.deepEqual(generatedSuite(options).fixtures, generatedSuite({ ...options, parameters: { memory: "summary" } }).fixtures);
  for (const [index, item] of summary.cases.entries()) {
    const previous = full.cases[index]!;
    assert.deepEqual(item.encoding, previous.encoding); assert.deepEqual(item.maze, previous.maze);
    for (const [i, run] of item.runs.entries()) {
      assert.equal(run.trace.status, "solved"); assert.equal(run.metrics.ruleViolations, 0);
      assert.deepEqual(run.trace.steps.map((step) => step.action), previous.runs[i]!.trace.steps.map((step) => step.action));
      for (const [stepIndex, step] of run.trace.steps.entries()) if (step.metadata?.source === "code-rule") {
        assert.equal(step.metadata.state, undefined);
        assert.equal(step.metadata.observationCapture, "candidate-facts-only");
        const state = ruleObservation({ maze: item.maze, current: step.before, history: run.trace.steps.slice(0, stepIndex) }, item.encoding, "summary");
        assert.ok("candidate_facts" in state);
        assert.deepEqual(step.metadata.ruleInputs, state.candidate_facts);
      }
    }
  }
  assert.equal(summary.cases.find((item) => item.layoutId === "rooms-5x5-s101")!.runs.find((run) => run.solver === "rule")!.trace.steps.length, 66);
  const html = renderGenerated(summary);
  assert.match(html, /summary-only amendment/); assert.match(html, /no chronological history or prompts to consult it/);
  assert.doesNotMatch(html, /Models see.*full evolving history/);
});

test("summary-only model rollouts use actual evolving counts and previous flags, including forced transitions", async () => {
  const result = await runGenerated({ solvers: ["rule", "local"], cases: [], trials: 2, maxSteps: 200,
    parameters: { families: "branching,loops,rooms", sizes: "3", seeds: "101", memory: "summary" } }, (config) => createChoiceModel(config, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); noHistory(body); return response(body);
  }));
  for (const item of result.cases) for (const run of item.runs.filter((run) => run.solver === "local")) {
    const code = item.runs.find((other) => other.solver === "rule" && other.trial === run.trial)!;
    assert.deepEqual(run.trace.steps.map((step) => step.action), code.trace.steps.map((step) => step.action));
    assert.equal(run.metrics.ruleViolations, 0);
    assert.equal(run.metrics.modelCalls + run.metrics.forcedMoves!, run.trace.steps.length);
    for (const [index, step] of run.trace.steps.entries()) if (step.metadata?.request) {
      const request = step.metadata.request as any;
      const { history: _history, ...expected } = hypothesisState({ maze: item.maze, current: step.before, history: run.trace.steps.slice(0, index) }, item.encoding, "rule") as any;
      assert.deepEqual(request.state, expected);
      assert.equal(request.state.visit_counts.reduce((sum: number, visit: any) => sum + visit.count, 0), index + 1);
    }
  }
});

test("long summary-only loops retain exact memory but no growing transcript and no action correction", async () => {
  const bodies: any[] = [];
  const result = await runRuleMaze({ solvers: ["local"], cases: ["corridor"], trials: 1, maxSteps: 400, parameters: { memory: "summary" } }, (config) => createChoiceModel(config, async (_url, init) => {
    const body = JSON.parse(String(init?.body)); noHistory(body); bodies.push(body);
    return response(body, body.state.candidate_facts.find((fact: any) => fact.previous_position).destination);
  }));
  const run = result.cases[0]!.runs[0]!;
  assert.equal(result.protocol.version, "maze-rule-summary-v1");
  assert.equal(run.trace.status, "budget-exhausted"); assert.equal(run.trace.steps.length, 400);
  assert.equal(run.metrics.modelCalls, 200); assert.equal(run.metrics.forcedMoves, 200); assert.equal(run.metrics.ruleViolations, 200);
  assert.ok(JSON.stringify(bodies.at(-1)).length - JSON.stringify(bodies[0]).length < 100);
  assert.equal(bodies.at(-1).state.visit_counts.reduce((sum: number, visit: any) => sum + visit.count, 0), 400);
  assert.ok(run.trace.steps.every((step, i) => step.action === (i % 2 ? "left" : "right")));
});

test("summary-only failures preserve evidence without history; invalid memory settings fail before model creation", async () => {
  const options = { solvers: ["local"], cases: ["corridor"], trials: 1, parameters: { memory: "summary" } };
  const result = await runRuleMaze(options, (config) => createChoiceModel(config, async (_url, init) => {
    noHistory(JSON.parse(String(init?.body))); return Response.json({ message: "offline" }, { status: 503 });
  }));
  const run = result.cases[0]!.runs[0]!;
  assert.equal(run.trace.status, "error"); assert.equal(run.trace.steps.length, 1);
  assert.equal(run.metrics.modelCalls, 1); noHistory(run.modelStats!.failure!.request);
  assert.throws(() => suiteParameters({ memory: "none" }), /Rule memory/);
  const factory = () => { throw new Error("Must not create a client"); };
  await assert.rejects(runRuleMaze({ ...options, parameters: { memory: "none" } }, factory), /Rule memory/);
  await assert.rejects(runGenerated({ ...options, cases: [], parameters: { memory: "none" } }, factory), /Rule memory/);
});
