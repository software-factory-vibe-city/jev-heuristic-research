import { astar } from "../../core/astar.js";
import { defineExperiment } from "../../core/experiment.js";
import type { ExperimentOptions } from "../../core/experiment.js";
import { runTask } from "../../core/task.js";
import type { Policy, TaskRun } from "../../core/task.js";
import { createChoiceModel, providerConfig } from "../../providers/system-one.js";
import type { ProviderId } from "../../providers/system-one.js";
import { mazeCases } from "../maze/cases.js";
import { createMazeTask, parseMaze, positionKey, samePosition } from "../maze/domain.js";
import type { Maze, Move, Position } from "../maze/domain.js";
import type { MazeCaseResult, MazeRun } from "../maze/experiment.js";
import { createEncoding, diagnosticState, encodingSeed } from "../maze-diagnostics/encoding.js";
import type { Encoding } from "../maze-diagnostics/encoding.js";
import { candidateFacts, explorationRule, ruleInstructions } from "../maze-hypotheses/arms.js";
import { rulePolicy } from "./policy.js";
import { ruleMemory } from "./observation.js";
import type { RuleMemory } from "./observation.js";
import { renderRuleExperiment } from "./render.js";

export interface RuleFixture { id: string; title: string; description: string; ascii: string; encodingId?: string; encodingSeed?: number }
export interface RuleStudy { version: string; fixtures: readonly RuleFixture[]; rotateSolversByCase?: boolean }
export interface RuleRun extends MazeRun {
  metrics: MazeRun["metrics"] & { ruleChecks: number; ruleMatches: number; ruleViolations: number; twoStepReturns: number; longestStagnation: number; uniqueCells: number;
    junctionChecks: number; junctionMatches: number; tieChecks: number; tieMatches: number };
}
export interface RuleCaseResult extends MazeCaseResult { encoding: Encoding; runs: RuleRun[] }
export interface RuleResult {
  protocol: {
    version: string; instructions: string; encodingSeed: number | null; options: ExperimentOptions; memory?: RuleMemory;
    actionSpace: string; singleLegalMove: string; executionOrder: string; controls: string; codeEvidence?: string;
    providers: { id: string; model: string; baseURL: string; timeoutMs: number; retries: number }[];
  };
  cases: RuleCaseResult[];
}

/** Post-run only: score rule agreement against each run's own evolving state, never feed it back. */
export function auditTrace(maze: Maze, encoding: Encoding, trace: TaskRun<Position, Move>, checkRule: boolean) {
  const seen = new Set([positionKey(trace.initial)]);
  let moves = 0, revisits = 0, forcedMoves = 0, ruleChecks = 0, ruleMatches = 0, twoStepReturns = 0, longestStagnation = 0, stagnation = 0;
  let junctionChecks = 0, junctionMatches = 0, tieChecks = 0, tieMatches = 0;
  for (const [index, step] of trace.steps.entries()) {
    const forced = step.metadata?.source === "forced";
    if (forced) forcedMoves++;
    if (step.valid) {
      moves++;
      if (seen.has(positionKey(step.after))) { revisits++; stagnation++; }
      else { seen.add(positionKey(step.after)); stagnation = 0; }
      if (index > 0 && trace.steps[index - 1]!.valid && samePosition(step.after, trace.steps[index - 1]!.before)) twoStepReturns++;
    } else stagnation++;
    longestStagnation = Math.max(longestStagnation, stagnation);
    if (checkRule) {
      const state = diagnosticState({ maze, current: step.before, history: trace.steps.slice(0, index) }, encoding, "topology");
      const facts = candidateFacts(state);
      const expectedDestination = explorationRule(facts);
      const agrees = step.valid && encoding.byPosition[positionKey(step.after)] === expectedDestination;
      step.metadata = { ...step.metadata, ruleAudit: { expectedDestination, agrees, forced, evaluationOnly: true } };
      // Forced singleton transitions are not model or code policy choices.
      if (!forced) {
        ruleChecks++; if (agrees) ruleMatches++;
        if (facts.length >= 3) { junctionChecks++; if (agrees) junctionMatches++; }
        const nonPrevious = facts.filter((fact) => !fact.previous_position);
        const eligible = nonPrevious.length ? nonPrevious : facts;
        const minVisits = Math.min(...eligible.map((fact) => fact.visit_count));
        if (eligible.filter((fact) => fact.visit_count === minVisits).length > 1) { tieChecks++; if (agrees) tieMatches++; }
      }
    }
  }
  return { moves, revisits, forcedMoves, invalidMoves: trace.steps.length - moves,
    ruleChecks, ruleMatches, ruleViolations: ruleChecks - ruleMatches, twoStepReturns, longestStagnation, uniqueCells: seen.size,
    junctionChecks, junctionMatches, tieChecks, tieMatches };
}

