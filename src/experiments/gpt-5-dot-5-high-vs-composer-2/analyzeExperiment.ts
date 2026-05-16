import { writeFile } from "node:fs/promises";

import { writeCharts, type ChartDatum } from "./charts.js";
import { ANALYSIS_RESULTS_PATH, EXPERIMENT_CSV_PATH } from "./paths.js";
import { loadManifest, MODELS } from "./manifest.js";
import {
  bootstrapMedianConfidenceInterval,
  median,
  ratio,
  summarize,
  wilcoxonSignedRank,
} from "./statistics.js";
import type { ExperimentManifest, ExperimentPair, ModelName, RunAnalysis, SelectionDecision } from "./types.js";
import { parseUsageCsv, summarizeUsageForRun } from "./usageCsv.js";

export async function analyzeExperiment(csvPath = EXPERIMENT_CSV_PATH): Promise<void> {
  const manifest = await loadManifest();
  const usageRecords = await parseUsageCsv(csvPath);
  const runAnalyses: RunAnalysis[] = manifest.runs.map((run) => {
    const usage = summarizeUsageForRun(usageRecords, run.model, run.startedAt, run.endedAt);
    return {
      run,
      usage,
      derived: {
        costPerTotalToken: ratio(usage.costUsd, usage.totalTokens),
      },
    };
  });

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
        pairedMetrics: paired.summary,
        pairedRows: paired.rows,
        globalMetrics: global,
        statisticalTests: paired.tests,
        charts,
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
};

type PairedMetricSummary = {
  comparedPairs: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
};

type PairedAnalysis = {
  rows: PairedRow[];
  summary: Record<string, PairedMetricSummary>;
  tests: Record<string, PairedTestResult>;
};

type PairedTestResult = {
  wilcoxon: ReturnType<typeof wilcoxonSignedRank>;
  bootstrapMedianConfidenceInterval: [number, number] | null;
};

function summarizePairedDifferences(values: number[]): PairedMetricSummary {
  const { count, median: medianValue, mean, min, max } = summarize(values);
  return { comparedPairs: count, median: medianValue, mean, min, max };
}

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
    });
  }

  const metricValues = {
    costDifference: rows.map((row) => row.costDifference),
    totalTokenDifference: rows.map((row) => row.totalTokenDifference),
    costPerTotalTokenDifference: rows.flatMap((row) =>
      row.costPerTotalTokenDifference === null ? [] : [row.costPerTotalTokenDifference],
    ),
  };

  return {
    rows,
    summary: Object.fromEntries(
      Object.entries(metricValues).map(([name, values]) => [name, summarizePairedDifferences(values)]),
    ),
    tests: Object.fromEntries(
      Object.entries(metricValues).map(([name, values]) => [
        name,
        {
          wilcoxon: wilcoxonSignedRank(values),
          bootstrapMedianConfidenceInterval: bootstrapMedianConfidenceInterval(values),
        },
      ]),
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
        },
      ];
    }),
  );

  return {
    byModel,
    selectionBreakdown: selected,
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
  const counts: Record<SelectionDecision, number> = {
    "composer-2": 0,
    "gpt-5.5-high": 0,
    both: 0,
    neither: 0,
  };
  for (const pair of pairs) {
    if (pair.selectedDecision) {
      counts[pair.selectedDecision] += 1;
    }
  }
  const totalSelectedPairs = Object.values(counts).reduce((acc, value) => acc + value, 0);
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
