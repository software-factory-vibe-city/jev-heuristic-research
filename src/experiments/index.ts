import { mazeExperiment } from "./maze/experiment.js";
import { mazeRepresentationExperiment } from "./maze/representation-experiment.js";
import { mazeDiagnosticsExperiment } from "./maze-diagnostics/experiment.js";
import { mazeHypothesesExperiment } from "./maze-hypotheses/experiment.js";
import { mazeRuleExperiment } from "./maze-rule/experiment.js";
import { generatedMazeExperiment } from "./maze-generated/experiment.js";

// Register new experiments here; the CLI, artifact store, and HTML shell stay unchanged.
export const experiments = [mazeExperiment, mazeRepresentationExperiment, mazeDiagnosticsExperiment, mazeHypothesesExperiment, mazeRuleExperiment, generatedMazeExperiment];
