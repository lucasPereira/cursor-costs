# Experiment pipeline commands

This file documents the operator workflow for a single function pair, from branch creation to selection. The `migrate-*` commands wrap manifest updates, Git checkouts, commits, and branch creation in the right order so you do not have to remember submodule paths, branch names, or `runId`/`pairId` values. Each command validates pre-conditions and aborts with a clear message instead of leaving the workspace in a half-applied state. Every command also prints a `Next step:` line at the end of its output telling you what to run next, so you can follow the pipeline without consulting this file. Each block below states which `Next step:` that command prints.

--

One time setup. Initialize the MessengerX submodules and check out the expected base branches before the first pair. Prints `Next step: npm run experiment:migrate-start -- --function <name>`.

```bash
npm run experiment:bootstrap-submodules
```

--

Start the pair. The command verifies the target submodule is on its base branch (`dev` for `messengerx_backend`, `develop` for `messengerx_firebase`) with a clean working tree, fast-forwards from origin, picks the model from the manifest's `nextFirstModel` field (initial value `composer-2`, flipped by each `experiment:select`), registers a new run, prints which model will run, and creates the model-specific branch. Prints `Next step: npm run experiment:migrate-finish -- --status <succeeded|failed>` to run after the migration is done.

```bash
npm run experiment:migrate-start -- --function sendMessage
```

--

Run the migration with the model the previous command picked. When you finish, notify the CLI. The same `migrate-finish` command handles both runs of the pair: it inspects the manifest to see whether this is the first or the second in-progress run. In both cases it stages all changes in the submodule, commits with `chore: migrate <function> to v2 with <model>`, and marks the run as `succeeded` or `failed`. If it is the first run, it then returns the submodule to its base branch, fast-forwards, creates the branch for the second model, registers the matching run, and prints `Next step: npm run experiment:migrate-finish -- --status <succeeded|failed>` again for the second migration. If it is the second run, it returns to the base branch and prints `Next step: npm run experiment:select -- --decision <composer-2|gpt-5.5-high|both|neither>`.

```bash
npm run experiment:migrate-finish -- --status succeeded
```

--

Record the selection decision for the latest open pair. Run exactly one of these. The command always targets the most recent pair without a `selectedDecision` and flips `nextFirstModel` in the manifest so the next `migrate-start` alternates which model goes first. Prints `Next step: invoke the register-observations skill to log notes for this pair`.

```bash
npm run experiment:select -- --decision composer-2
npm run experiment:select -- --decision gpt-5.5-high
npm run experiment:select -- --decision both
npm run experiment:select -- --decision neither
```

--

Ask the agent to log observations for the pair by invoking the `register-observations` skill (defined in `.cursor/skills/register-observations/`). Pass your free-text notes in the same message; the skill always targets the latest pair, so you do not pass a `pairId`. It appends one entry to `artifacts/human-observations.md` with your text and one entry to `artifacts/agent-observations.md` with the agent's reading of both branch diffs. Do this once per pair, around `experiment:select`. The skill ends its reply with `Next step: npm run experiment:download-csv`.

--

Refresh the usage CSV and regenerate analysis results and charts. This can be done after every pair or only at the end of the experiment, since both steps are idempotent. `experiment:download-csv` prints `Next step: npm run experiment:analyze`; `experiment:analyze` prints `Next step: invoke the update-final-report skill to refresh artifacts/final-report.md`.

```bash
npm run experiment:download-csv
npm run experiment:analyze
```

--

Once the analysis is fresh, ask the agent to refresh the final report by invoking the `update-final-report` skill (defined in `.cursor/skills/update-final-report/`). The skill reads the new artifacts, edits `artifacts/final-report.md` in place preserving what is still correct, shows the diff plus the list of newly migrated functions, and waits for your approval before creating a git commit naming those functions. It only touches files under `artifacts/` and never pushes. The skill ends its reply with `Next step: npm run experiment:migrate-start -- --function <name>`, closing the loop back to the next pair.
