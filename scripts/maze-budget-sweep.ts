import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, isDeepStrictEqual } from "node:util";
import { page } from "../src/report/page.js";
import { escapeHtml as e, table } from "../src/report/html.js";
import { saveReport } from "../src/report/store.js";
import type { GeneratedCase, GeneratedResult } from "../src/experiments/maze-generated/experiment.js";
import type { RuleRun } from "../src/experiments/maze-rule/experiment.js";
import { ruleMemory } from "../src/experiments/maze-rule/observation.js";
import type { RuleMemory } from "../src/experiments/maze-rule/observation.js";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const solverOrder = ["astar", "rule", "jev", "local"] as const;
type Solver = typeof solverOrder[number];
export interface SweepCell {
  status: "pending" | "running" | "infrastructure-error" | RuleRun["trace"]["status"];
  steps?: number;
  metrics?: RuleRun["metrics"];
  responseModels?: string[];
  report?: string;
  error?: string;
  elapsedMs?: number;
}
export interface SweepRow {
  id: string; layoutId: string; title: string; seed: number; encodingSeed: number;
  optimal: number; budget: number; originalBudget: number;
  cells: Partial<Record<Solver, SweepCell>>;
  source?: { kind: "historical" | "new"; artifact: string };
}
export interface SweepResult {
  status: "running" | "completed" | "interrupted" | "error";
  protocol: {
    version: string; baseline: string; multiplier: number; solvers: readonly Solver[]; instructions: string;
    execution: string; safeguards: string; memory?: RuleMemory; comparison?: string; extension?: string;
  };
  rows: SweepRow[];
  active?: { caseId: string; solver: Solver; startedAt: string; pid?: number };
  updatedAt: string;
  error?: string;
}

export function planSweep(baseline: GeneratedResult, multiplier: number, solvers: readonly Solver[]): SweepRow[] {
  if (!Number.isSafeInteger(multiplier) || multiplier < 1) throw new Error("Multiplier must be a positive integer");
  if (!solvers.length || new Set(solvers).size !== solvers.length || solvers.some((id) => !solverOrder.includes(id))) throw new Error("Solvers must be unique: astar, rule, jev, local");
  if (!baseline.cases.length || new Set(baseline.cases.map((item) => item.id)).size !== baseline.cases.length) throw new Error("Baseline needs nonempty, unique cases");
  if (baseline.protocol.options.trials !== 1) throw new Error("Budget sweep expects a one-trial baseline; repeated trials must not be silently collapsed");
  return baseline.cases.map((item) => {
    const budget = multiplier * item.optimalMoves;
    if (!Number.isSafeInteger(budget) || budget < 1) throw new Error(`Invalid budget for ${item.id}`);
    if (item.generation.width !== item.generation.height) throw new Error("CLI sweep currently supports square generated layouts only");
    return { id: item.id, layoutId: item.layoutId, title: `${item.generation.family} ${item.generation.width}×${item.generation.height}`,
      seed: item.generation.seed, encodingSeed: item.encoding.seed, optimal: item.optimalMoves,
      budget, originalBudget: item.maxSteps, cells: Object.fromEntries(solvers.map((solver) => [solver, { status: "pending" }])) };
  });
}

/** Carry results forward explicitly; never rerun, relabel as fresh, or modify the source artifact. */
export function inheritRows(previous: SweepResult, fresh: readonly SweepRow[], solvers: readonly Solver[], memory: RuleMemory,
  multiplier: number, instructions: string, artifact: string): SweepRow[] {
  if (previous.status !== "completed" || (previous.protocol.memory ?? "full") !== memory ||
      previous.protocol.multiplier !== multiplier || previous.protocol.instructions !== instructions) {
    throw new Error("Extension requires a completed sweep with the same memory mode, rule, and budget multiplier");
  }
  const ids = new Set(fresh.map((row) => row.id));
  return previous.rows.map((row) => {
    if (ids.has(row.id)) throw new Error(`Duplicate condition in extension: ${row.id}`);
    ids.add(row.id);
    if (row.budget !== row.optimal * multiplier || solvers.some((solver) => !row.cells[solver] || ["pending", "running"].includes(row.cells[solver]!.status))) {
      throw new Error(`Historical condition has incompatible budgets or incomplete solver results: ${row.id}`);
    }
    const copy = structuredClone(row);
    copy.cells = Object.fromEntries(solvers.map((solver) => [solver, copy.cells[solver]]));
    copy.source = { kind: "historical", artifact };
    return copy;
  });
}

