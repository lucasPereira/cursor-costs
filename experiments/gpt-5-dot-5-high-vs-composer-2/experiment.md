# GPT-5.5 High vs Composer 2 experiment

## Purpose

This experiment compares `gpt-5.5-high` and `composer-2` while migrating Firebase Cloud Functions from v1 to v2. Each function is migrated twice, once with each model, so the comparison can use paired per-function differences.

## Workflow

For every function, create one run for `composer-2` and one run for `gpt-5.5-high`. Each run gets its own branch using `chore/migrate-<function-name>/<model>`, its own `runId`, and a shared `pairId` for the function.

After both migrations finish, record the selected result for the pair as `composer-2`, `gpt-5.5-high`, `both`, or `neither`. Alternate which model runs first across functions to reduce carryover bias.

## Data sources

The analysis reads `runs.manifest.json`, `cursor-usage.csv`, the MessengerX submodules, and the observation files in this folder. The CSV is treated as raw usage data, while the manifest links CSV rows to migration runs through model and timestamp windows.

## Report metrics

The report should separate paired metrics from global metrics. Paired metrics are the main fairness comparison; global metrics provide operational context across all runs.
