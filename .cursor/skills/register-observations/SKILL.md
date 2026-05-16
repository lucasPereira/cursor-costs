---
name: register-observations
description: Records observations for the most recent function pair in the gpt-5.5-high vs composer-2 experiment. The user provides their own free-form notes; the agent generates a separate technical reading from the two migration branches. The skill appends one entry to experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/human-observations.md and one entry to experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/agent-observations.md. Use whenever the user invokes register-observations, asks to "register observations", "log observations for this pair", "save my notes for the migration", or passes notes alongside experiment:select for that experiment.
---

# register-observations

## When to run

Run this skill when the user invokes it by name and passes their own observations as free text. The skill always targets the latest pair in `experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/runs.manifest.json`; never ask for a `pairId`. The user can invoke it after the second `npm run experiment:migrate-finish` of the pair (before `experiment:select`) or after `npm run experiment:select`. Both branches of the pair must be finalized (status `succeeded` or `failed`); abort with a clear message otherwise.

## Inputs

- The user's free-text observations passed in the invocation message. Treat this text verbatim, do not rewrite or summarize it.
- `experiments/gpt-5-dot-5-high-vs-composer-2/artifacts/runs.manifest.json` for the pair, its two runs, branches, statuses, and (when set) `selectedDecision`.
- The MessengerX submodule diffs for both branches. Resolve the path from the manifest: `subjectWorkspace.path` joined with `subjectWorkspace.repositories[<targetRepo>].path`.

## Workflow

1. Load the manifest and pick the latest pair, defined as the pair with the highest numeric suffix in `pairId`. Validate that it has exactly two runs, one per model, both finalized. Abort if not.
2. Collect the diffs for each run against its `baseBranch`, running inside the submodule path:
   - `git -C <submodulePath> diff --stat refs/heads/<baseBranch>...refs/heads/<branch>`
   - `git -C <submodulePath> diff refs/heads/<baseBranch>...refs/heads/<branch>`
3. Append one entry to `artifacts/human-observations.md` using the template in that file, populated from the user's text and the per-run fields from the manifest. If the user wrote a single block of notes covering both runs, duplicate the block under each run's entry rather than splitting their words.
4. Append one entry to `artifacts/agent-observations.md` using the template in that file. The content must come from your reading of the diffs and from cross-referencing the user's notes you just wrote. Do not assign numeric scores, rankings, or grades.
5. Before writing, search both files for the current `pairId`. If an entry already exists, stop and tell the user; do not overwrite or append a duplicate.
6. After writing both entries, end your message with a single line: `Next step: npm run experiment:download-csv` (or, if the user prefers to wait until the end of the experiment to analyze, mention that the download/analyze pair can be deferred).

## What to write in artifacts/agent-observations.md

Focus on what the diffs and observations show, not on guesses about model internals.

- Approach differences: contrast how each model structured the migration (file layout, helper extraction, naming, reuse of existing utilities, handling of triggers and exports).
- Completeness and risks: call out anything that looks unfinished or risky, such as handlers added without wiring, missing error handling, missing tests, untouched callers, or behavioral changes beyond the v1 to v2 migration.
- Cross-reference with human notes: quote or paraphrase the user's text where it confirms or contradicts your reading of the diffs. Write "None." if the user did not provide notes for the pair.

## Constraints

- One entry per pair per file. Never overwrite or duplicate.
- Do not infer cost, tokens, or runtime from the diffs; those come from the CSV-driven analysis in `artifacts/analysis-results.json`.
- Do not draw cross-pair conclusions; that belongs in `artifacts/final-report.md`.
- Use the exact field names from each template so the files stay machine-readable.
- Use the timestamp `pair.selectedAt` when present, otherwise the current local time, truncated to the minute, in both entry headings.
