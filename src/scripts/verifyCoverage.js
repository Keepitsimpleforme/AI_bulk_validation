/**
 * Verify 100% coverage: fetch ALL GTINs from GS1 for a date and compare with DB.
 * Uses page-number mode (no paginate param) - same as testGs1PageNumber.js.
 *
 * Usage:
 *   node src/scripts/verifyCoverage.js 2026-02-24
 *   node src/scripts/verifyCoverage.js 2026-02-24 pending
 */

import axios from "axios";
import { config } from "../config.js";
import { db } from "../lib/db.js";
import dotenv from "dotenv";

dotenv.config();

function getGtin(item) {
  const v = item?.gtin ?? item?.GTIN ?? item?.GTIN_number;
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

async function fetchAllGs1Gtins(date, status = "pending") {
  const gtins = new Set();
  const client = axios.create({
    baseURL: config.gs1.baseUrl,
    timeout: config.gs1.timeoutMs,
    headers: { Authorization: `Bearer ${config.gs1.token}` }
  });

  const baseParams = {
    status,
    from: date,
    to: `${date}T23:59`,
    resultperPage: 100
  };

  console.log(`  Fetching from GS1 (status=${status}, from=${date}, to=${date})...`);

  let page = 1;
  let totalPage = 1;

  while (page <= totalPage) {
    const params = page === 1 ? { ...baseParams } : { ...baseParams, page };
    const res = await client.get(config.gs1.productsPath, { params });
    const payload = res.data ?? {};
    const items = payload.items ?? payload.data ?? payload.products ?? [];
    const pageInfo = payload.pageInfo ?? {};

    totalPage = pageInfo.totalPage ?? totalPage;
    for (const item of items) {
      const gtin = getGtin(item);
      if (gtin) gtins.add(gtin);
    }

    if (page % 50 === 0 || page === 1) {
      console.log(`    Page ${page}/${totalPage}, GTINs so far: ${gtins.size}`);
    }

    if (page >= totalPage) break;
    page++;
  }

  console.log(`  GS1 total pages: ${page}, unique GTINs: ${gtins.size}`);
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

async function getRunStatsForDate(date) {
  const result = await db.query(
    `SELECT COALESCE(SUM(items_fetched), 0) as total_fetched
     FROM runs
     WHERE DATE(start_time AT TIME ZONE 'Asia/Kolkata') = $1::date`,
    [date]
  );
  return Number(result.rows[0]?.total_fetched ?? 0);
}

async function verifyCoverage(date, status = "pending") {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║          COVERAGE VERIFICATION (GS1 vs DB)                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nDate: ${date} | Status filter: ${status}\n`);

  try {
    const [gs1Gtins, dbGtins, runStats] = await Promise.all([
      fetchAllGs1Gtins(date, status),
      getDbGtinsForDate(date),
      getRunStatsForDate(date)
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
    if (gs1Gtins.size === 0) {
      console.log("  ⚠️  GS1 API returned no data. Check GS1_TOKEN in .env (valid, not expired).");
      if (runStats > 0) {
        const runCoverage = (dbGtins.size / runStats * 100).toFixed(1);
        console.log(`  ℹ️  Fallback: Runs ingested ${runStats} items for this date; DB has ${dbGtins.size} unique (~${runCoverage}% of ingested).`);
      }
      console.log("  Test: docker compose run --rm app node src/scripts/checkGs1Api.js", date);
    } else if (coverage >= 100 && inGs1NotDb.length === 0) {
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

const args = process.argv.slice(2).filter((a) => a !== "--debug");
const date = args[0] || new Date().toISOString().slice(0, 10);
const status = args[1] || "pending";

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node src/scripts/verifyCoverage.js YYYY-MM-DD [status]");
  console.error("  Example: node src/scripts/verifyCoverage.js 2026-02-24 pending");
  process.exit(1);
}

verifyCoverage(date, status);
