import { copyFile } from "node:fs/promises";

import { downloadCsv } from "../../usageWorker.js";
import { EXPERIMENT_CSV_PATH } from "./paths.js";

export async function downloadExperimentCsv(): Promise<string> {
  const downloadedPath = await downloadCsv();
  await copyFile(downloadedPath, EXPERIMENT_CSV_PATH);
  return EXPERIMENT_CSV_PATH;
}
