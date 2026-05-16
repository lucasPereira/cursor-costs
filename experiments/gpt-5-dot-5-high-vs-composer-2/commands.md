# Experiment pipeline commands

This file documents the operator workflow for a single function pair, from branch creation to selection. The three `migrate-*` commands wrap manifest updates, Git checkouts, commits, and branch creation in the right order so you do not have to remember submodule paths, branch names, or `runId`/`pairId` values. Each command validates pre-conditions and aborts with a clear message instead of leaving the workspace in a half-applied state.

One time setup. Initialize the MessengerX submodules and check out the expected base branches before the first pair.

```bash
npm run experiment:bootstrap-submodules
```

Start the pair. The command verifies the target submodule is on its base branch (`dev` for `messengerx_backend`, `develop` for `messengerx_firebase`) with a clean working tree, fast-forwards from origin, registers a new run in the manifest, and creates the model-specific branch.

```bash
npm run experiment:migrate-start -- --function sendMessage --model composer-2
```

Run the migration with the first model in your IDE/agent. When you are done, finish the first run. This command stages all changes in the submodule, commits with `chore: migrate <function> to v2 with <model>`, marks the run as `succeeded` or `failed`, returns the submodule to its base branch, fast-forwards, and immediately creates the branch for the second model and registers the matching run.

```bash
npm run experiment:migrate-finish-first -- --status succeeded
```

Run the migration with the second model, then finish the second run. This command commits and closes the run the same way, returns the submodule to the base branch, and prints the `pairId` together with the suggested `experiment:select` command.

```bash
npm run experiment:migrate-finish-second -- --status succeeded
```

Record the selection decision for the latest open pair. Run only one of these. `--pair` is optional; without it the command targets the most recent pair without a `selectedDecision`.

```bash
npm run experiment:select -- --decision composer-2
npm run experiment:select -- --decision gpt-5.5-high
npm run experiment:select -- --decision both
npm run experiment:select -- --decision neither
```

Ask the agent to log observations for the pair by invoking the `register-observations` skill (defined in `.cursor/skills/register-observations/`). Pass your free-text notes in the same message; the skill always targets the latest pair, so you do not pass a `pairId`. It appends one entry to `artifacts/human-observations.md` with your text and one entry to `artifacts/agent-observations.md` with the agent's reading of both branch diffs. Do this once per pair, around `experiment:select`.

Refresh the usage CSV and regenerate analysis results and charts. This can be done after every pair or only at the end of the experiment, since both steps are idempotent.

```bash
npm run experiment:download-csv
npm run experiment:analyze
```
