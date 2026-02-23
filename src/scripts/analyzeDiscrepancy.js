/**
 * Analyze discrepancy between fetched items and GS1 API total.
 * 
 * Usage:
 *   node src/scripts/analyzeDiscrepancy.js <runId>
 */

import { db } from "../lib/db.js";
import dotenv from "dotenv";

dotenv.config();

async function analyzeDiscrepancy(runId) {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║          DISCREPANCY ANALYSIS                                   ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nRun ID: ${runId}\n`);

  try {
    // Get run details
    const runRes = await db.query("SELECT * FROM runs WHERE run_id = $1", [runId]);
    if (runRes.rows.length === 0) {
      console.error(`Run ${runId} not found!`);
      process.exit(1);
    }
    const run = runRes.rows[0];

    console.log("─ Run Details ────────────────────────────────────────────────────");
    console.log(`  from_date:           ${run.from_date}`);
    console.log(`  to_date:             ${run.to_date}`);
    console.log(`  status_filter:       ${run.status_filter}`);
    console.log(`  items_fetched:       ${run.items_fetched}`);
    console.log(`  pages_fetched:       ${run.pages_fetched}`);
    console.log(`  validated_count:    ${run.validated_count}`);

    // Check for duplicate GTINs
    const dupRes = await db.query(`
      SELECT 
        COUNT(DISTINCT gtin) as unique_gtins,
        COUNT(*) as total_records,
        COUNT(*) - COUNT(DISTINCT gtin) as duplicates
      FROM validation_results 
      WHERE run_id = $1
    `, [runId]);

    const stats = dupRes.rows[0];
    console.log("\n─ Validation Results Analysis ───────────────────────────────────");
    console.log(`  Unique GTINs:        ${stats.unique_gtins}`);
    console.log(`  Total Records:       ${stats.total_records}`);
    console.log(`  Duplicates:          ${stats.duplicates}`);

    // Check GTINs that appear multiple times
    const multiRes = await db.query(`
      SELECT gtin, COUNT(*) as count
      FROM validation_results
      WHERE run_id = $1
      GROUP BY gtin
      HAVING COUNT(*) > 1
      ORDER BY count DESC
      LIMIT 10
    `, [runId]);

    if (multiRes.rows.length > 0) {
      console.log("\n─ Top Duplicate GTINs ──────────────────────────────────────────");
      multiRes.rows.forEach((row, idx) => {
        console.log(`  ${idx + 1}. GTIN: ${row.gtin} - Appears ${row.count} times`);
      });
    }

    // Check batch events to see page sequence
    const batchRes = await db.query(`
      SELECT 
        COUNT(*) as total_batches,
        SUM(items_count) as total_items_in_batches,
        MIN(source_page_seq) as first_page,
        MAX(source_page_seq) as last_page
      FROM batch_events
      WHERE run_id = $1 AND event_type = 'RAW_BATCH_ENQUEUED'
    `, [runId]);

    const batchStats = batchRes.rows[0];
    console.log("\n─ Batch Events Analysis ─────────────────────────────────────────");
    console.log(`  Total Batches:       ${batchStats.total_batches}`);
    console.log(`  Items in Batches:    ${batchStats.total_items_in_batches}`);
    console.log(`  First Page:          ${batchStats.first_page}`);
    console.log(`  Last Page:           ${batchStats.last_page}`);

    // Calculate discrepancy
    const discrepancy = run.items_fetched - stats.unique_gtins;
    console.log("\n─ Discrepancy Analysis ──────────────────────────────────────────");
    console.log(`  Items Fetched:       ${run.items_fetched}`);
    console.log(`  Unique GTINs:        ${stats.unique_gtins}`);
    console.log(`  Difference:          ${discrepancy}`);
    
    if (discrepancy > 0) {
      const percent = ((discrepancy / run.items_fetched) * 100).toFixed(1);
      console.log(`  Percentage:          ${percent}% duplicates or extra items`);
    }

    // Check if run was created before date filter fix
    const runCreated = new Date(run.start_time);
    const fixDate = new Date('2026-02-20T10:00:00Z'); // Approximate time of fix
    const wasBeforeFix = runCreated < fixDate;
    
    console.log("\n─ Root Cause Analysis ────────────────────────────────────────────");
    console.log(`  Run Created:         ${runCreated.toISOString()}`);
    console.log(`  Date Filter Fix:    ${fixDate.toISOString()}`);
    console.log(`  Before Fix:          ${wasBeforeFix ? "✓ Yes" : "✗ No"}`);
    
    if (wasBeforeFix && discrepancy > 0) {
      console.log("\n  ⚠️  This run was created BEFORE the date filter fix.");
      console.log("     Cursor pagination may have fetched items outside date range.");
      console.log("     Future runs should match GS1 API total correctly.");
    } else if (discrepancy > 0) {
      console.log("\n  ⚠️  Discrepancy detected even after fix.");
      console.log("     Possible causes:");
      console.log("     - Duplicate items in GS1 API response");
      console.log("     - Items counted multiple times in batches");
      console.log("     - Date range normalization issue");
    } else {
      console.log("\n  ✓ No significant discrepancy detected.");
    }

    await db.end();
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    await db.end();
    process.exit(1);
  }
}

const runId = process.argv[2];
if (!runId) {
  console.error("Usage: node src/scripts/analyzeDiscrepancy.js <runId>");
  process.exit(1);
}

analyzeDiscrepancy(runId);
