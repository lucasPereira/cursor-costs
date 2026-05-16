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
  validateSelectionDecision,
} from "./manifest.js";
import type {
  ExperimentManifest,
  ExperimentPair,
  ExperimentRun,
  ModelName,
  RunStatus,
  SelectionDecision,
  SubjectRepositoryKey,
} from "./types.js";
import { resolveBranchCommit } from "./gitMetrics.js";

const execFileAsync = promisify(execFile);
const FINISH_STATUSES: RunStatus[] = ["succeeded", "failed"];

type Args = Record<string, string | undefined>;

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case "select":
      await selectPair(args);
      break;
    case "download-csv":
      console.log(`Saved CSV to ${await downloadExperimentCsv()}`);
      console.log("Next step: npm run experiment:analyze");
      break;
    case "analyze":
      await analyzeExperiment(args.csv);
      console.log("Analysis results and charts generated.");
      console.log(
        "Next step: invoke the update-final-report skill to refresh artifacts/final-report.md",
      );
      break;
    case "bootstrap-submodules":
      await bootstrapSubmodules();
      break;
    case "migrate-start":
      await migrateStart(args);
      break;
    case "migrate-finish":
      await migrateFinish(args);
      break;
    default:
      throw new Error(
        [
          "Usage:",
          "  experiment:bootstrap-submodules",
          "  experiment:migrate-start -- --function <name>",
          "  experiment:migrate-finish -- --status <succeeded|failed>",
          "  experiment:select -- --decision <composer-2|gpt-5.5-high|both|neither>",
          "  experiment:download-csv",
          "  experiment:analyze",
        ].join("\n"),
      );
  }
}

async function selectPair(args: Args): Promise<void> {
  const decision = validateSelectionDecision(args.decision);
  const manifest = await loadManifest();
  const pair = latestOpenPair(manifest);
  if (!pair) {
    throw new Error("No open pair found in the manifest.");
  }

  pair.selectedDecision = decision;
  pair.selectedAt = new Date().toISOString();
  pair.selectedRunIds = selectedRunIdsForDecision(manifest.runs, pair.pairId, decision);
  manifest.nextFirstModel = otherModelOf(manifest.nextFirstModel);
  await saveManifest(manifest);

  console.log(`Selected ${decision} for ${pair.pairId}`);
  console.log(`Next pair will start with ${manifest.nextFirstModel}.`);
  console.log("Next step: invoke the register-observations skill to log notes for this pair");
}

async function bootstrapSubmodules(): Promise<void> {
  const manifest = await loadManifest();
  await runGit(["submodule", "update", "--init", "--recursive", manifest.subjectWorkspace.path]);
  await runGit(["-C", manifest.subjectWorkspace.path, "checkout", manifest.subjectWorkspace.branch]);
  for (const config of Object.values(manifest.subjectWorkspace.repositories)) {
    const repoPath = path.join(manifest.subjectWorkspace.path, config.path);
    await runGit(["-C", repoPath, "checkout", config.baseBranch]);
  }
  console.log("Submodules initialized and base branches checked out.");
  console.log("Next step: npm run experiment:migrate-start -- --function <name>");
}

async function migrateStart(args: Args): Promise<void> {
  const functionName = required(args.function, "--function");
  const targetRepo = validateTargetRepo(args["target-repo"] ?? "messengerx_backend");

  const manifest = await loadManifest();
  const model = manifest.nextFirstModel;
  const repoPath = repoPathFor(manifest, targetRepo);
  const baseBranch = manifest.subjectWorkspace.repositories[targetRepo].baseBranch;

  await ensureCleanTree(repoPath);
  await ensureOnBranch(repoPath, baseBranch);
  await tryFastForwardPull(repoPath);

  const run = registerRun(manifest, functionName, model, targetRepo);
  await saveManifest(manifest);

  await runGit(["-C", repoPath, "checkout", "-b", run.branch]);

  console.log(formatStartedRun(run));
  console.log("Next step (after the migration): npm run experiment:migrate-finish -- --status <succeeded|failed>");
}