export function solutionSteps(cell: SweepCell | undefined): string {
  if (!cell) return "—";
  if (cell.status === "solved") return String(cell.steps);
  if (cell.status === "budget-exhausted") return `Unsolved at ${cell.steps}`;
  if (cell.status === "error") return `API/run error after ${cell.steps}`;
  if (cell.status === "stopped") return `Stopped after ${cell.steps}`;
  if (cell.status === "infrastructure-error") return "Artifact/process error";
  return cell.status === "running" ? "Running…" : "Pending";
}

export function renderSweep(result: SweepResult): string {
  const summaryOnly = result.protocol.memory === "summary";
  const extended = !!result.protocol.extension;
  const groups = extended ? [
    { label: "New layouts", rows: result.rows.filter((row) => row.source?.kind !== "historical") },
    { label: "Previously recorded", rows: result.rows.filter((row) => row.source?.kind === "historical") },
  ] : [{ label: "All", rows: result.rows }];
  const columns = ["astar", "jev", "local", "rule"] as const;
  const labels = { astar: "A*", jev: "Jev", local: "Local", rule: "Code rule" };
  const solvers = columns.filter((solver) => result.protocol.solvers.includes(solver));
  const display = (cell: SweepCell | undefined) => cell?.report
    ? `<a href="${e(cell.report)}">${e(solutionSteps(cell))}</a>` : e(solutionSteps(cell));
  return `<div class="hero"><div><div class="eyebrow">${extended ? "Scale extension" : summaryOnly ? "Summary-only amendment" : "Budget intervention"} / ${e(result.status)}</div><h1>${extended ? "More cells.<br>Same policy." : summaryOnly ? "Same rule.<br>Less transcript." : "More room<br>to finish."}</h1><p class="lede">${extended ? "Larger seeded mazes with the same observation contract and rule question. Earlier results are carried forward explicitly, not rerun." : summaryOnly ? "Same mazes, labels, and rule question. Omit chronological history; retain the graph, visit counts, and previous-position flags. No prompt to consult history." : "Same mazes, labels, observations, and exploration rule."} ${extended ? "New rows get fresh" : "Fresh"} rollouts with a ${result.protocol.multiplier}× optimal-move budget.</p></div><div class="callout"><p>Only solved cells show a solution length. An exhausted, errored, pending, or running attempt is never displayed as a solution.</p><p class="note">${result.status === "running" ? "This table updates as each run finishes. Refresh to see new results; no inference runs in the browser." : "Each completed cell links to its full replay and exact evidence."}</p></div></div>
    <p class="note">Updated ${e(result.updatedAt)}${result.active ? ` · active: ${e(result.active.solver)} / ${e(result.active.caseId)}` : ""} · <a href="result.json">Raw summary ↗</a></p>
    <section><h2>Solution steps</h2>${table(["Maze", "Seed", "Encoding", "Optimal", ...solvers.map((solver) => labels[solver]), "New budget"], result.rows.map((row) => [e(row.title) + (extended ? `<br><span class="note">${row.source?.kind === "historical" ? "previous result · not rerun" : "new layout"}</span>` : ""), String(row.seed), String(row.encodingSeed), String(row.optimal), ...solvers.map((solver) => display(row.cells[solver])), String(row.budget)]))}
      <p class="note">Steps include forced moves, revisits, and all attempted transitions. Sizes are logical cells. ${extended ? "Historical rows retain their original budgets and outcomes, and link to the original evidence. Only new layouts are run in this extension." : "Every entry is a fresh run, not a continuation or an old result relabeled with a larger budget."} The budget is not passed to the models. Errors retain their own category.</p></section>
    <section><h2>Progress and completion</h2>${table(["Cohort", "Solver", "Solved", "Exhausted", "Errors / stopped", "Running / pending", "Calls", "Rule agreement"], groups.flatMap((group) => solvers.map((solver) => {
      const cells = group.rows.map((row) => row.cells[solver]!);
      const total = (key: "modelCalls" | "ruleMatches" | "ruleChecks") => cells.reduce((sum, cell) => sum + (cell.metrics?.[key] ?? 0), 0);
      const checks = total("ruleChecks");
      return [group.label, labels[solver], `${cells.filter((cell) => cell.status === "solved").length} / ${cells.length}`, String(cells.filter((cell) => cell.status === "budget-exhausted").length),
        String(cells.filter((cell) => ["error", "infrastructure-error", "stopped"].includes(cell.status)).length), String(cells.filter((cell) => ["running", "pending"].includes(cell.status)).length), String(total("modelCalls")), checks ? `${total("ruleMatches")} / ${checks}` : "—"];
    })))}<p class="note">Calls and compliance totals cover completed subreports, not in-flight runs. Historical calls are shown separately from new inference.</p></section>
    ${result.error ? `<p class="error-message">${e(result.error)}</p>` : ""}
    <section><details><summary>Protocol and caveats</summary><p>${e(result.protocol.execution)}</p><p>${e(result.protocol.safeguards)}</p><p>A larger move budget does not remove backend context or timeout limits. ${summaryOnly ? "Models receive memory summaries, not chronological history. Full traces are retained for audit and replay." : "Full history is supplied to models."} API failures stop the affected run, and no decisions are repaired. Fresh model responses may vary from earlier runs; seed determinism applies to layouts and encodings, not necessarily predictions. Per-run artifacts are saved separately so a long or interrupted local run does not discard completed evaluations.</p><pre>${e(JSON.stringify(result.protocol, null, 2))}</pre></details></section>`;
}

