import { downloadCsv, printCosts, readUsageRows } from "./usageWorker.js";

async function main(): Promise<void> {
  const csvPath = await downloadCsv();
  const { rows, dateColumn, costColumn, modelColumn } = await readUsageRows(csvPath);
  const modelNote = modelColumn ? `, model="${modelColumn}"` : "";
  console.log(`Using CSV columns: date="${dateColumn}", spend="${costColumn}" (USD)${modelNote}\n`);
  printCosts(rows, Boolean(modelColumn));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
