import { readFile, writeFile } from "node:fs/promises";

import { MANIFEST_PATH } from "./paths.js";
import type {
  ExperimentManifest,
  ExperimentPair,
  ExperimentRun,
  ModelName,
  SelectionDecision,
} from "./types.js";

export const MODELS: ModelName[] = ["composer-2", "gpt-5.5-high"];
export const SELECTION_DECISIONS: SelectionDecision[] = ["composer-2", "gpt-5.5-high", "both", "neither"];

export async function loadManifest(): Promise<ExperimentManifest> {
  const json = await readFile(MANIFEST_PATH, "utf8");
  const parsed = JSON.parse(json) as ExperimentManifest;
  if (parsed.nextFirstModel === undefined) {
    parsed.nextFirstModel = "composer-2";
  }
  validateManifest(parsed);
  return parsed;
}

export async function saveManifest(manifest: ExperimentManifest): Promise<void> {
  validateManifest(manifest);
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function validateModel(model: string | undefined): ModelName {
  if (model === "composer-2" || model === "gpt-5.5-high") {
    return model;
  }
  throw new Error(`Model must be one of: ${MODELS.join(", ")}`);
}

export function validateSelectionDecision(decision: string | undefined): SelectionDecision {
  if (decision === "composer-2" || decision === "gpt-5.5-high" || decision === "both" || decision === "neither") {
    return decision;
  }
  throw new Error(`Decision must be one of: ${SELECTION_DECISIONS.join(", ")}`);
}

export function nextPairId(pairs: ExperimentPair[]): string {
  return nextId("pair", pairs.map((pair) => pair.pairId));
}

export function nextRunId(runs: ExperimentRun[]): string {
  return nextId("run", runs.map((run) => run.runId));
}

export function findReusablePair(
  manifest: ExperimentManifest,
  functionName: string,
  model: ModelName,
): ExperimentPair | undefined {
  return manifest.pairs.find((pair) => {
    if (pair.functionName !== functionName || pair.selectedDecision !== undefined) {
      return false;
    }
    return !manifest.runs.some((run) => run.pairId === pair.pairId && run.model === model);
  });
}

export function modelBranchSlug(model: ModelName): string {
  return model === "gpt-5.5-high" ? "gpt-5-dot-5-high" : model;
}

export function functionBranchSlug(functionName: string): string {
  return functionName
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function branchForRun(functionName: string, model: ModelName): string {
  const functionSlug = functionBranchSlug(functionName);
  if (!functionSlug) {
    throw new Error("Function name must contain at least one letter or number.");
  }
  return `chore/migrate-${functionSlug}/${modelBranchSlug(model)}`;
}

function validateManifest(manifest: ExperimentManifest): void {
  if (manifest.schemaVersion !== 1) {
    throw new Error("Unsupported manifest schema version.");
  }
  for (const model of manifest.models) {
    validateModel(model);
  }
  validateModel(manifest.nextFirstModel);
  const runIds = new Set<string>();
  for (const run of manifest.runs) {
    if (runIds.has(run.runId)) {
      throw new Error(`Duplicate runId in manifest: ${run.runId}`);
    }
    runIds.add(run.runId);
    validateModel(run.model);
    if (run.status !== "in_progress" && run.status !== "succeeded" && run.status !== "failed") {
      throw new Error(`Invalid run status for ${run.runId}: ${run.status}`);
    }
  }
}

function nextId(prefix: string, ids: string[]): string {
  const max = ids.reduce((largest, id) => {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    return match ? Math.max(largest, Number(match[1])) : largest;
  }, 0);
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}
