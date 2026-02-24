/**
 * Verify 100% coverage: fetch ALL GTINs from GS1 for a date and compare with DB.
 * Uses same API params as ingestion (cursor pagination, status=pending).
 *
 * Usage:
 *   node src/scripts/verifyCoverage.js 2026-02-24
 *   node src/scripts/verifyCoverage.js 2026-02-24 pending
 */

import { fetchGs1Page } from "../services/gs1Client.js";
import { db } from "../lib/db.js";
import dotenv from "dotenv";

dotenv.config();

function getGtin(item) {
  const v = item?.gtin ?? item?.GTIN ?? item?.GTIN_number;
  return v != null && String(v).trim() ? String(v).trim() : null;
}

async function fetchAllGs1Gtins(date, status = "pending") {
  const gtins = new Set();
  let cursor = null;
  let pageNum = 0;

  console.log(`  Fetching from GS1 (status=${status}, from=${date}, to=${date})...`);

  while (true) {
    const page = await fetchGs1Page({
      status,
      from: date,
      to: date,
      resultPerPage: 100,
      cursor
    });

    pageNum++;
    for (const item of page.items ?? []) {
      const gtin = getGtin(item);
      if (gtin) gtins.add(gtin);
    }

    if (!page.hasNextPage || !page.nextCursor) break;
    cursor = page.nextCursor;

    if (pageNum % 10 === 0) {
      console.log(`    Page ${pageNum}, GTINs so far: ${gtins.size}`);
    }
  }

  console.log(`  GS1 total pages: ${pageNum}, unique GTINs: ${gtins.size}`);
  return gtins;
}

async function getDbGtinsForDate(date) {
  const result = await db.query(
    `SELECT DISTINCT vr.gtin
     FROM validation_results vr
     JOIN runs r ON r.run_id = vr.run_id
     WHERE DATE(r.start_time AT TIME ZONE 'Asia/Kolkata') = $1::date
       AND vr.gtin IS NOT NULL AND vr.gtin != ''`,
    [date]
  );
  return new Set(result.rows.map((r) => r.gtin));
}

async function verifyCoverage(date, status = "pending") {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║          COVERAGE VERIFICATION (GS1 vs DB)                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nDate: ${date} | Status filter: ${status}\n`);

  try {
    const [gs1Gtins, dbGtins] = await Promise.all([
      fetchAllGs1Gtins(date, status),
      getDbGtinsForDate(date)
    ]);

    const inGs1NotDb = [...gs1Gtins].filter((g) => !dbGtins.has(g));
    const inDbNotGs1 = [...dbGtins].filter((g) => !gs1Gtins.has(g));

    const coverage = gs1Gtins.size > 0 ? (dbGtins.size / gs1Gtins.size) * 100 : 0;

    console.log("\n─ Summary ─────────────────────────────────────────────────────");
    console.log(`  GS1 unique GTINs:     ${gs1Gtins.size}`);
    console.log(`  DB unique GTINs:      ${dbGtins.size}`);
    console.log(`  Coverage:            ${coverage.toFixed(2)}%`);

    console.log("\n─ Discrepancy ──────────────────────────────────────────────────");
    console.log(`  In GS1, NOT in DB:    ${inGs1NotDb.length} (missing)`);
    console.log(`  In DB, NOT in GS1:    ${inDbNotGs1.length} (extra)`);

    if (inGs1NotDb.length > 0) {
      console.log("\n─ Sample missing GTINs (first 10) ─────────────────────────────");
      inGs1NotDb.slice(0, 10).forEach((g, i) => console.log(`  ${i + 1}. ${g}`));
    }

    if (inDbNotGs1.length > 0) {
      console.log("\n─ Sample extra GTINs (first 10) ───────────────────────────────");
      inDbNotGs1.slice(0, 10).forEach((g, i) => console.log(`  ${i + 1}. ${g}`));
    }

    console.log("\n─ Verdict ─────────────────────────────────────────────────────");
    if (coverage >= 100 && inGs1NotDb.length === 0) {
      console.log("  ✅ 100% COVERAGE - All GS1 products are in the DB.");
    } else if (inGs1NotDb.length > 0) {
      console.log(`  ⚠️  MISSING ${inGs1NotDb.length} products - Run ingestion to catch up.`);
    }
    if (inDbNotGs1.length > 0) {
      console.log(`  ℹ️  ${inDbNotGs1.length} GTINs in DB not in current GS1 response (may be from other dates or status changes).`);
    }

    console.log("\n");
    await db.end();
  } catch (err) {
    console.error("\n❌ Error:", err.message);
    await db.end();
    process.exit(1);
  }
}

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const status = process.argv[3] || "pending";

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node src/scripts/verifyCoverage.js YYYY-MM-DD [status]");
  console.error("  Example: node src/scripts/verifyCoverage.js 2026-02-24 pending");
  process.exit(1);
}

verifyCoverage(date, status);
