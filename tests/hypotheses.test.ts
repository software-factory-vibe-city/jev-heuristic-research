import { test } from "node:test";
import assert from "node:assert/strict";
import { createChoiceModel } from "../src/providers/system-one.js";
import { checkpointDefinitions, freezeCheckpoint } from "../src/experiments/maze-diagnostics/checkpoints.js";
import { createEncoding, diagnosticState } from "../src/experiments/maze-diagnostics/encoding.js";
import { expectedAnswers } from "../src/experiments/maze-diagnostics/probes.js";
import { actionInstructions, arms, candidateFacts, contrasts, explorationRule, hypothesisState, instructionsFor, ruleInstructions } from "../src/experiments/maze-hypotheses/arms.js";
import { hypothesisSchedule, mazeHypothesesExperiment, runHypotheses } from "../src/experiments/maze-hypotheses/experiment.js";
import { hypothesisPairs } from "../src/experiments/maze-hypotheses/comparison.js";
import { renderHypotheses } from "../src/experiments/maze-hypotheses/render.js";

const options = { solvers: ["local"], cases: ["corridor-after-loop", "fork-after-dead-end"], trials: 3 };
const reply = (request: any) => {
  const labels = Object.keys(request.questions.answer.criteria);
  assert.equal(labels.length, 2);
  return Response.json({ model: "test-model", answers: { answer: { type: "choice", choice: labels[0], confidence: 1,
    probabilities: Object.fromEntries(labels.map((label, index) => [label, index === 0 ? 1 : 0])),
  } }, usage: { input_tokens: 10, output_tokens: 1 } });
};

test("candidate facts are exact observation lookups, including the latest reversal and empty history", () => {
  for (const definition of checkpointDefinitions) {
    const checkpoint = freezeCheckpoint(definition);
    const state = diagnosticState(checkpoint, createEncoding(checkpoint), "topology");
    const facts = candidateFacts(state);
    assert.deepEqual(facts.map((fact) => fact.destination), state.legal_destinations);
    assert.equal(facts.filter((fact) => fact.previous_position).length, state.history.length ? 1 : 0);
    for (const fact of facts) {
      assert.equal(fact.visit_count, state.visit_counts.find((entry) => entry.node === fact.destination)?.count ?? 0);
      assert.equal(fact.previous_position, state.history.at(-1)?.from === fact.destination);
      assert.equal(fact.neighbor_count, state.graph.nodes.find((node) => node.id === fact.destination)!.neighbors.length);
      assert.equal(fact.dead_end, fact.neighbor_count === 1);
      assert.deepEqual(Object.keys(fact), ["destination", "visit_count", "previous_position", "neighbor_count", "dead_end"]);
    }
    if (checkpoint.id === "fork-after-dead-end") {
      const previous = facts.find((fact) => fact.previous_position)!;
      assert.equal(previous.dead_end, true);
      assert.equal(previous.visit_count, 1);
      assert.equal(facts.find((fact) => !fact.previous_position)!.dead_end, false);
    }
  }
});

test("hypothesis inputs isolate added facts, removed chronology, and prompt-only strategy changes", () => {
  assert.ok(!actionInstructions.includes("check the full movement history"));
  assert.equal(instructionsFor("control"), instructionsFor("facts"));
  assert.equal(instructionsFor("facts"), instructionsFor("summary"));
  assert.notEqual(instructionsFor("rule"), instructionsFor("facts"));
  for (const definition of checkpointDefinitions) {
    const checkpoint = freezeCheckpoint(definition);
    const encoding = createEncoding(checkpoint);
    const control = hypothesisState(checkpoint, encoding, "control");
    const facts = hypothesisState(checkpoint, encoding, "facts");
    const summary = hypothesisState(checkpoint, encoding, "summary");
    const rule = hypothesisState(checkpoint, encoding, "rule");
    assert.ok("candidate_facts" in facts && "candidate_fact_definition" in facts);
    const { candidate_facts, candidate_fact_definition: _definition, ...withoutFacts } = facts;
    assert.deepEqual(withoutFacts, control);
    assert.deepEqual(candidate_facts, candidateFacts(diagnosticState(checkpoint, encoding, "topology")));
    assert.ok("history" in facts);
    const { history: _history, ...withoutTrajectory } = facts;
    assert.deepEqual(withoutTrajectory, summary);
    assert.deepEqual(rule, facts);
    for (const arm of arms) {
      const state = hypothesisState(checkpoint, encoding, arm);
      assert.deepEqual(state.graph, control.graph);
      assert.deepEqual(state.legal_destinations, control.legal_destinations);
      assert.equal(state.goal, control.goal);
      assert.ok(!/"(coordinates|x|y|distance|expectedAction|codeReference|recommended_action)"/.test(JSON.stringify(state)));
      assert.ok(!/\b(up|right|down|left)\b/.test(JSON.stringify(state)));
    }
  }
});

