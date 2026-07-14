import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parse } from "csv-parse/sync";
import { chromium, type BrowserContext, type Page, type Request } from "playwright";

const CURSOR_USAGE_URL = "https://cursor.com/dashboard/usage";
const DOWNLOADS_DIR = "downloads";
const PROFILE_DIR = ".playwright/cursor-profile";
const USAGE_EVENTS_ENDPOINT = "/api/dashboard/get-filtered-usage-events";

/** Throws if HEADED is unset or not a recognized boolean string. */
export function parseHeadedEnv(): boolean {
  const raw = process.env.HEADED?.trim();
  if (raw === undefined || raw === "") {
    throw new Error(
      'Define HEADED in your environment or .env file: use "0", "false", or "no" for headless, or "1", "true", or "yes" for a visible browser.',
    );
  }
  const value = raw.toLowerCase();
  if (value === "1" || value === "true" || value === "yes") {
    return true;
  }
  if (value === "0" || value === "false" || value === "no") {
    return false;
  }
  throw new Error('HEADED must be one of: 0, 1, true, false, yes, no (case insensitive).');
}

/**
 * When true, Included (plan) rows keep their notional API cost. When false,
 * those rows are written as Cost 0.00. Throws if COUNT_INCLUDED is unset.
 */
export function parseCountIncludedEnv(): boolean {
  const raw = process.env.COUNT_INCLUDED?.trim();
  if (raw === undefined || raw === "") {
    throw new Error(
      'Define COUNT_INCLUDED in your environment or .env file: use "0", "false", or "no" to zero Included costs, or "1", "true", or "yes" to count notional Included costs.',
    );
  }
  const value = raw.toLowerCase();
  if (value === "1" || value === "true" || value === "yes") {
    return true;
  }
  if (value === "0" || value === "false" || value === "no") {
    return false;
  }
  throw new Error('COUNT_INCLUDED must be one of: 0, 1, true, false, yes, no (case insensitive).');
}

type CsvRow = Record<string, string | undefined>;

type SpendPeriod = {
  label?: string;
  total: number;
  byModel: Map<string, number>;
};

type SelectedModels = {
  visible: string[];
  omitted: string[];
};

const FALLBACK_VISIBLE_MODEL_COUNT = 5;

async function launchBrowser(): Promise<BrowserContext> {
  await mkdir(DOWNLOADS_DIR, { recursive: true });
  await mkdir(PROFILE_DIR, { recursive: true });

  const options = {
    acceptDownloads: true,
    downloadsPath: DOWNLOADS_DIR,
    headless: !parseHeadedEnv(),
    viewport: { width: 1440, height: 1000 },
    args: ["--disable-blink-features=AutomationControlled"],
  };

  try {
    return await chromium.launchPersistentContext(PROFILE_DIR, {
      ...options,
      channel: "chrome",
    });
  } catch {
    return await chromium.launchPersistentContext(PROFILE_DIR, options);
  }
}

export type DownloadCsvOptions = {
  /** First day of the range (default: first day of the current local month). */
  startDate?: Date;
  /** When true, Included rows keep chargedCents/100; when false they are 0. */
  countIncluded?: boolean;
};

/**
 * Builds a CSV via the dashboard usage API instead of the Download CSV button.
 * Native export puts "-" in Cost for Included rows, which drops them from
 * totals; the API returns chargedCents for those events so we can zero or
 * count them via countIncluded.
 */
export async function downloadCsv(options: DownloadCsvOptions = {}): Promise<string> {
  const startDate = options.startDate ?? firstDayOfCurrentMonth();
  const countIncluded = options.countIncluded ?? parseCountIncludedEnv();

  const browser = await launchBrowser();
  await browser.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });
  });

  try {
    const page = browser.pages()[0] ?? (await browser.newPage());
    await page.goto(CURSOR_USAGE_URL, { waitUntil: "domcontentloaded" });
    await waitForLoginIfNeeded(page);

    const queryBase = await captureUsageQueryBase(page);
    const events = await fetchAllUsageEvents(page, queryBase, startDate, new Date());
    const csv = usageEventsToCsv(events, countIncluded);

    const filePath = path.join(DOWNLOADS_DIR, `cursor-usage-${formatLocalTimestampForFilename(new Date())}.csv`);
    await writeFile(filePath, csv);
    return filePath;
  } finally {
    await browser.close();
  }
}

