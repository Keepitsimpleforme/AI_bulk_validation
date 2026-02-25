/**
 * Test GS1 cursor mode with resultperPage: 10.
 * Fetches until hasNextPage is false to see if we get full dataset.
 *
 * Usage: node src/scripts/testGs1Cursor.js [date]
 *   node src/scripts/testGs1Cursor.js 2026-02-24
 */

import axios from "axios";
import { config } from "../config.js";
import dotenv from "dotenv";

dotenv.config();

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

async function main() {
  const client = axios.create({
    baseURL: config.gs1.baseUrl,
    timeout: config.gs1.timeoutMs,
    headers: { Authorization: `Bearer ${config.gs1.token}` }
  });

  const baseParams = {
    paginate: "cursor",
    status: "pending",
    from: date,
    to: `${date}T23:59:59`,
    resultperPage: 10
  };

  console.log("\n─── GS1 Cursor Mode Test (resultperPage: 10) ───");
  console.log("Date:", date);
  console.log("");

  let cursor = null;
  let pageNum = 0;
  const gtins = new Set();

  while (true) {
    const params = { ...baseParams };
    if (cursor) params.cursor = cursor;

    const res = await client.get(config.gs1.productsPath, { params });
    const data = res.data ?? {};
    const items = data.items ?? data.data ?? data.products ?? [];
    const nextCursor = data.nextCursor ?? data.pageInfo?.nextCursor ?? null;
    const hasNextPage = data.hasNextPage ?? data.pageInfo?.hasNextPage ?? Boolean(nextCursor);

    pageNum++;
    for (const item of items) {
      const g = item?.gtin ?? item?.GTIN;
      if (g) gtins.add(String(g).trim());
    }

    if (pageNum <= 3 || pageNum % 50 === 0) {
      console.log(`  Page ${pageNum}: ${items.length} items, total unique: ${gtins.size}, hasNext: ${hasNextPage}`);
    }

    if (!hasNextPage || !nextCursor) break;
    cursor = nextCursor;
  }

  console.log("");
  console.log("Result:");
  console.log(`  Pages: ${pageNum}`);
  console.log(`  Unique GTINs: ${gtins.size}`);
  console.log(`  Page-number API has ~12,250. Match: ${gtins.size >= 12000 ? "✓" : "✗"}`);
  console.log("");
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
