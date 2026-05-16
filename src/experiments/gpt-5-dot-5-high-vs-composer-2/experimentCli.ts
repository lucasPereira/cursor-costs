import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import { analyzeExperiment } from "./analyzeExperiment.js";
import { downloadExperimentCsv } from "./downloadExperimentCsv.js";
import {
  branchForRun,
  findReusablePair,
  loadManifest,
  nextPairId,
  nextRunId,
  saveManifest,
  validateModel,
  validateSelectionDecision,
} from "./manifest.js";
import type { ExperimentPair, ExperimentRun, RunStatus, SubjectRepositoryKey } from "./types.js";
import { resolveBranchCommit } from "./gitMetrics.js";

const execFileAsync = promisify(execFile);
const FINISH_STATUSES: RunStatus[] = ["succeeded", "failed"];

type Args = Record<string, string | undefined>;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case "start":
      await startRun(args);
      break;
    case "finish":
      await finishRun(args);
      break;
    case "select":
      await selectPair(args);
      break;
    case "download-csv":
      console.log(`Saved CSV to ${await downloadExperimentCsv()}`);
      break;
    case "analyze":
      await analyzeExperiment(args.csv);
      console.log("Analysis results and charts generated.");
      break;
    case "bootstrap-submodules":
      await bootstrapSubmodules();
      break;
    default:
      throw new Error(
        [
          "Usage:",
          "  experiment:start -- --function <name> --model <composer-2|gpt-5.5-high>",
          "  experiment:finish -- --run <runId> --status <succeeded|failed>",
          "  experiment:select -- --pair <pairId> --decision <composer-2|gpt-5.5-high|both|neither>",
          "  experiment:download-csv",
          "  experiment:analyze",
        ].join("\n"),
      );
  }
}

async function startRun(args: Args): Promise<void> {
  const functionName = required(args.function, "--function");
  const model = validateModel(args.model);
  const manifest = await loadManifest();
  const pair = findReusablePair(manifest, functionName, model) ?? createPair(manifest.pairs, functionName, model);
  if (!manifest.pairs.some((existing) => existing.pairId === pair.pairId)) {
    manifest.pairs.push(pair);
  }

  const runId = nextRunId(manifest.runs);
  const targetRepo = validateTargetRepo(args["target-repo"] ?? "messengerx_backend");
  const baseBranch = manifest.subjectWorkspace.repositories[targetRepo].baseBranch;
  const run: ExperimentRun = {
    runId,
    pairId: pair.pairId,
    functionName,
    model,
    targetRepo,
    baseBranch,
    branch: branchForRun(functionName, model),
    startedAt: new Date().toISOString(),
    status: "in_progress",
  };
  manifest.runs.push(run);
  await saveManifest(manifest);

  console.log(
    [
      `Started ${run.runId} (${run.pairId})`,
      `Function: ${run.functionName}`,
      `Model: ${run.model}`,
      `Branch: ${run.branch}`,
      `Target repo: ${run.targetRepo}`,
    ].join("\n"),
  );
}

async function finishRun(args: Args): Promise<void> {
  const runId = required(args.run, "--run");
  const status = validateFinishStatus(args.status);
  const manifest = await loadManifest();
  const run = manifest.runs.find((candidate) => candidate.runId === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  run.status = status;
  run.endedAt = new Date().toISOString();
  run.commit = args.commit ?? (await resolveBranchCommit(manifest, run));
  await saveManifest(manifest);

  console.log(
    [
      `Finished ${run.runId}`,
      `Status: ${run.status}`,
      `Commit: ${run.commit ?? "(not found)"}`,
    ].join("\n"),
  );
}

async function selectPair(args: Args): Promise<void> {
  const pairId = required(args.pair, "--pair");
  const decision = validateSelectionDecision(args.decision);
  const manifest = await loadManifest();
  const pair = manifest.pairs.find((candidate) => candidate.pairId === pairId);
  if (!pair) {
    throw new Error(`Pair not found: ${pairId}`);
  }

  pair.selectedDecision = decision;
  pair.selectedAt = new Date().toISOString();
  pair.selectedRunIds = selectedRunIdsForDecision(manifest.runs, pairId, decision);
  await saveManifest(manifest);

  console.log(`Selected ${decision} for ${pairId}`);
}

async function bootstrapSubmodules(): Promise<void> {
  const manifest = await loadManifest();
  await git(["submodule", "update", "--init", "--recursive", manifest.subjectWorkspace.path]);
  await git(["-C", manifest.subjectWorkspace.path, "checkout", manifest.subjectWorkspace.branch]);
  for (const config of Object.values(manifest.subjectWorkspace.repositories)) {
    const repoPath = path.join(manifest.subjectWorkspace.path, config.path);
    await git(["-C", repoPath, "checkout", config.baseBranch]);
  }
  console.log("Submodules initialized and base branches checked out.");
}

function createPair(pairs: ExperimentPair[], functionName: string, firstModel: ExperimentPair["firstModel"]): ExperimentPair {
  return {
    pairId: nextPairId(pairs),
    functionName,
    createdAt: new Date().toISOString(),
    firstModel,
  };
}

function parseArgs(args: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

function required(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing required argument: ${name}`);
  }
  return value;
}

function validateFinishStatus(status: string | undefined): "succeeded" | "failed" {
  if (status === "succeeded" || status === "failed") {
    return status;
  }
  throw new Error(`Status must be one of: ${FINISH_STATUSES.join(", ")}`);
}

function validateTargetRepo(value: string): SubjectRepositoryKey {
  if (value === "messengerx_backend" || value === "messengerx_firebase") {
    return value;
  }
  throw new Error("Target repo must be one of: messengerx_backend, messengerx_firebase");
}

function selectedRunIdsForDecision(
  runs: ExperimentRun[],
  pairId: string,
  decision: "composer-2" | "gpt-5.5-high" | "both" | "neither",
): string[] {
  if (decision === "neither") {
    return [];
  }

  const succeededRuns = runs.filter((run) => run.pairId === pairId && run.status === "succeeded");
  const selectedRuns =
    decision === "both" ? succeededRuns : succeededRuns.filter((run) => run.model === decision);

  if (decision === "both") {
    const hasComposer = selectedRuns.some((run) => run.model === "composer-2");
    const hasGpt = selectedRuns.some((run) => run.model === "gpt-5.5-high");
    if (!hasComposer || !hasGpt) {
      throw new Error("Decision 'both' requires succeeded runs for both models in the pair.");
    }
  }

  if (decision !== "both" && selectedRuns.length === 0) {
    throw new Error(`Decision '${decision}' requires a succeeded run for that model in the pair.`);
  }

  return selectedRuns.map((run) => run.runId);
}

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", args, { timeout: 30_000 });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