async function waitForLoginIfNeeded(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);

  const loginLink = page.getByRole("link", { name: /sign in|log in/i }).first();
  const needsLogin = await loginLink.isVisible({ timeout: 2_000 }).catch(() => false);

  if (!needsLogin) {
    return;
  }

  const rl = createInterface({ input, output });
  await rl.question("Please sign in using the opened browser, then press Enter to continue...");
  rl.close();

  await page.goto(CURSOR_USAGE_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

type UsageQueryBase = {
  teamId?: number | string;
  userId?: number | string;
  [key: string]: unknown;
};

/**
 * The dashboard date-range UI is unreliable to drive, so we reuse the same
 * get-filtered-usage-events POST body the page fires on load (team/user scope)
 * and only override dates and pagination.
 */
async function captureUsageQueryBase(page: Page): Promise<UsageQueryBase> {
  let teamOnly: UsageQueryBase | undefined;
  let resolveWithUser: (base: UsageQueryBase) => void = () => {};
  const withUser = new Promise<UsageQueryBase>((resolve) => {
    resolveWithUser = resolve;
  });

  const onRequest = (request: Request) => {
    if (request.method() !== "POST" || !request.url().includes(USAGE_EVENTS_ENDPOINT)) {
      return;
    }
    const body = request.postDataJSON() as UsageQueryBase | null;
    if (!body || body.teamId === undefined || body.teamId === null) {
      return;
    }
    if (body.userId !== undefined && body.userId !== null) {
      resolveWithUser(body);
      return;
    }
    teamOnly ??= body;
  };

  page.on("request", onRequest);
  try {
    await page.reload({ waitUntil: "domcontentloaded" }).catch(() => undefined);
    const userScoped = await Promise.race([
      withUser,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 30_000)),
    ]);

    const chosen = userScoped ?? teamOnly;
    if (!chosen) {
      throw new Error("Could not capture the usage dashboard's get-filtered-usage-events request.");
    }
    return chosen;
  } finally {
    page.off("request", onRequest);
  }
}

type RawUsageEvent = {
  timestamp?: string;
  model?: string;
  kind?: string;
  chargedCents?: number;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  };
};

type UsageEventsResponse = {
  totalUsageEventsCount?: number;
  usageEventsDisplay?: RawUsageEvent[];
};

async function fetchAllUsageEvents(
  page: Page,
  queryBase: UsageQueryBase,
  startDate: Date,
  endDate: Date,
): Promise<RawUsageEvent[]> {
  const pageSize = 1_000;
  const startMs = String(startDate.getTime());
  const endMs = String(endDate.getTime());
  const events: RawUsageEvent[] = [];
  let total = Number.POSITIVE_INFINITY;

  for (let pageNumber = 1; events.length < total && pageNumber <= 1_000; pageNumber += 1) {
    const requestBody = {
      ...queryBase,
      startDate: startMs,
      endDate: endMs,
      page: pageNumber,
      pageSize,
    };

    const response = (await page.evaluate(
      async ({ endpoint, body }) => {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });
        if (!res.ok) {
          throw new Error(`Usage events request failed with HTTP ${res.status}`);
        }
        return res.json();
      },
      { endpoint: USAGE_EVENTS_ENDPOINT, body: requestBody },
    )) as UsageEventsResponse;

    total = Number(response.totalUsageEventsCount ?? 0);
    const batch = response.usageEventsDisplay ?? [];
    if (batch.length === 0) {
      break;
    }
    events.push(...batch);
  }

  return events;
}

const USAGE_CSV_HEADER =
  "Date,User,Cloud Agent ID,Automation ID,Kind,Model,Max Mode,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost";