async function migrateFinish(args: Args): Promise<void> {
  const status = validateFinishStatus(args.status);

  const manifest = await loadManifest();
  const inProgress = findSingleInProgressRun(manifest);
  const pairRuns = manifest.runs.filter((candidate) => candidate.pairId === inProgress.pairId);
  if (pairRuns.length !== 1 && pairRuns.length !== 2) {
    throw new Error(
      `Pair ${inProgress.pairId} has ${pairRuns.length} runs; expected 1 (first) or 2 (second).`,
    );
  }
  const isFirstOfPair = pairRuns.length === 1;

  const targetRepo = inProgress.targetRepo;
  const repoPath = repoPathFor(manifest, targetRepo);
  const baseBranch = manifest.subjectWorkspace.repositories[targetRepo].baseBranch;

  await ensureOnBranch(repoPath, inProgress.branch);
  await commitMigration(repoPath, inProgress);

  const commitHash = await resolveBranchCommit(manifest, inProgress);
  await finalizeRun(manifest, inProgress, status, commitHash);

  if (isFirstOfPair) {
    const otherModel = otherModelOf(inProgress.model);
    const nextRun = registerRun(manifest, inProgress.functionName, otherModel, targetRepo);
    await saveManifest(manifest);

    await runGit(["-C", repoPath, "checkout", baseBranch]);
    await tryFastForwardPull(repoPath);
    await runGit(["-C", repoPath, "checkout", "-b", nextRun.branch]);

    console.log(
      [
        formatFinishedRun(inProgress),
        "",
        formatStartedRun(nextRun),
        "Next step (after the migration): npm run experiment:migrate-finish -- --status <succeeded|failed>",
      ].join("\n"),
    );
    return;
  }

  await saveManifest(manifest);
  await runGit(["-C", repoPath, "checkout", baseBranch]);

  console.log(
    [
      formatFinishedRun(inProgress),
      `Pair ${inProgress.pairId} is ready for selection.`,
      `Next step: npm run experiment:select -- --decision <composer-2|gpt-5.5-high|both|neither>`,
    ].join("\n"),
  );
}

