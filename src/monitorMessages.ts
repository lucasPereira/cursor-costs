export function limitExceededTitle(): string {
  return "Cursor daily spend limit exceeded";
}

export function limitExceededBody(spendUsd: number, overLimitUsd: number): string {
  return (
    `${formatUsd(spendUsd)}`
  );
}

export function routineUsageDesktopTitle(): string {
  return "Cursor usage";
}

export function routineUsageDesktopBody(currentSpendUsd: number, previousSpendUsd: number): string {
  return (
    `${formatUsd(currentSpendUsd)}`
  );
}

export function startupBannerLine(intervalMinutes: number, thresholdUsd: number): string {
  return `Every ${intervalMinutes} minutes · ${formatUsd(thresholdUsd)} threshold`;
}

export function checkSpendLogLine(timeHHMM: string, spendUsd: number): string {
  return `${timeHHMM} · ${formatUsd(spendUsd)}`;
}

export function envMonitorIntervalMinutesMissing(): string {
  return "Define MONITOR_INTERVAL_MINUTES in your .env file (positive number: minutes between each check).";
}

export function envMonitorIntervalMinutesInvalid(): string {
  return "MONITOR_INTERVAL_MINUTES must be a positive number.";
}

export function envSpendThresholdMissing(): string {
  return "Define SPEND_THRESHOLD_USD in your .env file (positive USD amount for the alert).";
}

export function envSpendThresholdInvalid(): string {
  return "SPEND_THRESHOLD_USD must be a positive number.";
}

export function logDesktopNotificationFailed(detail: string): string {
  return `Desktop notification failed: ${detail}`;
}

export function logEmailNotificationFailed(detail: string): string {
  return `Email notification failed: ${detail}`;
}

export function logCheckFailed(detail: string): string {
  return `Check failed: ${detail}`;
}

export function fatalErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}
