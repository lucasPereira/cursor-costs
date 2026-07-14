import "dotenv/config";
import { execFile } from "node:child_process";
import os from "node:os";
import nodemailer from "nodemailer";
import notifier from "node-notifier";

import {
  checkSpendLogLine,
  envMonitorIntervalMinutesInvalid,
  envMonitorIntervalMinutesMissing,
  envSpendThresholdInvalid,
  envSpendThresholdMissing,
  fatalErrorMessage,
  limitExceededBody,
  limitExceededTitle,
  logCheckFailed,
  logDesktopNotificationFailed,
  logEmailNotificationFailed,
  routineUsageDesktopBody,
  routineUsageDesktopTitle,
  startupBannerLine,
} from "./monitorMessages.js";
import {
  downloadCsv,
  parseCountIncludedEnv,
  parseHeadedEnv,
  readUsageRows,
  sumTodaySpendUsd,
} from "./usageWorker.js";

function intervalMs(): number {
  const raw = process.env.MONITOR_INTERVAL_MINUTES?.trim();
  if (raw === undefined || raw === "") {
    throw new Error(envMonitorIntervalMinutesMissing());
  }
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(envMonitorIntervalMinutesInvalid());
  }
  return minutes * 60 * 1000;
}

function thresholdUsd(): number {
  const raw = process.env.SPEND_THRESHOLD_USD?.trim();
  if (raw === undefined || raw === "") {
    throw new Error(envSpendThresholdMissing());
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(envSpendThresholdInvalid());
  }
  return value;
}

/** AppleScript string literal (double-quoted). */
function appleScriptQuotedSegment(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** macOS `display notification` body: one line (newlines → space), no extra separators. */
function darwinNotificationSingleLineBody(message: string): string {
  return message.replace(/\r?\n+/g, " ").trim();
}

type DesktopNotifyTone = "routine" | "limitExceeded";

const DARWIN_SOUND_ROUTINE = "Purr";
const DARWIN_SOUND_LIMIT_EXCEEDED = "Glass";

type DesktopNotifyOptions = {
  subtitle?: string;
  tone?: DesktopNotifyTone;
};

/** macOS: `osascript` + `display notification` integrates with Notification Center better than `node-notifier`’s bundled `terminal-notifier`. */
function notifyDesktopDarwin(title: string, message: string, options: DesktopNotifyOptions | undefined): void {
  const tone = options?.tone ?? "routine";
  const soundName = tone === "limitExceeded" ? DARWIN_SOUND_LIMIT_EXCEEDED : DARWIN_SOUND_ROUTINE;
  const titleOneLine = title.split(/\r?\n/)[0] ?? title;
  const body = darwinNotificationSingleLineBody(message);
  let source = `display notification ${appleScriptQuotedSegment(body)} with title ${appleScriptQuotedSegment(titleOneLine)}`;
  const sub = options?.subtitle?.trim();
  if (sub) {
    source += ` subtitle ${appleScriptQuotedSegment(darwinNotificationSingleLineBody(sub))}`;
  }
  source += ` sound name ${appleScriptQuotedSegment(soundName)}`;

  execFile("/usr/bin/osascript", ["-e", source], (error) => {
    if (error) {
      console.error(logDesktopNotificationFailed(error.message));
    }
  });
}

function notifyDesktop(title: string, message: string, options?: DesktopNotifyOptions): void {
  if (os.platform() === "darwin") {
    notifyDesktopDarwin(title, message, options);
    return;
  }
  const sub = options?.subtitle?.trim();
  notifier.notify(
    sub
      ? { title, message, subtitle: sub, sound: true, timeout: false }
      : { title, message, sound: true, timeout: false },
  );
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

function formatLocalTimeHHMM(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function sameSpendCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

let previousWasOver: boolean | undefined = undefined;
let previousTodaySpend: number | undefined = undefined;

async function runCheck(): Promise<void> {
  const threshold = thresholdUsd();
  let todaySpend: number | null = null;

  try {
    const csvPath = await downloadCsv({ countIncluded: parseCountIncludedEnv() });
    const { rows } = await readUsageRows(csvPath);
    const spend = sumTodaySpendUsd(rows);
    todaySpend = spend;
    const now = new Date();
    const timeLabel = formatLocalTimeHHMM(now);

    console.log(checkSpendLogLine(timeLabel, spend));

    const nowOver = spend > threshold;
    /** First time above limit this “cycle”, or first read already above: routine is suppressed this check only. */
    const crossedAbove = nowOver && previousWasOver !== true;

    if (crossedAbove) {
      const title = limitExceededTitle();
      const message = limitExceededBody(spend);

      try {
        notifyDesktop(title, message, { tone: "limitExceeded" });
      } catch (error) {
        console.error(
          logDesktopNotificationFailed(error instanceof Error ? error.message : String(error)),
        );
      }

      try {
        await notifyEmailIfConfigured(title, `${message}`);
      } catch (error) {
        console.error(logEmailNotificationFailed(error instanceof Error ? error.message : String(error)));
      }
    }

    const spendChanged =
      previousTodaySpend !== undefined && !sameSpendCents(spend, previousTodaySpend);
    const isFirstSuccessfulRead = previousTodaySpend === undefined;

    if (!crossedAbove && (isFirstSuccessfulRead || spendChanged)) {
      const message = routineUsageDesktopBody(spend);
      try {
        notifyDesktop(routineUsageDesktopTitle(), message);
      } catch (error) {
        console.error(
          logDesktopNotificationFailed(error instanceof Error ? error.message : String(error)),
        );
      }
    }
  } finally {
    if (todaySpend !== null) {
      previousTodaySpend = todaySpend;
      previousWasOver = todaySpend > threshold;
    }
  }
}

async function main(): Promise<void> {
  parseHeadedEnv();
  const limit = thresholdUsd();
  const every = intervalMs();
  console.log(startupBannerLine(every / 60_000, limit));
  console.log();

  const loop = async (): Promise<void> => {
    try {
      await runCheck();
    } catch (error) {
      console.error(logCheckFailed(fatalErrorMessage(error)));
    }
    setTimeout(loop, every);
  };

  void loop();
}

main().catch((error: unknown) => {
  console.error(fatalErrorMessage(error));
  process.exitCode = 1;
});
