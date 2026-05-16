import path from "node:path";

export const EXPERIMENT_ID = "gpt-5-dot-5-high-vs-composer-2";
export const EXPERIMENT_DIR = path.join("experiments", EXPERIMENT_ID);
export const ARTIFACT_DIR = path.join(EXPERIMENT_DIR, "artifacts");
export const CHARTS_DIR = path.join(ARTIFACT_DIR, "charts");
export const MANIFEST_PATH = path.join(ARTIFACT_DIR, "runs.manifest.json");
export const ANALYSIS_RESULTS_PATH = path.join(ARTIFACT_DIR, "analysis-results.json");
export const EXPERIMENT_CSV_PATH = path.join(ARTIFACT_DIR, "cursor-usage.csv");
