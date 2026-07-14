# Cursor Usage

Two things in one repo: **generate a monthly usage report** from the Cursor dashboard and **monitor costs** so you get notified when today’s spend crosses a limit you set. Both use Playwright to open the usage page and call the dashboard usage API (not the Download CSV button). CSV rows are stamped in UTC; the report groups by your machine’s local calendar day. Required env vars (including `COUNT_INCLUDED`) live in `.env`; use a `*:count-included` script to override `COUNT_INCLUDED=1` for that run.

## Setup

Run `npm install` once after cloning.

## Generate monthly report

### Headed — `npm run headed`

Opens a visible browser. If the script sees a sign-in link, finish logging in **in the browser**, then press **Enter** in the terminal when the prompt tells you to. Only that step is manual. After that, it fetches month-to-date usage via the API, writes `downloads/cursor-usage-<local-timestamp>.csv`, and prints the tables. If you’re already logged in, it skips the prompt and just continues. Use `npm run headed:count-included` to include Included-row notional costs.

### Headless — `npm run headless`

No visible browser. Same flow as headed after you’re already logged in: API fetch, write CSV, print. Your session is kept in `.playwright/cursor-profile` until it stops working. Use `npm run headless:count-included` to include Included-row notional costs.

## Monitor costs — `npm run monitor`

Copy `.env.example` to `.env` and set every required variable there (no code defaults). On each run it fetches usage the same way as the report scripts, sums **today’s spend in USD** from local midnight, and notifies you the first time it goes over your threshold until it drops back under. Desktop notification always; email only if you configure the optional Gmail variables there. Use `npm run monitor:count-included` to override `COUNT_INCLUDED=1` for that run.

On **macOS**, desktop alerts use Apple’s `display notification` (via `osascript`) so they show up like other system notifications and remain available in Notification Center. If you still do not see them there, open **System Settings → Notifications**, find **Script Editor** or **osascript** (whichever appears for these alerts), and ensure notifications are allowed and **Show in Notification Center** is on.
