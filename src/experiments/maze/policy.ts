import type { Decision, Policy } from "../../core/task.js";
import type { createChoiceModel } from "../../providers/system-one.js";
import { asciiState, createMazeTask, deltas } from "./domain.js";
import type { Maze, Move, Position } from "./domain.js";

export const policyVersion = "maze-next-move-v3";
export const historyInstructions = "Before choosing, check the full movement history. NEVER repeat an unsuccessful loop or re-enter a dead end already shown by the history to be unproductive. " +
  "Revisiting cells is allowed when necessary to backtrack out of a dead end or reach a different route; do not immediately undo that backtracking and repeat the same failed branch. " +
  "Choose only a legal move.";
export const instructions = "Choose the next single move on a shortest route from @ to G. " +
  "Read the full maze: walls can require moving away from the goal or backtracking from a dead end. " +
  historyInstructions;

/** Filter only by physical legality, never by history or distance to the goal. */
export function moveCriteria(legalMoves: readonly Move[]) {
  return Object.fromEntries(legalMoves.map((move) => [move,
    `Move one cell ${move}: x ${deltas[move].x >= 0 ? "+" : ""}${deltas[move].x}, y ${deltas[move].y >= 0 ? "+" : ""}${deltas[move].y}.`,
  ]));
}

/** A forced action is still an ordinary budgeted transition, not a model prediction. */
export function forcedMoveDecision(legalMoves: readonly Move[]): Decision<Move> | undefined {
  if (legalMoves.length !== 1) return undefined;
  return {
    action: legalMoves[0]!,
    metadata: { source: "forced", reason: "only-legal-move", legalMoves: [...legalMoves] },
  };
}

export function mazePolicy(maze: Maze, model: ReturnType<typeof createChoiceModel>): Policy<Position, Move> {
  const task = createMazeTask(maze);
  return (current, history) => {
    const legalMoves = task.actions(current);
    if (!legalMoves.length) return null;
    const forced = forcedMoveDecision(legalMoves);
    if (forced) return forced;
    return model.decide<Move>({
      maze: asciiState(maze, current),
      legend: "# = wall, . or space = open, S = start, G = goal, @ = current position (may cover S).",
      coordinates: "Zero-based x (column) increases right; y (row) increases down.",
      current: { ...current },
      goal: { ...maze.goal },
      legal_moves: [...legalMoves],
      history: history.map((step) => ({
        from: { ...step.before }, action: step.action, to: { ...step.after }, valid: step.valid,
      })),
    }, instructions, moveCriteria(legalMoves));
  };
}
