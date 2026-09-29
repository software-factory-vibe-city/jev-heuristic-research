export interface ExperimentOptions {
  solvers: string[];
  cases: string[];
  trials: number;
  maxSteps?: number;
  parameters?: Record<string, string>;
}

/** The shell knows nothing about an experiment's states, actions, or visualization. */
export interface Experiment<T> {
  id: string;
  title: string;
  defaultSolvers?: readonly string[];
  parameterKeys?: readonly string[];
  run(options: ExperimentOptions): Promise<T>;
  render(result: T): string;
}

export function defineExperiment<T>(experiment: Experiment<T>) {
  return {
    id: experiment.id,
    title: experiment.title,
    defaultSolvers: experiment.defaultSolvers,
    async execute(options: ExperimentOptions) {
      for (const key of Object.keys(options.parameters ?? {})) {
        if (!experiment.parameterKeys?.includes(key)) throw new Error(`Unsupported parameter for ${experiment.id}: ${key}`);
      }
      if (!Number.isSafeInteger(options.trials) || options.trials < 1) throw new Error("Trials must be a positive integer");
      if (options.maxSteps !== undefined && (!Number.isSafeInteger(options.maxSteps) || options.maxSteps < 1)) {
        throw new Error("Step budget must be a positive integer");
      }
      const data = await experiment.run(options);
      return {
        data,
        body: experiment.render(data),
        summary: `${options.solvers.join(" + ")} · ${options.cases.join(", ") || "all cases"} · ${options.trials} trial(s)`,
      };
    },
  };
}
