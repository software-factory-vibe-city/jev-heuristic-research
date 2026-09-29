import { parseArgs } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { experiments } from "./experiments/index.js";
import { saveReport } from "./report/store.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));

async function sourceHash(): Promise<string> {
  const hash = createHash("sha256");
  async function visit(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name.endsWith("~")) continue; // Ignore editor state, not source.
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) hash.update(relative(projectRoot, child)).update("\0").update(await readFile(child)).update("\0");
    }
  }
  await visit(join(projectRoot, "src"));
  for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) {
    hash.update(file).update("\0").update(await readFile(join(projectRoot, file))).update("\0");
  }
  return hash.digest("hex");
}

const positiveInteger = (value: string, name: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
};
const list = (value: string) => [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      solvers: { type: "string" },
      cases: { type: "string", default: "" },
      trials: { type: "string", default: "1" },
      "max-steps": { type: "string" },
      param: { type: "string", multiple: true, default: [] },
      out: { type: "string", default: "reports" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Usage: npm run experiment -- <experiment> [options]
Experiments: ${experiments.map((experiment) => experiment.id).join(", ")}

--solvers IDs             Navigation: astar,local; rule/generated: astar,rule,local; frozen states: local. Hosted Jev is opt-in
--cases IDs               Maze or diagnostic checkpoint IDs (default: all cases in the experiment)
--trials N                 Repeats per solver and case (default: 1)
--max-steps N              Navigation attempt budget (default: 4 × optimal moves; not used by diagnostics)
--out PATH                 Artifact directory (default: reports)
--param KEY=VALUE          Experiment-specific parameter (repeatable; unknown keys are rejected)
  maze-generated: families=corridors,branching,loops,rooms sizes=3,5 seeds=101,202 encodings=20260928
  --cases selects layout IDs such as branching-5x5-s101; all configured encodings are included

Offline: npm run experiment -- maze --solvers astar
Compare: npm run experiment -- maze --solvers astar,local,jev
Encoding ablation: npm run experiment -- maze-representation --solvers astar,local,jev
Frozen-state diagnostics: npm run experiment -- maze-diagnostics --solvers local,jev --trials 3
Action hypotheses: npm run experiment -- maze-hypotheses --solvers local,jev --trials 3
Rule-guided rollouts: npm run experiment -- maze-rule --solvers astar,rule,local,jev --trials 3
Generated suite: npm run experiment -- maze-generated --solvers astar,rule,local,jev
Custom sweep: npm run experiment -- maze-generated --param sizes=5,9 --param seeds=101,202 --param encodings=20260928,20260929`);
    return;
  }
  if (positionals.length > 1) throw new Error("Expected one experiment name");
  const experiment = experiments.find((item) => item.id === (positionals[0] ?? "maze"));
  if (!experiment) throw new Error(`Unknown experiment. Available: ${experiments.map((item) => item.id).join(", ")}`);
  const parameters: Record<string, string> = {};
  for (const entry of values.param) {
    const match = /^([a-z][a-z0-9-]*)=(.+)$/.exec(entry);
    if (!match || Object.hasOwn(parameters, match[1]!)) throw new Error("--param requires unique KEY=VALUE entries");
    parameters[match[1]!] = match[2]!;
  }
  const options = {
    ...(values.param.length ? { parameters } : {}),
    solvers: list(values.solvers ?? experiment.defaultSolvers?.join(",") ?? "astar,local"), cases: list(values.cases),
    trials: positiveInteger(values.trials, "--trials"),
    maxSteps: values["max-steps"] === undefined ? undefined : positiveInteger(values["max-steps"], "--max-steps"),
  };
  const provenance = { sourceHash: await sourceHash(), node: process.version, sdk: "@typesafe-ai/sdk@0.6.0", startedAt: new Date().toISOString() };
  console.log(`Running ${experiment.title}`);
  const artifact = await experiment.execute(options);
  const path = await saveReport(resolve(values.out), experiment, artifact, provenance);
  console.log(`\nReport: ${path}\nNotebook: ${resolve(values.out, "index.html")}\nOpen directly, or run npm run serve.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
