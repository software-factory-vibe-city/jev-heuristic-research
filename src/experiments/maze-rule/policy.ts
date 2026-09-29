import type { Policy } from "../../core/task.js";
import type { createChoiceModel } from "../../providers/system-one.js";
import { createMazeTask, positionKey } from "../maze/domain.js";
import type { Maze, Move, Position } from "../maze/domain.js";
import { forcedMoveDecision } from "../maze/policy.js";
import type { Encoding } from "../maze-diagnostics/encoding.js";
import { probeCriteria } from "../maze-diagnostics/probes.js";
import { explorationRule, ruleInstructions } from "../maze-hypotheses/arms.js";
import { ruleObservation } from "./observation.js";
import type { RuleMemory } from "./observation.js";

/** The rule question has no history-consulting instructions in either observation mode. */
export function rulePolicy(maze: Maze, encoding: Encoding, model?: ReturnType<typeof createChoiceModel>, memory: RuleMemory = "full"): Policy<Position, Move> {
  const task = createMazeTask(maze);
  return async (current, history) => {
    const legalMoves = task.actions(current);
    if (!legalMoves.length) return null;
    const destinationMoves = Object.fromEntries(legalMoves.map((move) => [
      encoding.byPosition[positionKey(task.transition(current, move).state)]!, move,
    ]));
    const forced = forcedMoveDecision(legalMoves);
    if (forced) return { ...forced, metadata: { ...forced.metadata,
      destination: encoding.byPosition[positionKey(task.transition(current, forced.action).state)]!, destinationMoves,
    } };
    const state = ruleObservation({ maze, current, history }, encoding, memory);
    if (!("candidate_facts" in state)) throw new Error("Rule state lacks candidate facts");
    if (!model) {
      const destination = explorationRule(state.candidate_facts);
      // Store the exact inputs used by the code rule, not a repeated copy of the complete graph.
      // The full observation is still constructed above; no model request is compressed.
      return { action: destinationMoves[destination]!, metadata: { source: "code-rule",
        observationCapture: "candidate-facts-only", ruleInputs: state.candidate_facts, destination, destinationMoves } };
    }
    // No ranking, action masking by history, or code-rule recommendation is passed to the model.
    const decision = await model.decide(state, ruleInstructions, probeCriteria({ current }, encoding, "action"), "answer");
    const action = destinationMoves[decision.action];
    if (!action) throw new Error("Model destination has no legal maze transition");
    // Preserve the raw node-ID answer. Converting that ID to a physical move does not alter its choice.
    return { action, metadata: { ...decision.metadata, source: "model", destination: decision.action, destinationMoves } };
  };
}
