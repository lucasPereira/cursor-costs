# GPT-5.5 High vs Composer 2 experiment

## Purpose

This experiment compares `gpt-5.5-high` and `composer-2` while migrating Firebase Cloud Functions from v1 to v2. Each function is migrated twice, once with each model, so the comparison can use paired per-function differences.

## Workflow

For every function, create one run for `composer-2` and one run for `gpt-5.5-high`. Each run gets its own branch using `chore/migrate-<function-name>/<model>`, its own `runId`, and a shared `pairId` for the function.

The operator workflow uses two commands per pair: `experiment:migrate-start` to begin and `experiment:migrate-finish` after each of the two migrations (the same command handles both, inferring first or second from the manifest's in-progress run). Each command appends to or updates `artifacts/runs.manifest.json` (creating the pair, registering each run, and writing `status`, `endedAt`, and the resolved `commit`) alongside the corresponding Git operations in the submodule. See `commands.md` for the full pipeline.

After both migrations finish, record the selected result for the pair with `npm run experiment:select -- --decision <composer-2|gpt-5.5-high|both|neither>`. This command also writes back into `artifacts/runs.manifest.json`, setting `selectedDecision`, `selectedAt`, and `selectedRunIds` on the latest open pair, so you do not pass a `pairId`. Alternate which model runs first across functions to reduce carryover bias.

Around the same time, invoke the `register-observations` skill and pass your own free-text notes in the message. The skill targets the latest pair, appends your text to `artifacts/human-observations.md`, and asks the agent to append its own pair-level reading of the two branches to `artifacts/agent-observations.md`.

After each pair, or at the end of the experiment, refresh the usage data and rebuild the analysis with `npm run experiment:download-csv` followed by `npm run experiment:analyze`. The first command pulls the latest Cursor usage CSV into `artifacts/cursor-usage.csv`. The second command always regenerates `artifacts/analysis-results.json` and every SVG under `artifacts/charts/` from scratch, overwriting whatever was there before; it does not patch the previous results. Both commands are idempotent given the same inputs.

Once the analysis is fresh, invoke the `update-final-report` skill to refresh `artifacts/final-report.md` against the new artifacts. The skill preserves text that is still correct, shows the diff plus the list of newly migrated functions, and only commits after you approve.

## Folder layout

The experiment folder separates static specs from artifacts that the commands and the skill keep rewriting.

- Static specs at the root: `experiment.md`, `commands.md`, `report-instructions.md`. These are written by hand and only change when the experiment design changes.
- Live artifacts in `artifacts/`: `runs.manifest.json`, `cursor-usage.csv`, `human-observations.md`, `agent-observations.md`, `analysis-results.json`, `final-report.md`, and `charts/`. These are produced or appended by `npm run experiment:*` and by the `register-observations` and `update-final-report` skills.
- Subject code at the root: `messengerx-workspace/` is a Git submodule, not an artifact; the commands check out branches there but never write files outside Git's normal flow.

## Data sources

The analysis reads `artifacts/runs.manifest.json`, `artifacts/cursor-usage.csv`, the MessengerX submodules, and the observation files in `artifacts/`. The CSV is treated as raw usage data, while the manifest links CSV rows to migration runs through model and timestamp windows.

## Report metrics

The report should separate paired metrics from global metrics. Paired metrics are the main fairness comparison; global metrics provide operational context across all runs.