export async function runRuleMaze(options: ExperimentOptions, createModel = createChoiceModel, study?: RuleStudy): Promise<RuleResult> {
  const memory = ruleMemory(options.parameters?.memory);
  const fixtures: readonly RuleFixture[] = study?.fixtures ?? mazeCases;
  if (!fixtures.length || new Set(fixtures.map((fixture) => fixture.id)).size !== fixtures.length) throw new Error("Rule maze fixtures must be nonempty with unique IDs");
  if (!options.solvers.length || options.solvers.some((id) => !["astar", "rule", "local", "jev"].includes(id))) throw new Error("Rule maze solvers: astar, rule, local, jev");
  if (!Number.isSafeInteger(options.trials) || options.trials < 1) throw new Error("Trials must be a positive integer");
  if (options.maxSteps !== undefined && (!Number.isSafeInteger(options.maxSteps) || options.maxSteps < 1)) throw new Error("Step budget must be a positive integer");
  if (options.cases.some((id) => !fixtures.some((item) => item.id === id))) throw new Error(`Rule maze cases: ${fixtures.map((item) => item.id).join(", ")}`);
  const configs = options.solvers.filter((id) => id === "local" || id === "jev").map((id) => providerConfig(id as ProviderId));
  const selected = options.cases.length ? fixtures.filter((item) => options.cases.includes(item.id)) : fixtures;
  const encodingSeeds = new Set(selected.map((item) => item.encodingSeed ?? encodingSeed));
  const result: RuleResult = {
    protocol: {
      version: study?.version ?? (memory === "summary" ? "maze-rule-summary-v1" : "maze-rule-rollout-v1"), instructions: ruleInstructions, memory,
      encodingSeed: encodingSeeds.size === 1 ? [...encodingSeeds][0]! : null, options,
      actionSpace: "Legal destination IDs only, including the previous node. Mapping to compass moves is execution-only, outside model inputs.",
      singleLegalMove: "Forced without a model call for both providers and the code rule; logged, budgeted, and included in subsequent history.",
      executionOrder: `${study?.rotateSolversByCase ? "Sequential; solver order rotates by case index, then reverses on even trials." : "Sequential; solver order reverses on even trials."} Fresh start, history, and model statistics for every rollout. Node IDs and node order stay fixed across trials.`, 
      controls: (memory === "summary"
        ? "Summary-only amendment: omit chronological history from observations. Retain the identical complete coordinate-free graph, visit counts, candidate facts (including previous-position flags), definitions, legal choices, and rule question. The rule question already has no instruction to consult history; no history prompt is added. Complete traces remain in the harness for memory calculation, audit, and replay, not as model input. "
        : "Same full coordinate-free graph, candidate facts, complete history, legal choices, and exact rule question as the frozen hypothesis rule arm. ") +
        "No rule-compliance filter, loop pruning, fallback, or retries. A* is a separate reference; the code rule is a separate solver, never a rescue. Rule agreement is audited only after each run against its own visited states.",
      codeEvidence: "Code-only steps record the exact candidate facts consumed by explorationRule rather than duplicate the full graph at every move. Full observations remain reconstructible from the saved maze, encoding, trace, and memory mode. This changes evidence storage only, not the code algorithm or any model request. Model requests/responses and failed requests are retained in full.",
      providers: configs.map(({ apiKey: _secret, ...config }) => ({ ...config, retries: 0 })),
    }, cases: [],
  };
  for (const [caseIndex, fixture] of selected.entries()) {
    const maze = parseMaze(fixture.ascii);
    const encoding = createEncoding({ mazeId: fixture.encodingId ?? fixture.id, maze }, fixture.encodingSeed ?? encodingSeed);
    const task = createMazeTask(maze);
    const heuristic = (position: Position) => Math.abs(position.x - maze.goal.x) + Math.abs(position.y - maze.goal.y);
    const optimal = astar(task, heuristic).actions;
    if (!optimal) throw new Error(`Unreachable fixture: ${fixture.id}`);
    const item: RuleCaseResult = { id: fixture.id, title: fixture.title, description: fixture.description, maze, encoding,
      optimalMoves: optimal.length, maxSteps: options.maxSteps ?? optimal.length * 4, runs: [] };
    for (let trial = 1; trial <= options.trials; trial++) {
      const offset = study?.rotateSolversByCase ? caseIndex % options.solvers.length : 0;
      const rotated = [...options.solvers.slice(offset), ...options.solvers.slice(0, offset)];
      const order = trial % 2 === 0 ? rotated.reverse() : rotated;
      for (const solver of order) {
        const config = configs.find((config) => config.id === solver);
        const model = config ? createModel(config) : undefined;
        let expanded: Position[] = [];
        let plan: Move[] | null | undefined;
        const policy: Policy<Position, Move> = solver === "astar" ? (_current, history) => {
          if (plan === undefined) { const search = astar(task, heuristic); plan = search.actions; expanded = search.expanded; }
          const action = plan?.[history.length];
          return action ? { action } : null;
        } : rulePolicy(maze, encoding, model, memory);
        console.log(`  ${fixture.id} / ${solver} / trial ${trial} (budget ${item.maxSteps})`);
        const trace = await runTask(task, policy, item.maxSteps);
        const audited = auditTrace(maze, encoding, trace, solver !== "astar");
        const run: RuleRun = {
          solver, representation: solver === "astar" ? null : "graph", trial,
          label: solver === "astar" ? "A* · Manhattan" : solver === "rule" ? "Code · exploration rule" : `${solver === "local" ? "Local" : "Jev"} · ${config!.model}`,
          trace, expanded, modelStats: model?.stats,
          metrics: { ...audited, efficiency: trace.status === "solved" ? optimal.length / trace.steps.length : null,
            modelCalls: model?.stats.calls ?? 0, expandedStates: solver === "astar" ? expanded.length : null },
        };
        item.runs.push(run);
        console.log(`    ${trace.status}: ${trace.steps.length} attempts, ${run.metrics.modelCalls} calls, ${audited.forcedMoves} forced, rule ${audited.ruleMatches}/${audited.ruleChecks}, ${trace.elapsedMs.toFixed(0)} ms`);
        if (trace.error) console.warn(`    ${trace.error}`);
      }
    }
    result.cases.push(item);
  }
  return result;
}

export const mazeRuleExperiment = defineExperiment({
  id: "maze-rule", title: "Maze · rule-guided rollouts", defaultSolvers: ["astar", "rule", "local"], parameterKeys: ["memory"],
  run: (options) => runRuleMaze(options), render: renderRuleExperiment,
});
