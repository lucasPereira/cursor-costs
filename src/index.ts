import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { parse } from "csv-parse/sync";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

const CURSOR_USAGE_URL = "https://cursor.com/dashboard/usage";
const DOWNLOADS_DIR = "downloads";
const PROFILE_DIR = ".playwright/cursor-profile";

function isHeadedMode(): boolean {
  const value = process.env.HEADED?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

type CsvRow = Record<string, string | undefined>;

async function main(): Promise<void> {
  const csvPath = await downloadCsv();
  const { rows, dateColumn, costColumn, modelColumn } = await readUsageRows(csvPath);
  const modelNote = modelColumn ? `, model="${modelColumn}"` : "";
  console.log(`Using CSV columns: date="${dateColumn}", spend="${costColumn}" (USD)${modelNote}\n`);
  printCosts(rows, Boolean(modelColumn));
}

async function launchBrowser(): Promise<BrowserContext> {
  await mkdir(DOWNLOADS_DIR, { recursive: true });
  await mkdir(PROFILE_DIR, { recursive: true });

  const options = {
    acceptDownloads: true,
    downloadsPath: DOWNLOADS_DIR,
    headless: !isHeadedMode(),
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

async function downloadCsv(): Promise<string> {
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

    const downloadButton = await findDownloadButton(page);
    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
    await downloadButton.click();

    const download = await downloadPromise;
    const filePath = path.join(DOWNLOADS_DIR, `cursor-usage-${formatLocalTimestampForFilename(new Date())}.csv`);
    await download.saveAs(filePath);
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

async function findDownloadButton(page: Page): Promise<Locator> {
  const candidates = [
    page.getByRole("button", { name: /csv|download|export/i }),
    page.getByRole("link", { name: /csv|download|export/i }),
    page.locator('a[href*="csv" i]'),
    page.locator('button:has-text("CSV")'),
  ];

  for (const locator of candidates) {
    const first = locator.first();
    if ((await first.count()) > 0) {
      return first;
    }
  }

  throw new Error("Could not find a control to download the CSV.");
}

type UsageRow = { date: Date; cost: number; model: string };

async function readUsageRows(
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

function printCosts(rows: UsageRow[], hasModelColumn: boolean): void {
  const today = new Date();
  const { byDay, models } = aggregateByDayAndModel(rows, hasModelColumn);

  const dailyOutput: Record<string, string>[] = [];
  const weeklyOutput: Record<string, string>[] = [];
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

    const dayRow: Record<string, string> = { Day: dayKey, Total: money(dayTotal) };
    if (hasModelColumn && models.length > 0) {
      for (const model of models) {
        const part = dayMap.get(model) ?? 0;
        dayRow[model] = money(part);
        monthlyByModel.set(model, (monthlyByModel.get(model) ?? 0) + part);
      }
    }
    dailyOutput.push(dayRow);

    if (hasModelColumn && models.length > 0) {
      for (const model of models) {
        const part = dayMap.get(model) ?? 0;
        weekModelSpend.set(model, (weekModelSpend.get(model) ?? 0) + part);
      }
    }

    const isSunday = day.getDay() === 0;
    const isToday = dayKey === toDateKey(today);
    if (isSunday || isToday) {
      const weekRow: Record<string, string> = {
        Week: `${toDateKey(maxDate(weekStart, firstDayOfCurrentMonth()))} to ${dayKey}`,
        Total: money(weekTotalSpend),
      };
      if (hasModelColumn && models.length > 0) {
        for (const model of models) {
          weekRow[model] = money(weekModelSpend.get(model) ?? 0);
        }
      }
      weeklyOutput.push(weekRow);

      weekStart = addDays(day, 1);
      weekTotalSpend = 0;
      for (const model of models) {
        weekModelSpend.set(model, 0);
      }
    }
  }

  console.log("\nSpend per day");
  console.table(dailyOutput);

  console.log("\nSpend by week (Monday–Sunday)");
  console.table(weeklyOutput);

  if (hasModelColumn && models.length > 0) {
    const monthRow: Record<string, string> = { Total: money(monthlyTotal) };
    for (const model of models) {
      monthRow[model] = money(monthlyByModel.get(model) ?? 0);
    }
    console.log("\nMonth-to-date by model");
    console.table([monthRow]);
  }
  console.log("");
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

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
