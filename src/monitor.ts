import "dotenv/config";
import { execFile } from "node:child_process";
import os from "node:os";
import nodemailer from "nodemailer";
import notifier from "node-notifier";

import { downloadCsv, parseHeadedEnv, readUsageRows, sumTodaySpendUsd } from "./usageWorker.js";

function intervalMs(): number {
  const raw = process.env.MONITOR_INTERVAL_MINUTES?.trim();
  if (raw === undefined || raw === "") {
    throw new Error(
      "Define MONITOR_INTERVAL_MINUTES in your .env file (positive number: minutes between each check).",
    );
  }
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error("MONITOR_INTERVAL_MINUTES must be a positive number.");
  }
  return minutes * 60 * 1000;
}

function thresholdUsd(): number {
  const raw = process.env.SPEND_THRESHOLD_USD?.trim();
  if (raw === undefined || raw === "") {
    throw new Error("Define SPEND_THRESHOLD_USD in your .env file (positive USD amount for the alert).");
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("SPEND_THRESHOLD_USD must be a positive number.");
  }
  return value;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

/** AppleScript string literal (double-quoted). */
function appleScriptQuotedSegment(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** macOS `display notification` body: one line (newlines → space), no extra separators. */
function darwinNotificationSingleLineBody(message: string): string {
  return message.replace(/\r?\n+/g, " ").trim();
}

/** macOS: `osascript` + `display notification` integrates with Notification Center better than `node-notifier`’s bundled `terminal-notifier`. */
function notifyDesktopDarwin(title: string, message: string): void {
  const titleOneLine = title.split(/\r?\n/)[0] ?? title;
  const body = darwinNotificationSingleLineBody(message);
  const source = `display notification ${appleScriptQuotedSegment(body)} with title ${appleScriptQuotedSegment(titleOneLine)}`;

  execFile("/usr/bin/osascript", ["-e", source], (error) => {
    if (error) {
      console.error("Desktop notification failed:", error.message);
    }
  });
}

function notifyDesktop(title: string, message: string): void {
  if (os.platform() === "darwin") {
    notifyDesktopDarwin(title, message);
    return;
  }
  notifier.notify({ title, message, timeout: false });
}

async function notifyEmailIfConfigured(subject: string, text: string): Promise<void> {
  const user = process.env.GMAIL_USER?.trim();
  const pass = process.env.GMAIL_APP_PASSWORD?.trim();
  const to = process.env.NOTIFY_EMAIL_TO?.trim();

  if (!user || !pass || !to) {
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: user,
    to,
    subject,
    text,
  });
}

let armed = true;

async function runCheck(): Promise<void> {
  const threshold = thresholdUsd();
  const csvPath = await downloadCsv();
  const { rows } = await readUsageRows(csvPath);
  const todaySpend = sumTodaySpendUsd(rows);
  const stamp = new Date().toISOString();

  console.log(`${stamp}  today (local) spend: ${formatMoney(todaySpend)}  threshold: ${formatMoney(threshold)}`);

  if (todaySpend > threshold) {
    if (!armed) {
      return;
    }
    armed = false;

    const overBy = todaySpend - threshold;
    const dayLabel = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date());
    const title = "Cursor daily spend limit exceeded";
    const message =
      `You have exceeded the daily spend limit you set for Cursor usage.` +
      `\n\n` +
      `Spent: ${formatMoney(todaySpend)}.\n` +
      `Over limit: ${formatMoney(overBy)}.`;

    try {
      notifyDesktop(title, message);
    } catch (error) {
      console.error("Desktop notification failed:", error instanceof Error ? error.message : error);
    }

    try {
      await notifyEmailIfConfigured(title, `${message}`);
    } catch (error) {
      console.error("Email notification failed:", error instanceof Error ? error.message : error);
    }
  } else {
    armed = true;
  }
}

async function main(): Promise<void> {
  const headed = parseHeadedEnv();
  const limit = thresholdUsd();
  const every = intervalMs();
  const emailOn =
    Boolean(process.env.GMAIL_USER?.trim()) &&
    Boolean(process.env.GMAIL_APP_PASSWORD?.trim()) &&
    Boolean(process.env.NOTIFY_EMAIL_TO?.trim());
  console.log(
    `Browser: ${headed ? "headed" : "headless"}. Monitoring every ${every / 60_000} min. Alert if today's spend (local midnight onward) exceeds ${formatMoney(limit)}. Email: ${emailOn ? "on" : "off"}.`,
  );

  const loop = async (): Promise<void> => {
    try {
      await runCheck();
    } catch (error) {
      console.error("Check failed:", error instanceof Error ? error.message : error);
    }
    setTimeout(loop, every);
  };

  void loop();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
