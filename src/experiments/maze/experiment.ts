import { astar } from "../../core/astar.js";
import { defineExperiment } from "../../core/experiment.js";
import type { ExperimentOptions } from "../../core/experiment.js";
import { runTask } from "../../core/task.js";
import type { Policy, TaskRun } from "../../core/task.js";
import { createChoiceModel, providerConfig } from "../../providers/system-one.js";
import type { ModelStats } from "../../providers/system-one.js";
import { mazeCases } from "./cases.js";
import { createMazeTask, parseMaze, positionKey } from "./domain.js";
import type { Maze, Move, Position } from "./domain.js";
import { instructions, mazePolicy, policyVersion } from "./policy.js";
import { renderMaze } from "./render.js";
import { representationInstructions, representationPolicy, representationPolicyVersion, representations } from "./representations.js";
import type { Representation } from "./representations.js";

export type MazeStudy = "baseline" | "representation";

/** A* is a representation-independent reference, so run it once per case/trial. */
export function scheduleRuns(solvers: string[], trial: number, caseIndex: number, study: MazeStudy) {
  const ordered = trial % 2 === 0 ? [...solvers].reverse() : solvers;
  return ordered.flatMap<{ solver: string; representation: Representation | null }>((solver) => {
    if (solver === "astar") return [{ solver, representation: null }];
    const arms: Representation[] = study === "baseline" ? ["ascii"] : [...representations];
    if ((caseIndex + trial - 1) % 2 === 1) arms.reverse();
    return arms.map((representation) => ({ solver, representation }));
  });
}

export interface MazeRun {
  solver: string;
  representation: Representation | null;
  label: string;
  trial: number;
  trace: TaskRun<Position, Move>;
  metrics: {
    moves: number;
    invalidMoves: number;
    revisits: number;
    efficiency: number | null;
    modelCalls: number;
    /** Absent in historical artifacts before forced moves were introduced. */
    forcedMoves?: number;
    expandedStates: number | null;
  };
  modelStats?: ModelStats;
  expanded: Position[];
}
export interface MazeCaseResult {
  id: string;
  title: string;
  description: string;
  maze: Maze;
  optimalMoves: number;
  maxSteps: number;
  runs: MazeRun[];
}
export interface MazeResult {
  protocol: {
    study: MazeStudy;
    representations: readonly Representation[];
    executionOrder: string;
    policyVersion: string;
    /** Absent in historical v1 artifacts, which offered all four directions. */
    actionSpace?: "all-directions" | "legal-only";
    /** Before v3, even a singleton choice was sent to the model. */
    singleLegalMove?: "model" | "forced";
    instructions: string;
    options: ExperimentOptions;
    providers: { id: string; model: string; baseURL: string; timeoutMs: number; retries: number }[];
  };
  cases: MazeCaseResult[];
}

export async function runMaze(
  options: ExperimentOptions,
  study: MazeStudy = "baseline",
  createModel = createChoiceModel,
): Promise<MazeResult> {
  if (!options.solvers.length || options.solvers.some((id) => !["astar", "local", "jev"].includes(id))) {
    throw new Error("Maze solvers: astar, local, jev");
  }
  const selectedCases = options.cases.length ? mazeCases.filter((item) => options.cases.includes(item.id)) : [...mazeCases];
  if (options.cases.some((id) => !mazeCases.some((item) => item.id === id))) {
    throw new Error(`Maze cases: ${mazeCases.map((item) => item.id).join(", ")}`);
  }
  // Fail configuration before making requests. Operational errors are saved as failed runs.
  const configs = options.solvers.filter((id) => id !== "astar").map((id) => providerConfig(id as "local" | "jev"));
  const result: MazeResult = {
    protocol: {
      study,
      representations: study === "baseline" ? ["ascii"] : representations,
      executionOrder: "Sequential; solver order reverses on even trials. Representation order reverses on alternating case/trial parity; run arrays preserve execution order. A* runs once per case/trial.",
      policyVersion: study === "baseline" ? policyVersion : representationPolicyVersion,
      actionSpace: "legal-only",
      singleLegalMove: "forced",
      instructions: study === "baseline" ? instructions : representationInstructions,
      options,
      providers: configs.map(({ apiKey: _secret, ...config }) => ({ ...config, retries: 0 })),
    },
    cases: [],
  };
  for (const [caseIndex, fixture] of selectedCases.entries()) {
    const maze = parseMaze(fixture.ascii);
    const task = createMazeTask(maze);
    const heuristic = (state: Position) => Math.abs(state.x - maze.goal.x) + Math.abs(state.y - maze.goal.y);
    // Oracle computed separately, outside all solver timings, and never passed to a model.
    const optimal = astar(task, heuristic).actions;
    if (!optimal) throw new Error(`Unreachable fixture: ${fixture.id}`);
    const caseResult: MazeCaseResult = {
      id: fixture.id, title: fixture.title, description: fixture.description, maze,
      optimalMoves: optimal.length, maxSteps: options.maxSteps ?? optimal.length * 4, runs: [],
    };
    for (let trial = 1; trial <= options.trials; trial++) {
      // Fresh policy, model stats, and history for every arm; no information crosses between them.
      for (const { solver, representation } of scheduleRuns(options.solvers, trial, caseIndex, study)) {
        const config = configs.find((item) => item.id === solver);
        const model = config ? createModel(config) : undefined;
        let expanded: Position[] = [];
        let plan: Move[] | null | undefined;
        const policy: Policy<Position, Move> = model
          ? study === "baseline" ? mazePolicy(maze, model) : representationPolicy(maze, model, representation!)
          : (_state, history) => {
          // Include A* planning in its end-to-end timing, but not the evaluation oracle.
          if (plan === undefined) {
            const search = astar(task, heuristic);
            plan = search.actions;
            expanded = search.expanded;
          }
          const action = plan?.[history.length];
          return action ? { action } : null;
        };
        console.log(`  ${fixture.id} / ${solver}${representation ? ` / ${representation}` : ""} / trial ${trial} (budget ${caseResult.maxSteps})`);
        const trace = await runTask(task, policy, caseResult.maxSteps);
        const seen = new Set([positionKey(trace.initial)]);
        let revisits = 0;
        let validMoves = 0;
        for (const step of trace.steps) {
          if (!step.valid) continue;
          validMoves++;
          const key = positionKey(step.after);
          if (seen.has(key)) revisits++;
          seen.add(key);
        }
        const run: MazeRun = {
          solver, representation, label: solver === "astar" ? "A* · Manhattan" : `${solver === "jev" ? "Jev" : "Local"} · ${config!.model}`,
          trial, trace, expanded, modelStats: model?.stats,
          metrics: {
            moves: validMoves,
            invalidMoves: trace.steps.length - validMoves,
            revisits,
            efficiency: trace.status === "solved" ? optimal.length / trace.steps.length : null,
            modelCalls: model?.stats.calls ?? 0,
            forcedMoves: trace.steps.filter((step) => step.metadata?.source === "forced").length,
            expandedStates: solver === "astar" ? expanded.length : null,
          },
        };
        caseResult.runs.push(run);
        console.log(`    ${trace.status}: ${trace.steps.length} attempts, ${trace.elapsedMs.toFixed(0)} ms`);
        if (trace.error) console.warn(`    ${trace.error}`);
      }
    }
    result.cases.push(caseResult);
  }
  return result;
}

export const mazeExperiment = defineExperiment({ id: "maze", title: "ASCII maze", run: (options) => runMaze(options), render: renderMaze });