function usageEventsToCsv(events: RawUsageEvent[], countIncluded: boolean): string {
  const rows = events.flatMap((event) => {
    if (!event.timestamp) {
      return [];
    }
    const tokens = event.tokenUsage ?? {};
    const inputWithCacheWrite = Number(tokens.cacheWriteTokens ?? 0);
    const inputWithoutCacheWrite = Number(tokens.inputTokens ?? 0);
    const cacheRead = Number(tokens.cacheReadTokens ?? 0);
    const output = Number(tokens.outputTokens ?? 0);
    const totalTokens = inputWithCacheWrite + inputWithoutCacheWrite + cacheRead + output;
    const costUsd = eventCostUsd(event, countIncluded);

    return [
      [
        new Date(Number(event.timestamp)).toISOString(),
        "",
        "",
        "",
        usageKindLabel(event.kind),
        event.model ?? "",
        "No",
        inputWithCacheWrite,
        inputWithoutCacheWrite,
        cacheRead,
        output,
        totalTokens,
        costUsd.toFixed(2),
      ]
        .map(csvField)
        .join(","),
    ];
  });

  return `${[USAGE_CSV_HEADER, ...rows].join("\n")}\n`;
}

function eventCostUsd(event: RawUsageEvent, countIncluded: boolean): number {
  if (isNotChargedKind(event.kind)) {
    return 0;
  }
  if (event.kind === "USAGE_EVENT_KIND_INCLUDED_IN_BUSINESS" && !countIncluded) {
    return 0;
  }
  return Number(event.chargedCents ?? 0) / 100;
}

/** Errored / aborted / free kinds are never billed; Included is handled separately via countIncluded. */
function isNotChargedKind(kind: string | undefined): boolean {
  return kind === undefined ? false : /ERRORED|ABORTED|NOT_CHARGED|FREE/i.test(kind);
}

function usageKindLabel(kind: string | undefined): string {
  switch (kind) {
    case "USAGE_EVENT_KIND_USAGE_BASED":
      return "On-Demand";
    case "USAGE_EVENT_KIND_INCLUDED_IN_BUSINESS":
      return "Included";
    case "USAGE_EVENT_KIND_ERRORED_NOT_CHARGED":
      return "Errored, No Charge";
    case "USAGE_EVENT_KIND_ABORTED_NOT_CHARGED":
      return "Aborted, Not Charged";
    default:
      return kind ?? "";
  }
}

function csvField(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export type UsageRow = { date: Date; cost: number; model: string };

export async function readUsageRows(
  csvPath: string,
): Promise<{
  rows: UsageRow[];
  dateColumn: string;
  costColumn: string;
  modelColumn: string | undefined;
}> {
  const csv = await readFile(csvPath, "utf8");
  const records = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as CsvRow[];

  if (records.length === 0) {
    throw new Error("CSV is empty.");
  }

  const columns = Object.keys(records[0]);
  const dateColumn = findDateColumn(columns);
  const costColumn = findCostColumn(columns);
  const used = new Set([dateColumn, costColumn].filter(Boolean) as string[]);
  const modelColumn = findModelColumn(columns, used);

  if (!dateColumn || !costColumn) {
    throw new Error(`Could not find date/cost columns. Columns: ${columns.join(", ")}`);
  }

  const currentMonth = new Date();
  const rows = records
    .map((record) => ({
      date: parseDate(record[dateColumn]),
      cost: parseCost(record[costColumn]),
      model: modelColumn ? (record[modelColumn]?.trim() ?? "") : "",
    }))
    .filter((row): row is UsageRow => row.date !== null && row.cost !== null)
    .filter((row) => row.date.getFullYear() === currentMonth.getFullYear())
    .filter((row) => row.date.getMonth() === currentMonth.getMonth());

  return { rows, dateColumn, costColumn, modelColumn };
}

function aggregateByDayAndModel(rows: UsageRow[], hasModelColumn: boolean): {
  byDay: Map<string, Map<string, number>>;
  models: string[];
} {
  const byDay = new Map<string, Map<string, number>>();
  const modelTotals = new Map<string, number>();

  for (const row of rows) {
    const dayKey = toDateKey(row.date);
    if (!byDay.has(dayKey)) {
      byDay.set(dayKey, new Map());
    }
    const inner = byDay.get(dayKey)!;
    const modelKey = hasModelColumn ? (row.model.trim() || "(unspecified)") : "*";
    const add = row.cost;
    inner.set(modelKey, (inner.get(modelKey) ?? 0) + add);
    if (hasModelColumn && modelKey !== "*") {
      modelTotals.set(modelKey, (modelTotals.get(modelKey) ?? 0) + add);
    }
  }

  const models = [...modelTotals.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name]) => name);

  return { byDay, models };
}

