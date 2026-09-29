import { createHash } from "node:crypto";
import type { ExperimentOptions } from "../../core/experiment.js";
import { encodingSeed } from "../maze-diagnostics/encoding.js";
import { familyDescriptions, generateMaze, generatorVersion, mazeFamilies, mazeTopology } from "../maze/generated.js";
import type { MazeFamily, MazeSpec } from "../maze/generated.js";
import type { RuleFixture } from "../maze-rule/experiment.js";
import { ruleMemory } from "../maze-rule/observation.js";

export const parameterKeys = ["families", "sizes", "seeds", "encodings", "memory"] as const;
export function suiteParameters(parameters: Record<string, string> = {}) {
  for (const key of Object.keys(parameters)) if (!(parameterKeys as readonly string[]).includes(key)) throw new Error(`Unknown generated-maze parameter: ${key}`);
  const entries = (key: string, fallback: string) => {
    const values = (parameters[key] ?? fallback).split(",").map((value) => value.trim());
    if (values.some((value) => !value) || new Set(values).size !== values.length) throw new Error(`Parameter ${key} must be a nonempty list without duplicates`);
    return values;
  };
  const numbers = (key: string, fallback: string, min: number, max: number) => {
    const values = entries(key, fallback).map((value) => /^\d+$/.test(value) ? Number(value) : NaN);
    if (values.some((value) => !Number.isSafeInteger(value) || value < min || value > max) || new Set(values).size !== values.length) throw new Error(`Parameter ${key} requires unique integers from ${min} to ${max}`);
    return values;
  };
  const families = entries("families", mazeFamilies.join(","));
  if (families.some((family) => !(mazeFamilies as readonly string[]).includes(family))) throw new Error(`Families: ${mazeFamilies.join(", ")}`);
  const config = { families: families as MazeFamily[], sizes: numbers("sizes", "3,5", 2, 25),
    seeds: numbers("seeds", "101,202", 0, 0xffffffff), encodings: numbers("encodings", String(encodingSeed), 0, 0xffffffff), memory: ruleMemory(parameters.memory) };
  if (config.families.length * config.sizes.length * config.seeds.length * config.encodings.length > 256) throw new Error("At most 256 generated layout/encoding conditions per invocation; split larger sweeps into batches");
  return config;
}

export interface GeneratedFixture extends RuleFixture {
  layoutId: string;
  generation: MazeSpec & { version: string; hash: string };
  topology: ReturnType<typeof mazeTopology>;
}

export function generatedSuite(options: ExperimentOptions) {
  const config = suiteParameters(options.parameters);
  const specs: { id: string; spec: MazeSpec }[] = config.families.flatMap((family) => config.sizes.flatMap((size) => config.seeds.map((seed) => ({
    id: `${family}-${size}x${size}-s${seed}`, spec: { family, width: size, height: size, seed },
  }))));
  if (options.cases.some((id) => !specs.some((item) => item.id === id))) throw new Error(`Generated --cases selects layout IDs from this configuration, e.g. ${specs[0]!.id}`);
  const selected = options.cases.length ? specs.filter((item) => options.cases.includes(item.id)) : specs;
  const fixtures: GeneratedFixture[] = selected.flatMap(({ id, spec }) => {
    const maze = generateMaze(spec), ascii = maze.rows.join("\n"), topology = mazeTopology(maze);
    if (topology.components !== 1 || topology.optimalMoves === null) throw new Error(`Generator produced disconnected layout: ${id}`);
    const hash = createHash("sha256").update(ascii).digest("hex");
    return config.encodings.map((labelSeed) => ({
      id: `${id}-e${labelSeed}`, layoutId: id, encodingId: id, encodingSeed: labelSeed,
      title: `${spec.family} · ${spec.width}×${spec.height} · seed ${spec.seed} · encoding ${labelSeed}`,
      description: familyDescriptions[spec.family], ascii,
      generation: { ...spec, version: generatorVersion, hash }, topology,
    }));
  });
  return { config, fixtures };
}
