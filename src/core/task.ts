/** Domain code owns S, A, T, and the terminal predicate; policies only choose actions. */
export interface Task<S, A> {
  initial: S;
  isTerminal(state: S): boolean;
  actions(state: S): readonly A[];
  transition(state: S, action: A): { state: S; valid: boolean };
  key(state: S): string;
}

export interface Decision<A> {
  action: A;
  metadata?: Record<string, unknown>;
}

export interface Step<S, A> extends Decision<A> {
  before: S;
  after: S;
  valid: boolean;
  decisionMs: number;
}

export type Policy<S, A> = (
  state: S,
  history: readonly Step<S, A>[],
) => Promise<Decision<A> | null> | Decision<A> | null;

export type RunStatus = "solved" | "budget-exhausted" | "stopped" | "error";

export interface TaskRun<S, A> {
  status: RunStatus;
  initial: S;
  final: S;
  steps: Step<S, A>[];
  elapsedMs: number;
  error?: string;
}

/** Budgets count every attempted transition, including invalid actions. Never silently rescue a policy. */
export async function runTask<S, A>(
  task: Task<S, A>,
  policy: Policy<S, A>,
  maxSteps: number,
): Promise<TaskRun<S, A>> {
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 0) throw new Error("Invalid step budget");
  const start = performance.now();
  const steps: Step<S, A>[] = [];
  let state = task.initial;
  let status: RunStatus = "budget-exhausted";
  let error: string | undefined;
  try {
    while (!task.isTerminal(state) && steps.length < maxSteps) {
      const decisionStart = performance.now();
      const decision = await policy(state, steps);
      const decisionMs = performance.now() - decisionStart;
      if (decision === null) {
        status = "stopped";
        break;
      }
      const result = task.transition(state, decision.action);
      steps.push({ ...decision, before: state, after: result.state, valid: result.valid, decisionMs });
      state = result.state;
    }
    if (task.isTerminal(state)) status = "solved";
  } catch (cause) {
    status = "error";
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return { status, initial: task.initial, final: state, steps, elapsedMs: performance.now() - start, error };
}
