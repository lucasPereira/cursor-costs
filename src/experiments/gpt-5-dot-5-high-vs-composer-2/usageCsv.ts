import { readFile } from "node:fs/promises";
import { parse } from "csv-parse/sync";

import type { ModelName, UsageMetrics } from "./types.js";

type RawUsageRecord = Record<string, string | undefined>;

export type UsageRecord = UsageMetrics & {
  date: Date;
  model: string;
};

const COLUMNS = {
  date: "Date",
  model: "Model",
  inputWithCacheWriteTokens: "Input (w/ Cache Write)",
  inputWithoutCacheWriteTokens: "Input (w/o Cache Write)",
  cacheReadTokens: "Cache Read",
  outputTokens: "Output Tokens",
  totalTokens: "Total Tokens",
  costUsd: "Cost",
} as const;

export async function parseUsageCsv(csvPath: string): Promise<UsageRecord[]> {
  const csv = await readFile(csvPath, "utf8");
  const records = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as RawUsageRecord[];

  return records.flatMap((record) => {
    const date = parseDate(record[COLUMNS.date]);
    if (!date) {
      return [];
    }
    return [
      {
        date,
        model: record[COLUMNS.model]?.trim() ?? "",
        inputWithCacheWriteTokens: parseNumber(record[COLUMNS.inputWithCacheWriteTokens]),
        inputWithoutCacheWriteTokens: parseNumber(record[COLUMNS.inputWithoutCacheWriteTokens]),
        cacheReadTokens: parseNumber(record[COLUMNS.cacheReadTokens]),
        outputTokens: parseNumber(record[COLUMNS.outputTokens]),
        totalTokens: parseNumber(record[COLUMNS.totalTokens]),
        costUsd: parseNumber(record[COLUMNS.costUsd]),
      },
    ];
  });
}

export function summarizeUsageForRun(
  records: UsageRecord[],
  model: ModelName,
  startedAt: string,
  endedAt: string | undefined,
): UsageMetrics {
  const start = new Date(startedAt);
  const end = endedAt ? new Date(endedAt) : new Date();
  return records
    .filter((record) => record.model === model)
    .filter((record) => record.date >= start && record.date <= end)
    .reduce(
      (sum, record) => ({
        inputWithCacheWriteTokens: sum.inputWithCacheWriteTokens + record.inputWithCacheWriteTokens,
        inputWithoutCacheWriteTokens: sum.inputWithoutCacheWriteTokens + record.inputWithoutCacheWriteTokens,
        cacheReadTokens: sum.cacheReadTokens + record.cacheReadTokens,
        outputTokens: sum.outputTokens + record.outputTokens,
        totalTokens: sum.totalTokens + record.totalTokens,
        costUsd: sum.costUsd + record.costUsd,
      }),
      emptyUsageMetrics(),
    );
}

export function emptyUsageMetrics(): UsageMetrics {
  return {
    inputWithCacheWriteTokens: 0,
    inputWithoutCacheWriteTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  };
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseNumber(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Number(value.replace(/usd|us\$|[$,\s]/gi, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