test("code rule follows all prompt priorities and does not mutate facts", () => {
  const facts = [
    { destination: "n02", visit_count: 5, previous_position: false, neighbor_count: 2, dead_end: false },
    { destination: "n01", visit_count: 0, previous_position: true, neighbor_count: 1, dead_end: true },
  ];
  const original = structuredClone(facts);
  assert.equal(explorationRule(facts), "n02"); // Exclude previous before considering visits.
  assert.deepEqual(facts, original);
  assert.equal(explorationRule(facts.map((fact) => ({ ...fact, previous_position: false }))), "n01");
  assert.equal(explorationRule(facts.map((fact) => ({ ...fact, previous_position: false, visit_count: 0 }))), "n01");
  assert.equal(explorationRule([facts[1]!]), "n01"); // A forced reversal is permitted.
  assert.throws(() => explorationRule([]), /needs a legal candidate/);
});

test("the code rule is not an oracle: its arbitrary tie-break can select a non-shortest branch", () => {
  const checkpoint = freezeCheckpoint(checkpointDefinitions.find((item) => item.id === "fork-start")!);
  let counterexample = false;
  for (let seed = 1; seed <= 50; seed++) {
    const encoding = createEncoding(checkpoint, seed);
    const state = diagnosticState(checkpoint, encoding, "topology");
    const action = explorationRule(candidateFacts(state));
    assert.equal(action, [...state.legal_destinations].sort()[0]);
    if (!expectedAnswers(checkpoint, encoding, "action").includes(action)) counterexample = true;
  }
  assert.equal(counterexample, true);
});

test("hypothesis schedule includes every arm once per provider and balances positions over four blocks", () => {
  const providers = ["local", "jev"] as const;
  const orders = Array.from({ length: 4 }, (_, caseIndex) => hypothesisSchedule(providers, 1, caseIndex).filter((sample) => sample.solver === "local").map((sample) => sample.arm));
  for (let position = 0; position < arms.length; position++) assert.equal(new Set(orders.map((order) => order[position])).size, arms.length);
  const schedule = hypothesisSchedule(providers, 1, 0);
  assert.equal(schedule.length, 8);
  assert.equal(new Set(schedule.map((item) => JSON.stringify(item))).size, 8);
  assert.equal(schedule[0]!.solver, "local");
  assert.equal(hypothesisSchedule(providers, 2, 0)[0]!.solver, "jev");
  assert.deepEqual(providers, ["local", "jev"]);
});