function registerRun(
  manifest: ExperimentManifest,
  functionName: string,
  model: ModelName,
  targetRepo: SubjectRepositoryKey,
): ExperimentRun {
  const pair =
    findReusablePair(manifest, functionName, model) ?? createPair(manifest.pairs, functionName, model);
  if (!manifest.pairs.some((existing) => existing.pairId === pair.pairId)) {
    manifest.pairs.push(pair);
  }
  const baseBranch = manifest.subjectWorkspace.repositories[targetRepo].baseBranch;
  const run: ExperimentRun = {
    runId: nextRunId(manifest.runs),
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
  return run;
}

async function finalizeRun(
  manifest: ExperimentManifest,
  run: ExperimentRun,
  status: "succeeded" | "failed",
  providedCommit: string | undefined,
): Promise<void> {
  run.status = status;
  run.endedAt = new Date().toISOString();
  run.commit = providedCommit ?? (await resolveBranchCommit(manifest, run));
}

function createPair(
  pairs: ExperimentPair[],
  functionName: string,
  firstModel: ExperimentPair["firstModel"],
): ExperimentPair {
  return {
    pairId: nextPairId(pairs),
    functionName,
    createdAt: new Date().toISOString(),
    firstModel,
  };
}

function latestOpenPair(manifest: ExperimentManifest): ExperimentPair | undefined {
  const openPairs = manifest.pairs.filter((pair) => pair.selectedDecision === undefined);
  if (openPairs.length === 0) {
    return undefined;
  }
  return openPairs.reduce((latest, candidate) =>
    pairOrdinal(candidate) > pairOrdinal(latest) ? candidate : latest,
  );
}

function pairOrdinal(pair: ExperimentPair): number {
  const match = pair.pairId.match(/^pair-(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function findSingleInProgressRun(manifest: ExperimentManifest): ExperimentRun {
  const inProgress = manifest.runs.filter((run) => run.status === "in_progress");
  if (inProgress.length === 0) {
    throw new Error("No in_progress run found in the manifest.");
  }
  if (inProgress.length > 1) {
    throw new Error(
      `Multiple in_progress runs found: ${inProgress.map((run) => run.runId).join(", ")}. Finish or cancel the extras first.`,
    );
  }
  return inProgress[0];
}

function otherModelOf(model: ModelName): ModelName {
  return model === "composer-2" ? "gpt-5.5-high" : "composer-2";
}

function repoPathFor(manifest: ExperimentManifest, targetRepo: SubjectRepositoryKey): string {
  const repoConfig = manifest.subjectWorkspace.repositories[targetRepo];
  return path.join(manifest.subjectWorkspace.path, repoConfig.path);
}

async function ensureCleanTree(repoPath: string): Promise<void> {
  const status = (await runGit(["-C", repoPath, "status", "--porcelain"])).trim();
  if (status.length > 0) {
    throw new Error(
      `Working tree at ${repoPath} is dirty. Commit or stash changes before starting a migration.`,
    );
  }
}

async function ensureOnBranch(repoPath: string, expected: string): Promise<void> {
  const current = (await runGit(["-C", repoPath, "branch", "--show-current"])).trim();
  if (current !== expected) {
    throw new Error(`Expected branch '${expected}' in ${repoPath}, but found '${current}'.`);
  }
}

async function tryFastForwardPull(repoPath: string): Promise<void> {
  try {
    await runGit(["-C", repoPath, "pull", "--ff-only"], { timeout: 60_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`Pull skipped in ${repoPath}: ${detail}`);
  }
}

async function commitMigration(repoPath: string, run: ExperimentRun): Promise<void> {
  await runGit(["-C", repoPath, "add", "-A"]);
  const status = (await runGit(["-C", repoPath, "status", "--porcelain"])).trim();
  if (status.length === 0) {
    throw new Error(`No changes staged for commit on ${run.branch} in ${repoPath}.`);
  }
  const message = `chore: migrate ${run.functionName} to v2 with ${run.model}`;
  await runGit(["-C", repoPath, "commit", "-m", message]);
}

function formatStartedRun(run: ExperimentRun): string {
  return [
    `Started ${run.runId} (${run.pairId})`,
    `Function: ${run.functionName}`,
    `Model: ${run.model}`,
    `Branch: ${run.branch}`,
    `Target repo: ${run.targetRepo}`,
  ].join("\n");
}

function formatFinishedRun(run: ExperimentRun): string {
  return [
    `Finished ${run.runId}`,
    `Status: ${run.status}`,
    `Commit: ${run.commit ?? "(not found)"}`,
  ].join("\n");
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
  decision: SelectionDecision,
): string[] {
  if (decision === "neither") {
    return [];
  }

  const succeededRuns = runs.filter((run) => run.pairId === pairId && run.status === "succeeded");

  if (decision === "both") {
    const hasComposer = succeededRuns.some((run) => run.model === "composer-2");
    const hasGpt = succeededRuns.some((run) => run.model === "gpt-5.5-high");
    if (!hasComposer || !hasGpt) {
      throw new Error("Decision 'both' requires succeeded runs for both models in the pair.");
    }
    return succeededRuns.map((run) => run.runId);
  }

  const selectedRuns = succeededRuns.filter((run) => run.model === decision);
  if (selectedRuns.length === 0) {
    throw new Error(`Decision '${decision}' requires a succeeded run for that model in the pair.`);
  }
  return selectedRuns.map((run) => run.runId);
}

async function runGit(args: string[], options?: { timeout?: number }): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    timeout: options?.timeout ?? 30_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
