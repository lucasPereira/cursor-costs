import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { ExperimentManifest, ExperimentRun, GitMetrics } from "./types.js";

const execFileAsync = promisify(execFile);

export async function collectGitMetrics(
  manifest: ExperimentManifest,
  run: ExperimentRun,
): Promise<{ metrics: GitMetrics | null; warning?: string }> {
  const repoConfig = manifest.subjectWorkspace.repositories[run.targetRepo];
  const repoPath = path.join(manifest.subjectWorkspace.path, repoConfig.path);

  const branchRef = `refs/heads/${run.branch}`;
  const baseRef = `refs/heads/${run.baseBranch}`;
  try {
    const shortstat = await git(repoPath, ["diff", "--shortstat", `${baseRef}...${branchRef}`]);
    const commitCountRaw = await git(repoPath, ["rev-list", "--count", `${baseRef}..${branchRef}`]);
    return {
      metrics: {
        ...parseShortstat(shortstat),
        commitCount: Number(commitCountRaw.trim()) || 0,
      },
    };
  } catch (error) {
    return {
      metrics: null,
      warning: `Could not collect Git metrics for ${run.runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

export async function resolveBranchCommit(
  manifest: ExperimentManifest,
  run: ExperimentRun,
): Promise<string | undefined> {
  const repoConfig = manifest.subjectWorkspace.repositories[run.targetRepo];
  const repoPath = path.join(manifest.subjectWorkspace.path, repoConfig.path);
  try {
    return (await git(repoPath, ["rev-parse", "--verify", `refs/heads/${run.branch}`])).trim();
  } catch {
    return undefined;
  }
}

async function git(repoPath: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", repoPath, ...args], {
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout;
}

function parseShortstat(shortstat: string): Omit<GitMetrics, "commitCount"> {
  const changedFiles = Number(shortstat.match(/(\d+)\s+files? changed/)?.[1] ?? 0);
  const addedLines = Number(shortstat.match(/(\d+)\s+insertions?\(\+\)/)?.[1] ?? 0);
  const removedLines = Number(shortstat.match(/(\d+)\s+deletions?\(-\)/)?.[1] ?? 0);
  return { changedFiles, addedLines, removedLines };
}
