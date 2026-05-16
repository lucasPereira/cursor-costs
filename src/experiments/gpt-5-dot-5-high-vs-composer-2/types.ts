export type ModelName = "composer-2" | "gpt-5.5-high";
export type RunStatus = "in_progress" | "succeeded" | "failed";
export type SelectionDecision = ModelName | "both" | "neither";
export type SubjectRepositoryKey = "messengerx_backend" | "messengerx_firebase";

export type SubjectRepositoryConfig = {
  path: string;
  baseBranch: string;
};

export type ExperimentManifest = {
  schemaVersion: 1;
  experimentId: string;
  timezone: string;
  models: ModelName[];
  branchPattern: string;
  nextFirstModel: ModelName;
  subjectWorkspace: {
    path: string;
    branch: string;
    repositories: Record<SubjectRepositoryKey, SubjectRepositoryConfig>;
  };
  pairs: ExperimentPair[];
  runs: ExperimentRun[];
};

export type ExperimentPair = {
  pairId: string;
  functionName: string;
  createdAt: string;
  firstModel: ModelName;
  selectedDecision?: SelectionDecision;
  selectedRunIds?: string[];
  selectedAt?: string;
};

export type ExperimentRun = {
  runId: string;
  pairId: string;
  functionName: string;
  model: ModelName;
  targetRepo: SubjectRepositoryKey;
  baseBranch: string;
  branch: string;
  startedAt: string;
  status: RunStatus;
  endedAt?: string;
  commit?: string;
};

export type UsageMetrics = {
  inputWithCacheWriteTokens: number;
  inputWithoutCacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type RunAnalysis = {
  run: ExperimentRun;
  usage: UsageMetrics;
  derived: {
    costPerTotalToken: number | null;
  };
};
