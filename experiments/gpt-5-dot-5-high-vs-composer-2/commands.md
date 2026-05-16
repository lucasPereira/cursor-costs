# Experiment pipeline commands

Initialize the MessengerX submodules and check out the expected base branches.

```bash
npm run experiment:bootstrap-submodules
```

Start the first run for the function, then create the model-specific migration branch in `messengerx_backend`.

```bash
npm run experiment:start -- --function sendMessage --model composer-2
cd experiments/gpt-5-dot-5-high-vs-composer-2/messengerx-workspace/messengerx_backend
git checkout dev
git pull
git checkout -b chore/migrate-send-message/composer-2
```

Review, stage, and commit the migration produced with `composer-2`.

```bash
git status
git diff
git add .
git commit -m "chore: migrate sendMessage to v2 with composer-2"
```

Return to the experiment control repository and close the first run with its final status.

```bash
cd /Users/lucas/projects/active/cursor-usage
npm run experiment:finish -- --run run-001 --status succeeded
```

Start the second run for the same function, then create the `gpt-5.5-high` branch from the same base branch.

```bash
npm run experiment:start -- --function sendMessage --model gpt-5.5-high
cd experiments/gpt-5-dot-5-high-vs-composer-2/messengerx-workspace/messengerx_backend
git checkout dev
git pull
git checkout -b chore/migrate-send-message/gpt-5-dot-5-high
```

Review, stage, and commit the migration produced with `gpt-5.5-high`.

```bash
git status
git diff
git add .
git commit -m "chore: migrate sendMessage to v2 with gpt-5.5-high"
```

Return to the experiment control repository and close the second run with its final status.

```bash
cd /Users/lucas/projects/active/cursor-usage
npm run experiment:finish -- --run run-002 --status succeeded
```

Record which migration result was selected for the function pair. Run only one of these decisions.

```bash
npm run experiment:select -- --pair pair-001 --decision composer-2
npm run experiment:select -- --pair pair-001 --decision gpt-5.5-high
npm run experiment:select -- --pair pair-001 --decision both
npm run experiment:select -- --pair pair-001 --decision neither
```

Refresh the usage CSV and regenerate analysis results and charts.

```bash
npm run experiment:download-csv
npm run experiment:analyze
```
