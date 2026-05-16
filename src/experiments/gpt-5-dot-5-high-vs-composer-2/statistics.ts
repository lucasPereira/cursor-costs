export type SummaryStats = {
  count: number;
  median: number | null;
  mean: number | null;
  min: number | null;
  max: number | null;
};

export type TestResult = {
  test: "wilcoxon_signed_rank";
  n: number;
  statistic: number | null;
  pValueApprox: number | null;
  effectSize: number | null;
  note?: string;
};

export function summarize(values: number[]): SummaryStats {
  const clean = values.filter(Number.isFinite).sort((left, right) => left - right);
  return {
    count: clean.length,
    median: percentileSorted(clean, 0.5),
    mean: clean.length === 0 ? null : clean.reduce((sum, value) => sum + value, 0) / clean.length,
    min: clean[0] ?? null,
    max: clean.at(-1) ?? null,
  };
}

export function median(values: number[]): number | null {
  return summarize(values).median;
}

export function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function wilcoxonSignedRank(differences: number[]): TestResult {
  const nonZero = differences.filter((value) => Number.isFinite(value) && value !== 0);
  if (nonZero.length < 2) {
    return {
      test: "wilcoxon_signed_rank",
      n: nonZero.length,
      statistic: null,
      pValueApprox: null,
      effectSize: null,
      note: "Not enough non-zero paired differences.",
    };
  }

  const ranked = rankAbsoluteValues(nonZero);
  const positiveRankSum = ranked
    .filter((item) => item.value > 0)
    .reduce((sum, item) => sum + item.rank, 0);
  const negativeRankSum = ranked
    .filter((item) => item.value < 0)
    .reduce((sum, item) => sum + item.rank, 0);
  const statistic = Math.min(positiveRankSum, negativeRankSum);
  const n = nonZero.length;
  const mean = (n * (n + 1)) / 4;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24;
  const z = (statistic - mean) / Math.sqrt(variance);
  const pValueApprox = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    test: "wilcoxon_signed_rank",
    n,
    statistic,
    pValueApprox,
    effectSize: Math.abs(z) / Math.sqrt(n),
  };
}

export function bootstrapMedianConfidenceInterval(values: number[], iterations = 1000): [number, number] | null {
  const clean = values.filter(Number.isFinite);
  if (clean.length === 0) {
    return null;
  }
  const medians: number[] = [];
  let seed = 123456789;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample: number[] = [];
    for (let index = 0; index < clean.length; index += 1) {
      seed = (1664525 * seed + 1013904223) % 4294967296;
      sample.push(clean[Math.floor((seed / 4294967296) * clean.length)]);
    }
    const value = median(sample);
    if (value !== null) {
      medians.push(value);
    }
  }
  medians.sort((left, right) => left - right);
  const lower = percentileSorted(medians, 0.025);
  const upper = percentileSorted(medians, 0.975);
  return lower === null || upper === null ? null : [lower, upper];
}

function percentileSorted(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) {
    return null;
  }
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) {
    return sortedValues[lower];
  }
  const weight = index - lower;
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function rankAbsoluteValues(values: number[]): Array<{ value: number; rank: number }> {
  const sorted = values
    .map((value, index) => ({ value, abs: Math.abs(value), index }))
    .sort((left, right) => left.abs - right.abs);
  const ranks = rankSortedValues(sorted.map((item) => item.abs));
  return sorted
    .map((item, index) => ({ value: item.value, rank: ranks[index], index: item.index }))
    .sort((left, right) => left.index - right.index);
}

function rankSortedValues(sortedValues: number[]): number[] {
  const ranks = new Array<number>(sortedValues.length);
  let index = 0;
  while (index < sortedValues.length) {
    let end = index + 1;
    while (end < sortedValues.length && sortedValues[end] === sortedValues[index]) {
      end += 1;
    }
    const rank = (index + 1 + end) / 2;
    for (let cursor = index; cursor < end; cursor += 1) {
      ranks[cursor] = rank;
    }
    index = end;
  }
  return ranks;
}

function normalCdf(value: number): number {
  return 0.5 * (1 + erf(value / Math.SQRT2));
}

function erf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * x);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x));
  return sign * y;
}
