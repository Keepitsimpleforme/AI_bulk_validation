/**
 * Check if a list of GTINs for a given date were:
 *   1. Ingested + validated (present in validation_results)
 *   2. Delivered to dashboard (run has delivered_count; delivery is per-batch)
 *
 * Usage:
 *   node src/scripts/checkGtinCoverage.js 2026-03-03 [path-to-gtins.xlsx]
 *   node src/scripts/checkGtinCoverage.js 2026-03-04 ~/Downloads/march4_gtins.xlsx
 *
 * If no file path: reads from GTIN_XLSX_PATH or ~/Downloads/GTIN Validation.xlsx
 * Excel structure (GTIN Validation.xlsx): Sheet "Export", columns: Gtin, Created at, Updated at, Status, AI Flag, etc.
 */

import XLSX from "xlsx";
import fs from "fs";
import path from "path";
import { db } from "../lib/db.js";
import { config } from "../config.js";

const DEFAULT_GTIN_FILE =
  process.env.GTIN_XLSX_PATH ||
  path.join(process.env.HOME || process.env.USERPROFILE || "", "Downloads", "GTIN Validation.xlsx");

function loadGtinsFromFile(filePath, filterDate = null) {
  const ext = path.extname(filePath).toLowerCase();
  let rows;
  if (ext === ".csv" || ext === ".txt") {
    const buf = fs.readFileSync(filePath, "utf8");
    const lines = buf.split(/\r?\n/).filter((l) => l.trim());
    rows = lines.map((line) => {
      const parts = line.split(/[,\t]/).map((p) => p.trim());
      return { gtin: parts[0], created_at: "", updated_at: "", product_status: "", approval_status: "" };
    });
  } else {
    const wb = XLSX.readFile(filePath);
    const sheetName = wb.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  }

  if (!rows.length) return [];

  // Match "GTIN Validation.xlsx": Gtin, Created at, Updated at, Product status, Approval Status, etc.
  const gtinKeys = ["Gtin", "gtin", "GTIN", "GTIN_number", "GTIN Number"];
  const dateKeys = ["Created at", "Updated at", "date", "Date", "from_date", "from"];
  const createdKey = ["Created at", "created_at", "Created At"].find((k) => rows[0] && k in rows[0]);
  const updatedKey = ["Updated at", "updated_at", "Updated At"].find((k) => rows[0] && k in rows[0]);
  const productStatusKey = ["Product status", "product_status", "Product Status"].find((k) => rows[0] && k in rows[0]);
  const approvalStatusKey = ["Approval Status", "approval_status", "Approval status"].find((k) => rows[0] && k in rows[0]);

  let gtinKey = gtinKeys.find((k) => rows[0] && k in rows[0]);
  if (!gtinKey && rows[0]) gtinKey = Object.keys(rows[0])[0];
  let dateKey = dateKeys.find((k) => rows[0] && k in rows[0]);

  // Convert Excel serial date to YYYY-MM-DD
  const excelDateToStr = (val) => {
    if (val == null) return "";
    const n = Number(val);
    if (!Number.isFinite(n)) return String(val).slice(0, 10);
    const d = new Date((n - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  };

  const pick = (row, key) => (key && row[key] != null && row[key] !== "" ? String(row[key]).trim() : "");

  const seen = new Set();
  const result = [];
  for (const row of rows) {
    const v = row[gtinKey];
    if (v == null || String(v).trim() === "") continue;
    if (filterDate && dateKey) {
      const rowDate = row[dateKey];
      if (rowDate != null && rowDate !== "") {
        const d = typeof rowDate === "number" ? excelDateToStr(rowDate) : String(rowDate).slice(0, 10);
        if (d !== filterDate) continue;
      }
    }
    const gtin = String(v).trim();
    if (seen.has(gtin)) continue;
    seen.add(gtin);
    const createdAt = createdKey ? (typeof row[createdKey] === "number" ? excelDateToStr(row[createdKey]) : pick(row, createdKey)) : "";
    const updatedAt = updatedKey ? (typeof row[updatedKey] === "number" ? excelDateToStr(row[updatedKey]) : pick(row, updatedKey)) : "";
    result.push({
      gtin,
      created_at: createdAt || "",
      updated_at: updatedAt || "",
      product_status: pick(row, productStatusKey),
      approval_status: pick(row, approvalStatusKey)
    });
  }
  return result;
}

async function getDbGtinsForDate(date) {
  const result = await db.query(
    `SELECT vr.gtin, vr.validation_status, r.run_id, r.delivered_count, r.delivery_failed_count
     FROM validation_results vr
     JOIN runs r ON r.run_id = vr.run_id
     WHERE $1::date >= r.from_date AND $1::date <= r.to_date
       AND vr.gtin IS NOT NULL AND vr.gtin != ''`,
    [date]
  );
  return result.rows;
}

async function main() {
  const date = process.argv[2];
  const filePath = process.argv[3] || DEFAULT_GTIN_FILE;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Usage: node src/scripts/checkGtinCoverage.js YYYY-MM-DD [path-to-gtins.xlsx]");
    console.error("  Example: node src/scripts/checkGtinCoverage.js 2026-03-03");
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error("File not found:", filePath);
    process.exit(1);
  }

  if (!config.databaseUrl) {
    console.error("DATABASE_URL is required in .env");
    process.exit(1);
  }

  const gtinsToCheck = loadGtinsFromFile(filePath, date);
  console.log("\n─── GTIN Coverage Check ───");
  console.log("Date:", date);
  console.log("File:", filePath);
  console.log("GTINs to check:", gtinsToCheck.length);
  console.log("");

  const rows = await getDbGtinsForDate(date);
  const byGtin = new Map();
  for (const r of rows) {
    const g = String(r.gtin).trim();
    if (!byGtin.has(g)) {
      byGtin.set(g, { validation_status: r.validation_status, delivered_count: r.delivered_count, run_id: r.run_id });
    }
  }

  const present = [];
  const missing = [];
  for (const row of gtinsToCheck) {
    const info = byGtin.get(row.gtin);
    if (info) {
      present.push({ ...row, ...info });
    } else {
      missing.push(row);
    }
  }

  const runsWithDelivered = new Set(
    rows.filter((r) => r.delivered_count > 0).map((r) => r.run_id)
  );
  const deliveredCount = present.filter((p) => runsWithDelivered.has(p.run_id)).length;

  console.log("─ Results ─────────────────────────────────────────────────");
  console.log(`  In DB (ingested + validated): ${present.length} / ${gtinsToCheck.length}`);
  console.log(`  Missing from DB:              ${missing.length}`);
  console.log(`  (In runs that delivered):     ${deliveredCount} (run-level; not per-GTIN)`);
  console.log("");

  if (present.length > 0) {
    const statusCounts = {};
    for (const p of present) {
      statusCounts[p.validation_status] = (statusCounts[p.validation_status] || 0) + 1;
    }
    console.log("  Validation status breakdown:");
    for (const [status, count] of Object.entries(statusCounts)) {
      console.log(`    ${status}: ${count}`);
    }
  }

  const showMax = 15;
  const col = (s, w) => String(s ?? "").slice(0, w).padEnd(w);
  const header = "  " + [col("GTIN", 16), col("Created at", 12), col("Updated at", 12), col("Product status", 14), col("Approval status", 16)].join("  ");

  if (present.length > 0) {
    console.log("");
    console.log(`  Present in DB (first ${Math.min(showMax, present.length)}) — with Created at, Updated at, Product status, Approval status:`);
    console.log(header + "  Validation status");
    console.log("  " + "-".repeat(header.length + 20));
    for (const p of present.slice(0, showMax)) {
      const line = [col(p.gtin, 16), col(p.created_at, 12), col(p.updated_at, 12), col(p.product_status, 14), col(p.approval_status, 16)].join("  ");
      console.log("  " + line + "  " + (p.validation_status ?? ""));
    }
    if (present.length > showMax) {
      console.log(`  ... and ${present.length - showMax} more`);
    }
  }

  if (missing.length > 0) {
    console.log("");
    console.log(`  Missing from DB (first ${Math.min(showMax, missing.length)}):`);
    console.log(header);
    console.log("  " + "-".repeat(header.length));
    for (const m of missing.slice(0, showMax)) {
      const line = [col(m.gtin, 16), col(m.created_at, 12), col(m.updated_at, 12), col(m.product_status, 14), col(m.approval_status, 16)].join("  ");
      console.log("  " + line);
    }
    if (missing.length > showMax) {
      console.log(`  ... and ${missing.length - showMax} more`);
    }
  }

  console.log("");
  await db.end();
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
