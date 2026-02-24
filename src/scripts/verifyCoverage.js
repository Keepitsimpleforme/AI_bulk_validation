/**
 * Verify 100% coverage: fetch ALL GTINs from GS1 for a date and compare with DB.
 * Uses page-number mode (no paginate=cursor) - matches GS1 API response structure.
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

function extractItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.products)) return payload.products;
  return [];
}

async function fetchAllGs1Gtins(date, status = "pending", debug = false) {
  const gtins = new Set();
  const client = axios.create({
    baseURL: config.gs1.baseUrl,
    timeout: config.gs1.timeoutMs,
    headers: { Authorization: `Bearer ${config.gs1.token}` }
  });

  const params = {
    status,
    from: date,
    to: `${date}T23:59`,
    resultperPage: 100
  };

  console.log(`  Fetching from GS1 (status=${status}, from=${date}, to=${date})...`);

  let page = 1;
  let totalPage = 1;

  while (page <= totalPage) {
    const res = await client.get(config.gs1.productsPath, {
      params: { ...params, page }
    });
    const payload = res.data ?? {};
    const items = extractItems(payload);
    const pageInfo = payload.pageInfo ?? {};

    totalPage = pageInfo.totalPage ?? totalPage;

    for (const item of items) {
      const gtin = getGtin(item);
      if (gtin) gtins.add(gtin);
    }

    const needDebug = page === 1 && (debug || items.length === 0 || (items.length > 0 && gtins.size === 0));
    if (needDebug) {
      const url = `${config.gs1.baseUrl}${config.gs1.productsPath}`;
      console.log(`  [Debug] Request: ${url}?${new URLSearchParams({ ...params, page }).toString()}`);
      console.log(`  [Debug] Status: ${res.status}, items.length: ${items.length}, pageInfo:`, JSON.stringify(pageInfo));
      if (items.length > 0) {
        console.log(`  [Debug] First item keys: ${Object.keys(items[0]).join(", ")}`);
        console.log(`  [Debug] First item gtin: ${items[0].gtin ?? items[0].GTIN ?? "N/A"}`);
      } else {
        console.log(`  [Debug] Top-level keys: ${Object.keys(payload).join(", ")}`);
      }
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

async function verifyCoverage(date, status = "pending", debug = false) {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║          COVERAGE VERIFICATION (GS1 vs DB)                      ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nDate: ${date} | Status filter: ${status}\n`);

  try {
    const [gs1Gtins, dbGtins] = await Promise.all([
      fetchAllGs1Gtins(date, status, debug),
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

const args = process.argv.slice(2).filter((a) => a !== "--debug");
const date = args[0] || new Date().toISOString().slice(0, 10);
const status = args[1] || "pending";
const debug = process.argv.includes("--debug");

if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node src/scripts/verifyCoverage.js YYYY-MM-DD [status] [--debug]");
  console.error("  Example: node src/scripts/verifyCoverage.js 2026-02-24 pending");
  console.error("  Example: node src/scripts/verifyCoverage.js 2026-02-24 --debug");
  process.exit(1);
}

verifyCoverage(date, status, debug);