export function childArguments(item: GeneratedCase, solver: Solver, budget: number, out: string, memory: RuleMemory = "full"): string[] {
  return ["--env-file-if-exists=.env", "--import", "tsx", "src/cli.ts", "maze-generated", "--solvers", solver,
    "--cases", item.layoutId, "--param", `families=${item.generation.family}`, "--param", `sizes=${item.generation.width}`,
    "--param", `seeds=${item.generation.seed}`, "--param", `encodings=${item.encoding.seed}`, "--param", `memory=${memory}`,
    "--max-steps", String(budget), "--trials", "1", "--out", out];
}

async function sourceHash(): Promise<string> {
  const hash = createHash("sha256");
  async function visit(path: string): Promise<void> {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || entry.name.endsWith("~")) continue;
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile()) hash.update(relative(projectRoot, child)).update("\0").update(await readFile(child)).update("\0");
    }
  }
  await visit(join(projectRoot, "src"));
  for (const file of ["package.json", "package-lock.json", "tsconfig.json"]) hash.update(file).update("\0").update(await readFile(join(projectRoot, file))).update("\0");
  return hash.digest("hex");
}

export async function main(): Promise<void> {
  const { values } = parseArgs({ options: {
    from: { type: "string" }, multiplier: { type: "string", default: "80" },
    solvers: { type: "string", default: "astar,rule,jev,local" }, out: { type: "string", default: "reports" },
    memory: { type: "string", default: "full" }, "compare-with": { type: "string" }, extend: { type: "string" },
  } });
  if (!values.from) throw new Error("Use --from PATH/TO/result.json for the exact generated-maze baseline");
  const baselinePath = resolve(values.from);
  const baselineArtifact = JSON.parse(await readFile(baselinePath, "utf8")) as { experiment: string; result: GeneratedResult };
  if (baselineArtifact.experiment !== "maze-generated") throw new Error("Expected a maze-generated artifact");
  const baseline = baselineArtifact.result;
  const multiplier = Number(values.multiplier);
  const solvers = values.solvers.split(",").map((id) => id.trim()) as Solver[];
  const memory = ruleMemory(values.memory);
  const rows = planSweep(baseline, multiplier, solvers);
  const comparison = values["compare-with"] ? resolve(values["compare-with"]) : undefined;
  if (comparison) {
    const prior = JSON.parse(await readFile(comparison, "utf8")) as { result: SweepResult };
    if (prior.result.status !== "completed" || prior.result.rows.length !== rows.length || rows.some((row) =>
      !prior.result.rows.some((other) => other.id === row.id && other.optimal === row.optimal && other.budget === row.budget))) {
      throw new Error("Comparison must be a completed sweep with identical conditions and budgets");
    }
  }
  const extension = values.extend ? resolve(values.extend) : undefined;
  const historical = extension ? inheritRows((JSON.parse(await readFile(extension, "utf8")) as { result: SweepResult }).result,
    rows, solvers, memory, multiplier, baseline.protocol.instructions, relative(projectRoot, extension)) : [];
  if (extension) for (const row of rows) row.source = { kind: "new", artifact: "self" };
  const startedAt = new Date().toISOString();
  const provenance = { sourceHash: await sourceHash(), node: process.version, sdk: "@typesafe-ai/sdk@0.6.0", startedAt,
    orchestrator: "scripts/maze-budget-sweep.ts", orchestratorHash: createHash("sha256").update(await readFile(fileURLToPath(import.meta.url))).digest("hex") };
  const result: SweepResult = { status: "running", updatedAt: startedAt, rows: [...historical, ...rows], protocol: {
    version: extension ? "maze-scale-sweep-v1" : memory === "summary" ? "maze-summary-sweep-v1" : "maze-budget-sweep-v1", baseline: relative(projectRoot, baselinePath), multiplier, solvers, instructions: baseline.protocol.instructions,
    memory, comparison: comparison ? relative(projectRoot, comparison) : undefined, extension: extension ? relative(projectRoot, extension) : undefined,
    execution: "Fresh starts, one trial, one subprocess/report per solver × layout × encoding. Solvers run in listed order across the whole suite (references/Jev first, then local by default). This changes scheduling, not model inputs. New rollouts never reuse old model answers; extension rows marked historical copy earlier measurements without new inference. The summary is checkpointed after every completed run, with periodic elapsed-time heartbeats while waiting.",
    safeguards: "Use the versioned maze-generated CLI and unchanged provider adapter. Validate regenerated grids, hashes, encodings, optimum lengths, prompts, observation mode, budgets, and source fingerprint against the plan. Preserve every child report. No retries, adaptive history windows, path fallback, action correction, or automatic restarts. Chronology is either supplied in full or omitted throughout, according to the configured memory mode; summaries are retained in both. The rule question is unchanged and already has no instruction to consult history. Forced singletons remain explicitly recorded and budgeted. A killed in-flight subprocess may have no complete trace artifact; completed subreports remain intact.",
  } };
  const title = extension ? `Maze · scale extension · ${memory} memory` : memory === "summary" ? `Maze · summaries only · ${multiplier}× budget` : `Maze · ${multiplier}× budget sweep`;
  // Old links are rebased immediately below, before any new inference.
  const index = await saveReport(resolve(values.out), { id: extension ? "maze-scale-sweep" : memory === "summary" ? "maze-summary-sweep" : "maze-budget-sweep", title },
    { data: result, body: renderSweep(result), summary: `${rows.length} new conditions${extension ? ` + ${historical.length} historical` : ""} · ${memory} memory · ${multiplier}× optimal` }, provenance);
  const directory = dirname(index);
  for (const row of historical) for (const cell of Object.values(row.cells)) if (cell?.report) {
    cell.report = relative(directory, resolve(dirname(extension!), cell.report));
  }
  const envelope = JSON.parse(await readFile(join(directory, "result.json"), "utf8")) as Record<string, unknown>;
  const checkpoint = async () => {
    result.updatedAt = new Date().toISOString();
    for (const [file, content] of [["result.json", JSON.stringify({ ...envelope, result }, null, 2) + "\n"], ["index.html", page(title, renderSweep(result))]]) {
      await writeFile(join(directory, `${file}.tmp`), content!);
      await rename(join(directory, `${file}.tmp`), join(directory, file!));
    }
  };
  await checkpoint();
  console.log(`Progress report: ${index}`);
  console.log(`Budgets: ${Math.min(...rows.map((row) => row.budget))}–${Math.max(...rows.map((row) => row.budget))} moves; up to ${rows.reduce((sum, row) => sum + row.budget, 0) * solvers.filter((s) => s === "local" || s === "jev").length} model calls.`);
  let interrupted = false;
  let child: ReturnType<typeof spawn> | undefined;
  const interrupt = () => { interrupted = true; child?.kill("SIGTERM"); };
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    for (const solver of solvers) for (const [caseIndex, row] of rows.entries()) {
      if (interrupted) throw new Error("Sweep interrupted");
      const item = baseline.cases[caseIndex]!;
      const cell = row.cells[solver]!;
      cell.status = "running";
      result.active = { caseId: row.id, solver, startedAt: new Date().toISOString() };
      await checkpoint();
      console.log(`\n${solver} / ${row.id} / budget ${row.budget}`);
      let output = "", heartbeatError: unknown;
      let heartbeatWrites = Promise.resolve();
      const start = performance.now();
      child = spawn(process.execPath, childArguments(item, solver, row.budget, join(directory, "runs"), memory), { cwd: projectRoot, stdio: ["ignore", "pipe", "pipe"] });
      result.active.pid = child.pid;
      const receive = (chunk: Buffer) => { const text = chunk.toString(); output += text; process.stdout.write(text); };
      child.stdout!.on("data", receive); child.stderr!.on("data", receive);
      const heartbeat = setInterval(() => {
        console.log(`  Still running ${solver} / ${row.layoutId}: ${((performance.now() - start) / 60000).toFixed(1)} min (no extra model calls from monitoring)`);
        heartbeatWrites = heartbeatWrites.then(checkpoint).catch((error: unknown) => { heartbeatError = error; child?.kill("SIGTERM"); });
      }, 60000);
      let code: number | null;
      try {
        code = await new Promise<number | null>((resolve, reject) => { child!.once("error", reject); child!.once("close", resolve); });
      } finally { clearInterval(heartbeat); await heartbeatWrites; child = undefined; }
      if (heartbeatError) throw heartbeatError;
      await writeFile(join(directory, `${solver}-${caseIndex}.log.json`), JSON.stringify({ solver, caseId: row.id, exitCode: code, output }, null, 2));
      if (interrupted) throw new Error("Sweep interrupted");
      const reportPath = /(?:^|\n)Report: (.+)/.exec(output)?.[1]?.trim();
      if (code !== 0 || !reportPath) {
        cell.status = "infrastructure-error"; cell.error = `Subprocess exited ${code}; see ${solver}-${caseIndex}.log.json`;
      } else {
        const childArtifact = JSON.parse(await readFile(join(dirname(reportPath), "result.json"), "utf8")) as { provenance: { sourceHash: string }; result: GeneratedResult };
        const actual = childArtifact.result.cases[0];
        if (childArtifact.provenance.sourceHash !== provenance.sourceHash || childArtifact.result.cases.length !== 1 || !actual ||
          actual.id !== item.id || !isDeepStrictEqual(actual.maze, item.maze) || !isDeepStrictEqual(actual.encoding, item.encoding) ||
          !isDeepStrictEqual(actual.generation, item.generation) || actual.optimalMoves !== row.optimal || actual.maxSteps !== row.budget ||
          childArtifact.result.protocol.instructions !== baseline.protocol.instructions || (childArtifact.result.protocol.memory ?? "full") !== memory ||
          actual.runs.length !== 1 || actual.runs[0]!.solver !== solver) {
          throw new Error(`Subreport does not match frozen plan: ${reportPath}`);
        }
        const run = actual.runs[0]!;
        Object.assign(cell, { status: run.trace.status, steps: run.trace.steps.length, metrics: run.metrics,
          responseModels: run.modelStats?.responseModels, report: relative(directory, reportPath), error: run.trace.error, elapsedMs: run.trace.elapsedMs });
      }
      result.active = undefined;
      await checkpoint();
    }
    result.status = "completed";
  } catch (error) {
    result.status = interrupted ? "interrupted" : "error";
    result.error = error instanceof Error ? error.message : String(error);
    if (result.active) {
      const cell = rows.find((row) => row.id === result.active!.caseId)!.cells[result.active.solver]!;
      cell.status = "infrastructure-error"; cell.error = result.error;
    }
    process.exitCode = interrupted ? 130 : 1;
  } finally {
    result.active = undefined;
    await checkpoint();
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
  console.log(`\nSweep ${result.status}: ${index}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