export function printCosts(rows: UsageRow[], hasModelColumn: boolean): void {
  const today = new Date();
  const { byDay, models } = aggregateByDayAndModel(rows, hasModelColumn);

  const dailyPeriods: SpendPeriod[] = [];
  const weeklyPeriods: SpendPeriod[] = [];
  let weekStart = startOfCurrentWeek(new Date(today.getFullYear(), today.getMonth(), 1));
  const weekModelSpend = new Map<string, number>();
  for (const model of models) {
    weekModelSpend.set(model, 0);
  }
  let weekTotalSpend = 0;
  let monthlyTotal = 0;
  const monthlyByModel = new Map<string, number>();
  for (const model of models) {
    monthlyByModel.set(model, 0);
  }

  for (const day of daysInCurrentMonthUntilToday()) {
    const dayKey = toDateKey(day);
    const dayMap = byDay.get(dayKey) ?? new Map<string, number>();

    let dayTotal = 0;
    for (const value of dayMap.values()) {
      dayTotal += value;
    }

    monthlyTotal += dayTotal;
    weekTotalSpend += dayTotal;

    const dayByModel = new Map<string, number>();
    if (hasModelColumn && models.length > 0) {
      for (const model of models) {
        const part = dayMap.get(model) ?? 0;
        dayByModel.set(model, part);
        monthlyByModel.set(model, (monthlyByModel.get(model) ?? 0) + part);
      }
    }
    dailyPeriods.push({ label: dayKey, total: dayTotal, byModel: dayByModel });

    if (hasModelColumn && models.length > 0) {
      for (const model of models) {
        const part = dayMap.get(model) ?? 0;
        weekModelSpend.set(model, (weekModelSpend.get(model) ?? 0) + part);
      }
    }

    const isSunday = day.getDay() === 0;
    const isToday = dayKey === toDateKey(today);
    if (isSunday || isToday) {
      weeklyPeriods.push({
        label: `${toDateKey(maxDate(weekStart, firstDayOfCurrentMonth()))} to ${dayKey}`,
        total: weekTotalSpend,
        byModel: new Map(weekModelSpend),
      });

      weekStart = addDays(day, 1);
      weekTotalSpend = 0;
      for (const model of models) {
        weekModelSpend.set(model, 0);
      }
    }
  }

  console.log("\nSpend per day");
  printSpendTable("Day", dailyPeriods, hasModelColumn ? models : []);

  console.log("\nSpend per week");
  printSpendTable("Week", weeklyPeriods, hasModelColumn ? models : []);

  if (hasModelColumn && models.length > 0) {
    console.log("\nSpend per month");
    printSpendTable(undefined, [{ total: monthlyTotal, byModel: monthlyByModel }], models);
  }
  console.log("");
}

function printSpendTable(labelColumn: string | undefined, periods: SpendPeriod[], models: string[]): void {
  console.table(spendTableRows(labelColumn, periods, models));
}

function spendTableRows(
  labelColumn: string | undefined,
  periods: SpendPeriod[],
  models: string[],
): Record<string, string>[] {
  const { visible, omitted } = selectModelsForConsoleTable(labelColumn, periods, models);

  return periods.map((period) => {
    const row: Record<string, string> = {};
    if (labelColumn) {
      row[labelColumn] = period.label ?? "";
    }
    row.Total = money(period.total);

    for (const model of visible) {
      row[model] = money(period.byModel.get(model) ?? 0);
    }

    if (omitted.length > 0) {
      row.Other = money(sumModels(period.byModel, omitted));
    }

    return row;
  });
}

