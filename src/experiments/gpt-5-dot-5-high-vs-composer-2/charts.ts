import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { CHARTS_DIR } from "./paths.js";

export type ChartDatum = {
  label: string;
  value: number;
};

export async function writeCharts(charts: Record<string, ChartDatum[]>): Promise<string[]> {
  await mkdir(CHARTS_DIR, { recursive: true });
  const written: string[] = [];
  for (const [name, data] of Object.entries(charts)) {
    const filePath = path.join(CHARTS_DIR, `${name}.svg`);
    await writeFile(filePath, renderBarChart(name, data));
    written.push(filePath);
  }
  return written;
}

function renderBarChart(title: string, data: ChartDatum[]): string {
  const width = 900;
  const height = 360;
  const margin = { top: 48, right: 24, bottom: 96, left: 96 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const values = data.map((item) => item.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const barWidth = data.length === 0 ? plotWidth : plotWidth / data.length;
  const zeroY = margin.top + ((max - 0) / span) * plotHeight;

  const bars = data
    .map((item, index) => {
      const x = margin.left + index * barWidth + 8;
      const y = margin.top + ((max - Math.max(0, item.value)) / span) * plotHeight;
      const valueY = margin.top + ((max - item.value) / span) * plotHeight;
      const rectY = item.value >= 0 ? valueY : zeroY;
      const rectHeight = Math.max(1, Math.abs(zeroY - valueY));
      const labelX = x + (barWidth - 16) / 2;
      return `
        <rect x="${x}" y="${rectY}" width="${Math.max(1, barWidth - 16)}" height="${rectHeight}" fill="#4f46e5" />
        <text x="${labelX}" y="${height - 54}" text-anchor="end" transform="rotate(-35 ${labelX} ${height - 54})" font-size="11">${escapeXml(item.label)}</text>
        <text x="${labelX}" y="${item.value >= 0 ? rectY - 6 : rectY + rectHeight + 14}" text-anchor="middle" font-size="11">${formatChartValue(item.value)}</text>
      `;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(title)}">
  <rect width="100%" height="100%" fill="white" />
  <text x="${margin.left}" y="28" font-size="18" font-weight="600">${escapeXml(title)}</text>
  <line x1="${margin.left}" y1="${zeroY}" x2="${width - margin.right}" y2="${zeroY}" stroke="#111827" stroke-width="1" />
  <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#111827" stroke-width="1" />
  <text x="${margin.left - 12}" y="${margin.top + 4}" text-anchor="end" font-size="11">${formatChartValue(max)}</text>
  <text x="${margin.left - 12}" y="${height - margin.bottom}" text-anchor="end" font-size="11">${formatChartValue(min)}</text>
  ${bars}
</svg>
`;
}

function formatChartValue(value: number): string {
  if (Math.abs(value) >= 1000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  }
  if (Math.abs(value) >= 1) {
    return value.toFixed(2);
  }
  return value.toPrecision(3);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
