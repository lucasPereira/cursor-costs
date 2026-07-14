import "dotenv/config";
import { downloadCsv, parseCountIncludedEnv, printCosts, readUsageRows } from "./usageWorker.js";

async function main(): Promise<void> {
  const countIncluded = parseCountIncludedEnv();
  const csvPath = await downloadCsv({ countIncluded });
  const { rows, dateColumn, costColumn, modelColumn } = await readUsageRows(csvPath);
  const modelNote = modelColumn ? `, model="${modelColumn}"` : "";
  const includedNote = countIncluded ? " (counting Included)" : "";
  console.log(`Using CSV columns: date="${dateColumn}", spend="${costColumn}" (USD)${modelNote}${includedNote}\n`);
  printCosts(rows, Boolean(modelColumn));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
