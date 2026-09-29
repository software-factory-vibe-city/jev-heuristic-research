import { defineExperiment } from "../../core/experiment.js";
import type { ExperimentOptions } from "../../core/experiment.js";
import { createChoiceModel } from "../../providers/system-one.js";
import { runRuleMaze } from "../maze-rule/experiment.js";
import type { RuleCaseResult, RuleResult } from "../maze-rule/experiment.js";
import { generatedSuite, parameterKeys } from "./suite.js";
import type { GeneratedFixture } from "./suite.js";
import { renderGenerated } from "./render.js";

export interface GeneratedCase extends RuleCaseResult {
  layoutId: string;
  generation: GeneratedFixture["generation"];
  topology: GeneratedFixture["topology"];
}
export interface GeneratedResult extends Omit<RuleResult, "cases"> {
  suite: {
    config: ReturnType<typeof generatedSuite>["config"];
    geometry: string; encoding: string; budget: string; selection: string;
    layouts: number; uniqueGrids: number; conditions: number; scheduledRollouts: number; maxModelCalls: number;
  };
  cases: GeneratedCase[];
}

export async function runGenerated(options: ExperimentOptions, createModel = createChoiceModel): Promise<GeneratedResult> {
  const { config, fixtures } = generatedSuite(options);
  const layouts = new Set(fixtures.map((fixture) => fixture.layoutId)).size;
  const maxModelCalls = fixtures.reduce((sum, fixture) => sum + (options.maxSteps ?? fixture.topology.optimalMoves! * 4), 0) * options.trials * options.solvers.filter((solver) => solver === "local" || solver === "jev").length;
  console.log(`  Frozen suite: ${layouts} layouts, ${fixtures.length} encoding conditions, ${fixtures.length * options.trials * options.solvers.length} rollouts; at most ${maxModelCalls} model calls (no retries)`);
  const result = await runRuleMaze({ ...options, cases: [] }, createModel, {
    version: config.memory === "summary" ? "maze-generated-summary-v1" : "maze-generated-v1", fixtures, rotateSolversByCase: true,
  });
  result.protocol.options = options;
  result.protocol.controls += " The rule prompt is unchanged from maze-rule; the configured observation mode applies identically to models and code rule. Geometry is seeded independently of opaque-ID encoding. Families, generator seeds, topology summaries, optimum lengths, and code outcomes are never passed to the models.";
  return {
    ...result,
    suite: { config, layouts, uniqueGrids: new Set(fixtures.map((fixture) => fixture.generation.hash)).size,
      conditions: fixtures.length, scheduledRollouts: fixtures.length * options.trials * options.solvers.length, maxModelCalls,
      geometry: "Mulberry32 seeded generation. Logical N×N cells are rasterized as (2N+1)×(2N+1). Fixed start (1,1), goal (2N−1,2N−1); no endpoint selection by distance or solver behavior. Full raster topology is measured after generation.",
      encoding: "Independent encoding seeds vary opaque node IDs AND node ordering; choices remain sorted by ID. This is not an IDs-only intervention. Geometry is unchanged across encodings; repeats within a condition reuse identical encodings.",
      budget: "Default remains 4 × optimal moves, identically for all solvers, or an explicit --max-steps override. Exhaustion means failure within that budget, not proof the policy can never solve the maze. Complete traces are retained for auditing. " + (config.memory === "summary" ? "Models receive memory summaries without chronological history, at every step; there is no sliding window or automatic context-dependent truncation." : "Full histories are supplied without truncation."),
      selection: "All requested family × size × geometry-seed × encoding-seed conditions are retained, including errors and code-rule failures. No solver-outcome-based seed search or rejection. --cases explicitly selects layouts before any inference. Repeated encodings and trials are not independent layouts. Identical grids, if any, are retained and counted separately by hash. Loops and rooms share a DFS base with corridors for the same size/seed, so those families are related samples.",
    },
    cases: result.cases.map((item) => {
      const fixture = fixtures.find((fixture) => fixture.id === item.id)!;
      if (item.optimalMoves !== fixture.topology.optimalMoves) throw new Error(`A*/BFS evaluator disagreement: ${item.id}`);
      return { ...item, layoutId: fixture.layoutId, generation: fixture.generation, topology: fixture.topology };
    }),
  };
}

export const generatedMazeExperiment = defineExperiment({
  id: "maze-generated", title: "Maze · seeded generalization", defaultSolvers: ["astar", "rule", "local"], parameterKeys,
  run: (options) => runGenerated(options), render: renderGenerated,
});
