import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type { ExperimentManifest, ExperimentRun } from "./types.js";

const execFileAsync = promisify(execFile);

export async function resolveBranchCommit(
  manifest: ExperimentManifest,
  run: ExperimentRun,
): Promise<string | undefined> {
  const repoConfig = manifest.subjectWorkspace.repositories[run.targetRepo];
  const repoPath = path.join(manifest.subjectWorkspace.path, repoConfig.path);
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", repoPath, "rev-parse", "--verify", `refs/heads/${run.branch}`],
      { timeout: 10_000 },
    );
    return stdout.trim();
  } catch {
    return undefined;
  }
}