function selectModelsForConsoleTable(
  labelColumn: string | undefined,
  periods: SpendPeriod[],
  models: string[],
): SelectedModels {
  const maxWidth = terminalWidth();
  if (maxWidth === undefined) {
    return splitVisibleModels(models, FALLBACK_VISIBLE_MODEL_COUNT);
  }

  if (consoleTableWidth(labelColumn, periods, { visible: models, omitted: [] }) <= maxWidth) {
    return { visible: models, omitted: [] };
  }

  const visible: string[] = [];
  for (const model of models) {
    const candidateVisible = [...visible, model];
    const candidate = {
      visible: candidateVisible,
      omitted: models.filter((name) => !candidateVisible.includes(name)),
    };

    if (consoleTableWidth(labelColumn, periods, candidate) > maxWidth) {
      break;
    }

    visible.push(model);
  }

  return {
    visible,
    omitted: models.filter((name) => !visible.includes(name)),
  };
}

function splitVisibleModels(models: string[], visibleCount: number): SelectedModels {
  return {
    visible: models.slice(0, visibleCount),
    omitted: models.slice(visibleCount),
  };
}

function consoleTableWidth(
  labelColumn: string | undefined,
  periods: SpendPeriod[],
  selection: SelectedModels,
): number {
  const labels = [
    "(index)",
    ...(labelColumn ? [labelColumn] : []),
    "Total",
    ...selection.visible,
    ...(selection.omitted.length > 0 ? ["Other"] : []),
  ];
  const widths = labels.map((label) => label.length);
  const lastIndex = Math.max(periods.length - 1, 0);
  widths[0] = Math.max(widths[0] ?? 0, String(lastIndex).length);

  periods.forEach((period, rowIndex) => {
    let columnIndex = 0;
    widths[columnIndex] = Math.max(widths[columnIndex] ?? 0, String(rowIndex).length);
    columnIndex += 1;

    if (labelColumn) {
      widths[columnIndex] = Math.max(widths[columnIndex] ?? 0, consoleTableStringWidth(period.label ?? ""));
      columnIndex += 1;
    }

    widths[columnIndex] = Math.max(widths[columnIndex] ?? 0, consoleTableStringWidth(money(period.total)));
    columnIndex += 1;

    for (const model of selection.visible) {
      widths[columnIndex] = Math.max(
        widths[columnIndex] ?? 0,
        consoleTableStringWidth(money(period.byModel.get(model) ?? 0)),
      );
      columnIndex += 1;
    }

    if (selection.omitted.length > 0) {
      widths[columnIndex] = Math.max(
        widths[columnIndex] ?? 0,
        consoleTableStringWidth(money(sumModels(period.byModel, selection.omitted))),
      );
    }
  });

  return widths.reduce((sum, width) => sum + width, 0) + widths.length * 3 + 1;
}

function consoleTableStringWidth(value: string): number {
  return value.length + 2;
}

function sumModels(values: Map<string, number>, models: string[]): number {
  return models.reduce((sum, model) => sum + (values.get(model) ?? 0), 0);
}

function terminalWidth(): number | undefined {
  return process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : undefined;
}

function findModelColumn(columns: string[], skip: Set<string>): string | undefined {
  let best: string | undefined;
  let bestScore = 0;

  for (const column of columns) {
    if (skip.has(column)) {
      continue;
    }
    const normalized = normalizeHeader(column);
    if (!normalized) {
      continue;
    }
    if (normalized.includes("token") || normalized.includes("cost") || normalized.includes("usd")) {
      continue;
    }
    if (normalized.includes("date") || normalized.includes("time") || normalized.includes("created")) {
      continue;
    }

    let score = 0;
    if (normalized === "model") {
      score += 100;
    }
    if (normalized === "modelname") {
      score += 98;
    }
    if (normalized.includes("modelname")) {
      score += 95;
    }
    if (normalized.endsWith("model") || normalized.startsWith("model")) {
      score += 88;
    }
    if (normalized.includes("model") && !normalized.includes("modelcount")) {
      score += 80;
    }
    if (normalized.includes("engine")) {
      score += 75;
    }
    if (normalized.includes("agent") && !normalized.includes("usage")) {
      score += 70;
    }
    if (normalized === "provider" || normalized.includes("provider")) {
      score += 65;
    }

    if (score > bestScore) {
      bestScore = score;
      best = column;
    }
  }

  return bestScore >= 60 ? best : undefined;
}

