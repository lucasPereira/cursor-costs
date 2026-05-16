# Report instructions

## Purpose

Use these instructions when asking an agent to generate `final-report.md`. The report must be based only on persisted artifacts in this folder and the MessengerX submodules.

## Required inputs

Read these files before writing the report:

- `experiment.md`
- `runs.manifest.json`
- `cursor-usage.csv`
- `analysis-results.json`
- `human-observations.md`
- `agent-observations.md`

## Report structure

The report should include:

- Executive summary with the main cost-benefit conclusion.
- Paired comparison by function, using paired differences as the primary evidence.
- Global model summary, using aggregate metrics as operational context.
- Selection breakdown, including `both` and `neither` decisions.
- Qualitative findings based on human and agent observations.
- Limitations, including carryover bias and any incomplete or failed pairs.

## Interpretation rules

Treat statistical tests as evidence, not proof. Prefer paired differences, effect sizes, confidence intervals, and visible distributions over isolated p-values.
