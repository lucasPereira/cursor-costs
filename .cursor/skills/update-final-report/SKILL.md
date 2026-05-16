---
name: update-final-report
description: Refreshes experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/final-report.md using the latest manifest, analysis, observations, and charts after the user runs npm run experiment:analyze. Preserves any sections that are still accurate, updates the ones that changed, asks the user to approve the diff, and only then creates a git commit naming the function or functions that were migrated since the previous report update. Use whenever the user invokes update-final-report, asks to "update the final report", "regenerate the report", "refresh final-report.md", or pairs the request with a recent experiment:analyze run.
---

# update-final-report

## When to run

Invoke this skill after `npm run experiment:analyze` has produced a fresh `artifacts/analysis-results.json` and updated SVGs under `artifacts/charts/`. The skill assumes the manifest is up to date and at least one new pair has a `selectedDecision`. If no pair has been added or closed since the last report commit, stop and tell the user.

## Inputs

Read these files before editing the report. Treat them as the only source of truth.

- `experiments/gpt-5-dot-5-high-vs-composer-2/experiment.md`
- `experiments/gpt-5-dot-5-high-vs-composer-2/report-instructions.md`
- `experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/runs.manifest.json`
- `experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/analysis-results.json`
- `experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/human-observations.md`
- `experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/agent-observations.md`
- `experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/final-report.md` (current version, to be updated in place)

The report structure is dictated by `report-instructions.md` (Introduction, Methodology, Results, Analysis with its four subsections, Conclusion). Follow that outline; do not add or remove top-level sections.

## Workflow

1. Identify what changed since the last report commit:
   - Run `git log -1 --format=%H -- experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/final-report.md` to get the last commit that touched the report (or `HEAD` if there is none yet).
   - Run `git diff --name-only <thatCommit>..HEAD -- experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/` to see which artifact files changed.
   - From the manifest, list the pairs whose `selectedAt` is later than the timestamp of that commit. Those are the new migrations to highlight.
2. Edit `artifacts/final-report.md` in place:
   - Preserve any paragraph or subsection that is still accurate. Do not rewrite prose just because numbers nearby changed.
   - Update numeric values, tables, and chart references from the fresh `analysis-results.json` and `charts/` directory.
   - Extend the qualitative subsections with any new entries in the observation files; keep the existing analysis text unless an entry directly contradicts it.
   - Keep section headings and placeholder subsections from `report-instructions.md` in place even when empty.
3. Show the user the proposed change set:
   - Print the names of the new migrated functions (one line each).
   - Print the diff of `artifacts/final-report.md` (e.g. `git diff -- artifacts/final-report.md`).
   - Ask for explicit approval before committing. Do not stage or commit anything without a "yes" from the user.
4. On approval, stage and commit:
   - Stage `artifacts/final-report.md` plus any other artifacts that changed in step 1 (`analysis-results.json`, `charts/`, observation files, `cursor-usage.csv`). Do not stage anything outside `artifacts/`.
   - Use the commit message template in [Commit message](#commit-message) below.
   - Do not push. Stop after the local commit and report the resulting commit hash.

## Commit message

Write the commit message in English. The subject line names the migrated functions; the body lists the same names with their `selectedDecision`. Keep the subject under 72 characters.

Single function:

```
report: update final report for <functionName>
```

Multiple functions, two or three names fit in the subject:

```
report: update final report for <fnA>, <fnB>, <fnC>
```

More than three functions:

```
report: update final report for <count> migrated functions
```

Body, always:

```
Selections since previous report:
- <fnA>: <selectedDecision>
- <fnB>: <selectedDecision>
...
```

## Constraints

- Never edit files outside `experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/` during this skill, except reading the static specs at the experiment root.
- Never run `experiment:analyze` or `experiment:download-csv` from this skill; the user is responsible for those. If `artifacts/analysis-results.json` is older than the manifest's most recent `selectedAt`, stop and ask the user to re-run analyze first.
- Never push to remote.
- Never amend a prior commit. If the user finds something wrong after approval, create a new commit on the next invocation.
- Treat statistical results the same way `report-instructions.md` does: prefer paired differences, effect sizes, and bootstrap CIs over isolated p-values, and call out when `comparedPairs` is too small to draw conclusions.
- After the commit succeeds, end your message with a single line: `Next step: npm run experiment:migrate-start -- --function <name>` so the operator knows the pipeline is back at the start of the next pair.