function normalizeHeader(column: string): string {
  return column.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findDateColumn(columns: string[]): string | undefined {
  const terms = ["date", "day", "timestamp", "created", "time", "period"];
  for (const term of terms) {
    const hit = columns.find((column) => {
      const normalized = normalizeHeader(column);
      return normalized === term || normalized.endsWith(term) || normalized.includes(term);
    });
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

function isSpendLikeColumnName(column: string): boolean {
  const normalized = normalizeHeader(column);
  if (!normalized) {
    return false;
  }
  if (normalized.includes("token")) {
    return false;
  }
  if (normalized.includes("char") && !normalized.includes("charge")) {
    return false;
  }
  if (normalized.includes("request") && !normalized.includes("cost")) {
    return false;
  }
  if (normalized.includes("count") && !normalized.includes("cost") && !normalized.includes("account")) {
    return false;
  }
  if (normalized.includes("model") || normalized.includes("duration") || normalized.includes("latency")) {
    return false;
  }
  return true;
}

function scoreCostColumn(column: string): number {
  const normalized = normalizeHeader(column);
  let score = 0;
  if (normalized === "cost") {
    score += 100;
  }
  if (normalized.endsWith("cost") && !normalized.includes("token")) {
    score += 95;
  }
  if (normalized.includes("usage") && normalized.includes("cost")) {
    score += 92;
  }
  if (normalized.includes("spend") || normalized.includes("spent")) {
    score += 88;
  }
  if (normalized.includes("charge") && !normalized.includes("token")) {
    score += 82;
  }
  if ((normalized.includes("usd") || normalized.includes("dollar")) && normalized.includes("cost")) {
    score += 90;
  }
  if (normalized === "amount" || (normalized.includes("amount") && !normalized.includes("token"))) {
    score += 75;
  }
  if (normalized === "total" || normalized === "totalusd") {
    score += 50;
  }
  if (normalized.includes("total") && !normalized.includes("token") && !normalized.includes("subtotal")) {
    score += 35;
  }
  if (normalized.includes("price") && !normalized.includes("token")) {
    score += 70;
  }
  return score;
}

function findCostColumn(columns: string[]): string | undefined {
  let best: string | undefined;
  let bestScore = 0;
  for (const column of columns) {
    if (!isSpendLikeColumnName(column)) {
      continue;
    }
    const score = scoreCostColumn(column);
    if (score > bestScore) {
      bestScore = score;
      best = column;
    }
  }
  return bestScore > 0 ? best : undefined;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const isoDateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnly) {
    return new Date(Number(isoDateOnly[1]), Number(isoDateOnly[2]) - 1, Number(isoDateOnly[3]));
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseCost(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const cost = Number(value.replace(/usd|us\$|[$,\s]/gi, ""));
  return Number.isFinite(cost) ? cost : null;
}

function daysInCurrentMonthUntilToday(): Date[] {
  const today = new Date();
  const days: Date[] = [];
  const cursor = firstDayOfCurrentMonth();

  while (cursor <= today) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function firstDayOfCurrentMonth(): Date {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), 1);
}

function startOfCurrentWeek(date: Date): Date {
  const start = new Date(date);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return start;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function maxDate(left: Date, right: Date): Date {
  return left > right ? left : right;
}

function formatLocalTimestampForFilename(date: Date): string {
  const pad2 = (value: number) => String(value).padStart(2, "0");
  const pad3 = (value: number) => String(value).padStart(3, "0");
  return [
    date.getFullYear(),
    "-",
    pad2(date.getMonth() + 1),
    "-",
    pad2(date.getDate()),
    "T",
    pad2(date.getHours()),
    "-",
    pad2(date.getMinutes()),
    "-",
    pad2(date.getSeconds()),
    "-",
    pad3(date.getMilliseconds()),
  ].join("");
}

function toDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function money(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

export function sumTodaySpendUsd(rows: UsageRow[]): number {
  const todayKey = toDateKey(new Date());
  return rows.filter((row) => toDateKey(row.date) === todayKey).reduce((sum, row) => sum + row.cost, 0);
}