test("runner uses independent matching requests, keeps grading outside inputs, and preserves contrary model choices", async () => {
  let clients = 0;
  const result = await runHypotheses(options, (config) => {
    clients++;
    return createChoiceModel(config, async (_input, init) => {
      const request = JSON.parse(String(init?.body));
      assert.deepEqual(Object.keys(request.questions), ["answer"]);
      return reply(request);
    });
  });
  assert.deepEqual(mazeHypothesesExperiment.defaultSolvers, ["local"]);
  assert.equal(result.samples.length, 24);
  assert.equal(clients, 24);
  assert.equal(result.protocol.providers[0]!.retries, 0);
  assert.ok(!JSON.stringify(result.protocol).includes("apiKey"));
  for (const sample of result.samples) {
    const checkpoint = result.cases.find((item) => item.id === sample.checkpoint)!;
    assert.equal(sample.status, "ok");
    assert.equal(sample.modelStats.calls, 1);
    assert.equal(sample.modelStats.inputTokens, 10);
    assert.equal(sample.correct, checkpoint.expectedAction.includes(sample.decision!.action));
    assert.equal(sample.correctProbability, Number(sample.correct));
    assert.equal(sample.ruleAgrees, checkpoint.codeReference.action === sample.decision!.action);
    assert.equal(sample.ruleProbability, Number(sample.ruleAgrees));
    const request = sample.decision!.metadata!.request as any;
    assert.equal(sample.decision!.action, Object.keys(request.questions.answer.criteria)[0]);
    assert.deepEqual(request.state, hypothesisState(checkpoint, checkpoint.encoding, sample.arm));
    assert.equal(request.questions.answer.instructions, instructionsFor(sample.arm));
    const first = result.samples.find((item) => item.checkpoint === sample.checkpoint && item.arm === sample.arm && item.trial === 1)!;
    assert.deepEqual(request, first.decision!.metadata!.request);
  }
  for (const pair of hypothesisPairs(result)) {
    const control = structuredClone(pair.control.decision!.metadata!.request) as any;
    const treatment = structuredClone(pair.treatment.decision!.metadata!.request) as any;
    if (pair.contrast.id === "H1") {
      delete treatment.state.candidate_facts;
      delete treatment.state.candidate_fact_definition;
    } else if (pair.contrast.id === "H2") delete control.state.history;
    else treatment.questions.answer.instructions = control.questions.answer.instructions;
    assert.deepEqual(control, treatment);
    assert.equal(pair.probabilityDelta, 0);
  }
  assert.equal(hypothesisPairs(result).length, 18);
  const html = renderHypotheses(result);
  assert.ok(html.includes("Code-only rule reference"));
  assert.ok(html.includes("Rule-arm adherence"));
  assert.ok(html.includes("H1 / Explicit facts"));
  assert.ok(html.includes("Human-only reconstruction"));
  assert.ok(html.includes("&quot;candidate_facts&quot;"));
  assert.equal((html.match(/class="state-inspector"/g) ?? []).length, 24);
  assert.ok(!html.includes("<script"));
});

test("hypothesis errors do not become treatment wins and do not prevent the remaining arms", async () => {
  let calls = 0;
  const result = await runHypotheses({ ...options, cases: ["fork-start"], trials: 1 }, (config) => createChoiceModel(config, async (_input, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    return request.questions.answer.instructions === ruleInstructions ? Response.json({ message: "offline <script>" }, { status: 503 }) : reply(request);
  }));
  assert.equal(calls, 4);
  const failure = result.samples.find((sample) => sample.status === "error")!;
  assert.equal(failure.correctProbability, null);
  assert.equal(failure.correct, null);
  assert.equal(failure.ruleAgrees, null);
  assert.equal(failure.ruleProbability, null);
  assert.equal(failure.decision, undefined);
  assert.ok(failure.modelStats.failure?.request);
  assert.equal(failure.modelStats.calls, 1);
  const pairs = hypothesisPairs(result);
  assert.equal(pairs.filter((pair) => pair.valid).length, 2);
  assert.equal(pairs.find((pair) => pair.contrast.id === "H3")!.outcome, "error");
  assert.equal(pairs.find((pair) => pair.contrast.id === "H3")!.probabilityDelta, null);
  const html = renderHypotheses(result);
  assert.ok(html.includes("offline &lt;script&gt;"));
  assert.ok(!html.includes("offline <script>"));
  assert.throws(() => hypothesisPairs({ ...result, samples: [...result.samples, result.samples[0]!] }), /Duplicate/);
  assert.throws(() => hypothesisPairs({ ...result, samples: result.samples.slice(1) }), /Incomplete/);
});

test("invalid hypothesis options fail before work", async () => {
  const factory = () => { throw new Error("Must not create a client"); };
  for (const invalid of [
    { ...options, solvers: ["astar"] }, { ...options, cases: ["unknown"] },
    { ...options, maxSteps: 10 }, { ...options, trials: 0 },
  ]) await assert.rejects(runHypotheses(invalid, factory), /Hypothesis|Frozen-state|Trials/);
  assert.equal(contrasts.length, 3);
  assert.equal(arms.length * checkpointDefinitions.length * 3 * 2, 144);
});
