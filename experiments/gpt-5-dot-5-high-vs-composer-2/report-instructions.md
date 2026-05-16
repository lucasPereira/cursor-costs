# Report instructions

## Purpose

Use these instructions when asking an agent to generate `artifacts/final-report.md`. The report must be based only on persisted artifacts in `artifacts/` and the MessengerX submodules.

## Required inputs

Read these files before writing the report:

- `experiment.md`
- `artifacts/runs.manifest.json`
- `artifacts/cursor-usage.csv`
- `artifacts/analysis-results.json`
- `artifacts/human-observations.md`
- `artifacts/agent-observations.md`

## Report structure

The report must follow this section order. Within each section, keep the listed items as explicit subsections so the operator can extend them later without breaking the outline.

### Introduction

Sets the context for the rest of the report. Must include:

- Context: the migration of Firebase Cloud Functions from v1 to v2 in the MessengerX project.
- Goals of the experiment: comparing `gpt-5.5-high` and `composer-2` on cost, efficiency, and qualitative outcomes when performing the same migrations.
- Roadmap: a short paragraph explaining what each following section covers (Methodology, Results, Analysis, Conclusion).

### Methodology

Describes the experiment design and how it was executed. Must include:

- Paired design with alternating model order across functions to reduce carryover bias.
- The steps necesary to execute the experiment: start the pair, finish the the first migration, finish the second migration, select the result, register the observations, download the usage data, analyze the results, and update the final report.
- Each migration runs in a fresh session/window per model.
- The same start prompt is used for both models.
- Agent-written qualitative analyses use the `claude-opus-4-7-thinking-medium` model, not `composer-2` or `gpt-5.5-high`, so the reviewer is independent of the models under test and the qualitative reading is not biased toward either one.

### Results

Presents the raw outputs of the experiment without interpretation. Must include:

- The collected metrics tables sourced from `artifacts/analysis-results.json` (paired differences, global aggregates, selection breakdown).
- The generated charts under `artifacts/charts/`, embedded or linked in the order they appear there.

### Analysis

Interprets the results combining quantitative data with the human and agent observations. Use these subsections, in order:

- Unpaired metrics analysis: discusses the global per-model aggregates and what they suggest at the operational level.
- Statistical tests on paired samples: reports the Wilcoxon signed-rank results for the paired differences and states whether there is a statistically meaningful gap between the two models, including effect sizes and confidence intervals when available.
- Threats to validity: lists confounders such as small sample size, carryover bias, function difficulty imbalance, environment differences, and any incomplete or failed pairs.
- Qualitative assessment: synthesizes the entries in `artifacts/human-observations.md` and `artifacts/agent-observations.md` into themes (approach differences, completeness, recurring failure modes).

### Conclusion

States whether either model performed better overall and summarizes the main findings from the previous sections in a few short paragraphs.
