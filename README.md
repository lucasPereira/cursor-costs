# Cursor Usage

A small Node.js app that uses Playwright to open the Cursor usage dashboard, download the current month’s CSV to `downloads/cursor-usage-<local-timestamp>.csv` (wall-clock time in the machine’s local timezone), compute costs, and print:

- spend per day;
- spend per week (weeks start on Monday);
- month-to-date total spend.

Before exporting the CSV, the script selects **Month-to-date** on the dashboard: it clicks the **MTD** segmented control (`aria-label="Month-to-date"`) when present, then falls back to other date-range UI if needed. The page often defaults to a short window (e.g. last 7 days) until MTD is selected.

Usage timestamps in the CSV are UTC (from Cursor). **Day/week buckets and printed dates** use your **system local timezone** (same calendar as `Date` getters `getFullYear` / `getMonth` / `getDate`).

## Run

```sh
npm install
```

**Headless (default)** — no browser window:

```sh
npm run headless
```

**Headed** — visible browser (use this for first-time sign-in, then press Enter in the terminal when the usage page is ready). Session is stored under `.playwright/cursor-profile` and is reused by headless runs.

```sh
npm run headed
```

The app prefers **Google Chrome** (`channel: "chrome"`) over Playwright’s bundled Chromium, which often gets past basic bot checks. It also sets a small init script and disables the `AutomationControlled` blink feature. If Chrome is not installed, it falls back to Chromium.

The `downloads/` folder is gitignored.
