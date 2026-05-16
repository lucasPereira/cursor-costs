import { writeFile } from "node:fs/promises";

import { writeCharts, type ChartDatum } from "./charts.js";
import { collectGitMetrics } from "./gitMetrics.js";
import { ANALYSIS_RESULTS_PATH, EXPERIMENT_CSV_PATH } from "./paths.js";
import { loadManifest } from "./manifest.js";
import {
  bootstrapMedianConfidenceInterval,
  mannWhitneyU,
  median,
  ratio,
  summarize,
  wilcoxonSignedRank,
} from "./statistics.js";
import type { ExperimentManifest, ExperimentPair, ModelName, RunAnalysis } from "./types.js";
import { parseUsageCsv, summarizeUsageForRun } from "./usageCsv.js";

const MODELS: ModelName[] = ["composer-2", "gpt-5.5-high"];

export async function analyzeExperiment(csvPath = EXPERIMENT_CSV_PATH): Promise<void> {
  const manifest = await loadManifest();
  const usageRecords = await parseUsageCsv(csvPath);
  const runAnalyses: RunAnalysis[] = [];
  const warnings: string[] = [];

  for (const run of manifest.runs) {
    const usage = summarizeUsageForRun(usageRecords, run.model, run.startedAt, run.endedAt);
    const gitResult = await collectGitMetrics(manifest, run);
    if (gitResult.warning) {
      warnings.push(gitResult.warning);
    }
    runAnalyses.push({
      run,
      usage,
      derived: {
        costPerTotalToken: ratio(usage.costUsd, usage.totalTokens),
        outputTokenRatio: ratio(usage.outputTokens, usage.totalTokens),
        cacheReadRatio: ratio(usage.cacheReadTokens, usage.totalTokens),
        cacheWriteRatio: ratio(usage.inputWithCacheWriteTokens, usage.totalTokens),
        nonCacheInputRatio: ratio(usage.inputWithoutCacheWriteTokens, usage.totalTokens),
      },
      git: gitResult.metrics,
      warnings: gitResult.warning ? [gitResult.warning] : [],
    });
  }

  const paired = buildPairedMetrics(manifest, runAnalyses);
  const global = buildGlobalMetrics(manifest, runAnalyses);
  const charts = await writeCharts(buildChartData(paired, global));

  await writeFile(
    ANALYSIS_RESULTS_PATH,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        experimentId: manifest.experimentId,
        generatedAt: new Date().toISOString(),
        sourceCsv: csvPath,
        runMetrics: runAnalyses,
        pairedMetrics: paired.summary,
        pairedRows: paired.rows,
        globalMetrics: global,
        statisticalTests: paired.tests,
        charts,
        diagnostics: { warnings },
      },
      null,
      2,
    )}\n`,
  );
}

type PairedRow = {
  pairId: string;
  functionName: string;
  composerRunId: string;
  gptRunId: string;
  costDifference: number;
  totalTokenDifference: number;
  costPerTotalTokenDifference: number | null;
  outputTokenRatioDifference: number | null;
  cacheReadRatioDifference: number | null;
  cacheWriteRatioDifference: number | null;
  nonCacheInputRatioDifference: number | null;
};

type PairedAnalysis = {
  rows: PairedRow[];
  summary: Record<string, ReturnType<typeof pairedMetricSummary>>;
  tests: Record<string, ReturnType<typeof wilcoxonSignedRank>>;
};

function buildPairedMetrics(manifest: ExperimentManifest, runAnalyses: RunAnalysis[]): PairedAnalysis {
  const rows: PairedRow[] = [];
  for (const pair of manifest.pairs) {
    const composer = findFinishedRunAnalysis(runAnalyses, pair, "composer-2");
    const gpt = findFinishedRunAnalysis(runAnalyses, pair, "gpt-5.5-high");
    if (!composer || !gpt) {
      continue;
    }
    rows.push({
      pairId: pair.pairId,
      functionName: pair.functionName,
      composerRunId: composer.run.runId,
      gptRunId: gpt.run.runId,
      costDifference: gpt.usage.costUsd - composer.usage.costUsd,
      totalTokenDifference: gpt.usage.totalTokens - composer.usage.totalTokens,
      costPerTotalTokenDifference: nullableDifference(gpt.derived.costPerTotalToken, composer.derived.costPerTotalToken),
      outputTokenRatioDifference: nullableDifference(gpt.derived.outputTokenRatio, composer.derived.outputTokenRatio),
      cacheReadRatioDifference: nullableDifference(gpt.derived.cacheReadRatio, composer.derived.cacheReadRatio),
      cacheWriteRatioDifference: nullableDifference(gpt.derived.cacheWriteRatio, composer.derived.cacheWriteRatio),
      nonCacheInputRatioDifference: nullableDifference(
        gpt.derived.nonCacheInputRatio,
        composer.derived.nonCacheInputRatio,
      ),
    });
  }

  const metricValues = {
    costDifference: rows.map((row) => row.costDifference),
    totalTokenDifference: rows.map((row) => row.totalTokenDifference),
    costPerTotalTokenDifference: rows.flatMap((row) =>
      row.costPerTotalTokenDifference === null ? [] : [row.costPerTotalTokenDifference],
    ),
    outputTokenRatioDifference: rows.flatMap((row) =>
      row.outputTokenRatioDifference === null ? [] : [row.outputTokenRatioDifference],
    ),
    cacheReadRatioDifference: rows.flatMap((row) =>
      row.cacheReadRatioDifference === null ? [] : [row.cacheReadRatioDifference],
    ),
    cacheWriteRatioDifference: rows.flatMap((row) =>
      row.cacheWriteRatioDifference === null ? [] : [row.cacheWriteRatioDifference],
    ),
    nonCacheInputRatioDifference: rows.flatMap((row) =>
      row.nonCacheInputRatioDifference === null ? [] : [row.nonCacheInputRatioDifference],
    ),
  };

  return {
    rows,
    summary: Object.fromEntries(
      Object.entries(metricValues).map(([name, values]) => [name, pairedMetricSummary(values)]),
    ),
    tests: Object.fromEntries(
      Object.entries(metricValues).map(([name, values]) => [name, wilcoxonSignedRank(values)]),
    ),
  };
}

function buildGlobalMetrics(manifest: ExperimentManifest, runAnalyses: RunAnalysis[]): Record<string, unknown> {
  const finished = runAnalyses.filter((analysis) => analysis.run.status !== "in_progress");
  const selected = selectionBreakdown(manifest.pairs);
  const byModel = Object.fromEntries(
    MODELS.map((model) => {
      const runs = finished.filter((analysis) => analysis.run.model === model);
      const succeeded = runs.filter((analysis) => analysis.run.status === "succeeded");
      return [
        model,
        {
          totalCostUsd: sum(runs.map((analysis) => analysis.usage.costUsd)),
          finishedRuns: runs.length,
          succeededRuns: succeeded.length,
          failedRuns: runs.filter((analysis) => analysis.run.status === "failed").length,
          successRate: runs.length === 0 ? null : succeeded.length / runs.length,
          medianCostPerSucceededRun: median(succeeded.map((analysis) => analysis.usage.costUsd)),
          medianTotalTokensPerSucceededRun: median(succeeded.map((analysis) => analysis.usage.totalTokens)),
          medianCostPerTotalToken: median(
            runs.flatMap((analysis) =>
              analysis.derived.costPerTotalToken === null ? [] : [analysis.derived.costPerTotalToken],
            ),
          ),
          medianOutputTokenRatio: median(
            runs.flatMap((analysis) =>
              analysis.derived.outputTokenRatio === null ? [] : [analysis.derived.outputTokenRatio],
            ),
          ),
        },
      ];
    }),
  );

  return {
    byModel,
    selectionBreakdown: selected,
    globalTests: {
      costPerSucceededRun: mannWhitneyU(
        finished
          .filter((analysis) => analysis.run.model === "gpt-5.5-high" && analysis.run.status === "succeeded")
          .map((analysis) => analysis.usage.costUsd),
        finished
          .filter((analysis) => analysis.run.model === "composer-2" && analysis.run.status === "succeeded")
          .map((analysis) => analysis.usage.costUsd),
      ),
    },
  };
}

function buildChartData(
  paired: PairedAnalysis,
  global: Record<string, unknown>,
): Record<string, ChartDatum[]> {
  const byModel = global.byModel as Record<
    ModelName,
    {
      successRate: number | null;
      medianCostPerSucceededRun: number | null;
      medianTotalTokensPerSucceededRun: number | null;
      medianCostPerTotalToken: number | null;
      medianOutputTokenRatio: number | null;
    }
  >;
  const selection = global.selectionBreakdown as { counts: Record<string, number> };
  return {
    "paired-cost-difference": paired.rows.map((row) => ({
      label: row.functionName,
      value: row.costDifference,
    })),
    "paired-total-token-difference": paired.rows.map((row) => ({
      label: row.functionName,
      value: row.totalTokenDifference,
    })),
    "paired-cost-per-total-token-difference": paired.rows.flatMap((row) =>
      row.costPerTotalTokenDifference === null ? [] : [{ label: row.functionName, value: row.costPerTotalTokenDifference }],
    ),
    "paired-output-token-ratio-difference": paired.rows.flatMap((row) =>
      row.outputTokenRatioDifference === null ? [] : [{ label: row.functionName, value: row.outputTokenRatioDifference }],
    ),
    "success-rate-by-model": MODELS.map((model) => ({
      label: model,
      value: byModel[model].successRate ?? 0,
    })),
    "selection-breakdown": Object.entries(selection.counts).map(([label, value]) => ({ label, value })),
    "median-cost-per-succeeded-run": MODELS.map((model) => ({
      label: model,
      value: byModel[model].medianCostPerSucceededRun ?? 0,
    })),
    "median-total-tokens-per-succeeded-run": MODELS.map((model) => ({
      label: model,
      value: byModel[model].medianTotalTokensPerSucceededRun ?? 0,
    })),
    "median-cost-per-total-token": MODELS.map((model) => ({
      label: model,
      value: byModel[model].medianCostPerTotalToken ?? 0,
    })),
    "median-output-token-ratio": MODELS.map((model) => ({
      label: model,
      value: byModel[model].medianOutputTokenRatio ?? 0,
    })),
  };
}

function pairedMetricSummary(values: number[]): ReturnType<typeof summarize> & {
  bootstrapMedianConfidenceInterval: [number, number] | null;
} {
  return {
    ...summarize(values),
    bootstrapMedianConfidenceInterval: bootstrapMedianConfidenceInterval(values),
  };
}

function findFinishedRunAnalysis(
  analyses: RunAnalysis[],
  pair: ExperimentPair,
  model: ModelName,
): RunAnalysis | undefined {
  return analyses.find(
    (analysis) =>
      analysis.run.pairId === pair.pairId &&
      analysis.run.model === model &&
      analysis.run.status !== "in_progress" &&
      analysis.run.endedAt !== undefined,
  );
}

function selectionBreakdown(pairs: ExperimentPair[]): {
  counts: Record<string, number>;
  percentages: Record<string, number>;
  totalSelectedPairs: number;
} {
  const counts = { "composer-2": 0, "gpt-5.5-high": 0, both: 0, neither: 0 };
  for (const pair of pairs) {
    if (pair.selectedDecision) {
      counts[pair.selectedDecision] += 1;
    }
  }
  const totalSelectedPairs = Object.values(counts).reduce((sumValue, value) => sumValue + value, 0);
  const percentages = Object.fromEntries(
    Object.entries(counts).map(([key, value]) => [key, totalSelectedPairs === 0 ? 0 : value / totalSelectedPairs]),
  ) as Record<string, number>;
  return { counts, percentages, totalSelectedPairs };
}

function nullableDifference(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left - right;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
