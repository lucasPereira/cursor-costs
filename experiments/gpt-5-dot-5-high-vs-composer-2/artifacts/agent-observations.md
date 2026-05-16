# Agent observations

## Purpose

Use this file for agent-written notes about completed function pairs in the `gpt-5.5-high` vs `composer-2` experiment. Each entry covers one pair as a whole and is appended by the `register-observations` skill in `.cursor/skills/register-observations/`, which the user invokes around `experiment:select`. Keep the text descriptive and avoid numeric quality scores; the quantitative analysis is handled by `artifacts/analysis-results.json`.

## Entry template

```markdown
### YYYY-MM-DD HH:mm - <functionName>

- pairId:
- selectedDecision:
- composer-2: runId=<id>, branch=<branch>, status=<succeeded|failed>
- gpt-5.5-high: runId=<id>, branch=<branch>, status=<succeeded|failed>

#### Approach differences

<How each model approached the migration, based on the diffs.>

#### Completeness and risks

<What is missing or risky in each run, including handlers wired vs unwired, error handling, tests, etc.>

#### Cross-reference with human notes

<Anything in artifacts/human-observations.md for the same pairId that confirms or contradicts the above. Write "None." if there are no related human notes.>
```
