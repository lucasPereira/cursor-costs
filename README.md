# Cursor Usage

Two things in one repo: **generate a monthly usage report** from the Cursor dashboard and **monitor costs** so you get notified when today’s spend crosses a limit you set. Both use the same Playwright download path. CSV rows are stamped in UTC; the report groups by your machine’s local calendar day.

## Setup

Run `npm install` once after cloning.

## Generate monthly report

### Headed — `npm run headed`

Opens a visible browser. If the script sees a sign-in link, finish logging in **in the browser**, then press **Enter** in the terminal when the prompt tells you to. Only that step is manual. After that, it reloads the usage page, hits **MTD**, downloads the CSV to `downloads/cursor-usage-<local-timestamp>.csv`, and prints the tables. If you’re already logged in, it skips the prompt and just continues.

### Headless — `npm run headless`

No visible browser. Same flow as headed after you’re already logged in: **MTD**, download, print. Your session is kept in `.playwright/cursor-profile` until it stops working.

## Monitor costs — `npm run monitor`

Copy `.env.example` to `.env` and follow the comments in that file for each variable. On each run it downloads the CSV the same way as the report scripts, sums **today’s spend in USD** from local midnight, and notifies you the first time it goes over your threshold until it drops back under. Desktop notification always; email only if you configure the optional Gmail variables there.

On **macOS**, desktop alerts use Apple’s `display notification` (via `osascript`) so they show up like other system notifications and remain available in Notification Center. If you still do not see them there, open **System Settings → Notifications**, find **Script Editor** or **osascript** (whichever appears for these alerts), and ensure notifications are allowed and **Show in Notification Center** is on.
