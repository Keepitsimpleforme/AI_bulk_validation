/**
 * Quick check script to see if new data arrived and if we're validating it.
 * 
 * Usage:
 *   node src/scripts/checkNewData.js [runId]
 */

import axios from "axios";
import { config } from "../config.js";
import dotenv from "dotenv";

dotenv.config();

const API_BASE = `http://127.0.0.1:${config.port}`;
const GS1_BASE = config.gs1.baseUrl;
const GS1_TOKEN = config.gs1.token;

function normalizeDateForGs1(dateInput) {
  if (!dateInput) return dateInput;
  const str = String(dateInput);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
  try {
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {}
  const dateMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
  return dateMatch ? dateMatch[1] : str;
}

async function getGs1Total(status, from, to) {
  try {
    const fromDate = normalizeDateForGs1(from);
    const toDate = normalizeDateForGs1(to);
    const params = {
      status,
      from: fromDate,
      to: fromDate === toDate ? `${toDate}T23:59:59` : toDate,
      resultperPage: 10
    };
    const { data } = await axios.get(`${GS1_BASE}${config.gs1.productsPath}`, {
      params,
      timeout: 10000,
      headers: { Authorization: `Bearer ${GS1_TOKEN}` }
    });
    return {
      total: data?.pageInfo?.totalResults || 0,
      success: true
    };
  } catch (error) {
    return {
      total: null,
      success: false,
      error: error.message
    };
  }
}

async function checkNewData(runId) {
  const now = new Date();
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║          NEW DATA VALIDATION CHECK                              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  console.log(`\nRun ID: ${runId}`);
  console.log(`Check Time: ${now.toLocaleString()}\n`);

  try {
    // Get run status
    const { data: run } = await axios.get(`${API_BASE}/v1/runs/${runId}`);
    
    console.log("─ Run Status ────────────────────────────────────────────────────");
    console.log(`  Status:              ${run.status}`);
    console.log(`  Items Fetched:        ${run.items_fetched || 0}`);
    console.log(`  Validated:           ${run.validated_count || 0}`);
    console.log(`  Accepted:            ${run.accepted_count || 0}`);
    console.log(`  Rejected:            ${run.rejected_count || 0}`);
    console.log(`  Delivered:           ${run.delivered_count || 0}`);
    console.log(`  Ingestion Complete:  ${run.ingestion_completed ? "✓ Yes" : "✗ No"}`);
    
    // Get GS1 total
    const gs1Result = await getGs1Total(
      run.status_filter || "pending",
      run.from_date,
      run.to_date
    );
    
    const fetched = run.items_fetched || 0;
    let remaining = 0;
    let gs1Total = null;
    
    console.log("\n─ GS1 API Status ──────────────────────────────────────────────");
    if (gs1Result.success) {
      gs1Total = gs1Result.total;
      remaining = Math.max(0, gs1Total - fetched);
      
      console.log(`  Current GS1 Total:   ${gs1Total}`);
      console.log(`  Our Fetched Count:   ${fetched}`);
      console.log(`  Remaining:          ${remaining}`);
      
      if (remaining > 0) {
        if (run.status === "RUNNING" && !run.ingestion_completed) {
          console.log(`  ⚡ Status:           ACTIVE - Catching up with ${remaining} items`);
          console.log(`  ✅ Validation:       System is actively fetching and validating`);
        } else if (run.status === "RUNNING" && run.ingestion_completed) {
          console.log(`  ⚠️  Status:           Ingestion complete but ${remaining} items remain`);
          console.log(`  💡 Action:           May need to resume or start new run`);
        } else if (run.status === "SUCCESS") {
          console.log(`  ⚠️  Status:           Run completed but ${remaining} new items detected`);
          console.log(`  💡 Action:           Start a new run to validate new data`);
        }
      } else if (fetched >= gs1Total) {
        console.log(`  ✓ Status:           All items fetched`);
        if (run.status === "RUNNING") {
          console.log(`  ✅ Validation:       System is validating/delivering`);
        } else if (run.status === "SUCCESS") {
          console.log(`  ✅ Validation:       All items validated and delivered`);
        }
      }
      
      // Check if new data arrived since run started
      if (run.start_time) {
        const runStart = new Date(run.start_time);
        const elapsedMinutes = Math.floor((now - runStart) / 60000);
        console.log(`\n─ Time Analysis ──────────────────────────────────────────────────`);
        console.log(`  Run Started:         ${runStart.toLocaleString()}`);
        console.log(`  Elapsed Time:       ${elapsedMinutes} minutes`);
        console.log(`  Items/Second:        ${fetched > 0 ? (fetched / Math.max(1, (now - runStart) / 1000)).toFixed(1) : 0}`);
      }
      
    } else {
      console.log(`  GS1 API:            Unable to fetch - ${gs1Result.error}`);
    }
    
    console.log("\n─ Recommendations ──────────────────────────────────────────────");
    if (run.status === "RUNNING" && !run.ingestion_completed) {
      console.log("  ✓ System is actively running - new data will be validated automatically");
      console.log("  💡 Check again in 1-2 minutes to see progress");
      if (remaining > 0) {
        console.log(`  📊 ${remaining} items remaining to fetch`);
      }
    } else if (run.status === "RUNNING" && run.ingestion_completed) {
      if (remaining > 0) {
        console.log("  ⚠️  Ingestion completed but new data detected");
        console.log(`  📊 ${remaining} new items available`);
        console.log("  💡 Resume the run or start a new one to validate new data");
      } else {
        console.log("  ✓ All items fetched - validating/delivering");
      }
    } else if (run.status === "SUCCESS") {
      if (remaining > 0) {
        console.log("  ⚠️  Run completed but new data arrived");
        console.log(`  📊 ${remaining} new items available`);
        console.log("  💡 Start a new run to validate the new data");
      } else {
        console.log("  ✓ All data validated - system is up to date");
      }
    }
    
    console.log("\n");
    
  } catch (error) {
    if (error.response?.status === 404) {
      console.error(`\n❌ Run ${runId} not found!\n`);
    } else {
      console.error(`\n❌ Error: ${error.message}\n`);
    }
    process.exit(1);
  }
}

async function main() {
  let runId = process.argv[2];
  
  if (!runId) {
    // Try to find latest run from monitoring reports
    try {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const reportsDir = path.default.join(process.cwd(), "outputs", "monitoring");
      const files = await fs.readdir(reportsDir);
      const reportFiles = files.filter(f => f.startsWith("final_report_") && f.endsWith(".json"));
      if (reportFiles.length > 0) {
        const stats = await Promise.all(
          reportFiles.map(async (f) => {
            const stat = await fs.stat(path.default.join(reportsDir, f));
            return { file: f, mtime: stat.mtime };
          })
        );
        stats.sort((a, b) => b.mtime - a.mtime);
        const latest = stats[0].file;
        runId = latest.replace("final_report_", "").replace(".json", "");
        console.log(`Using latest run from reports: ${runId}\n`);
      }
    } catch (e) {
      // Ignore
    }
  }
  
  if (!runId) {
    console.error("Usage: node src/scripts/checkNewData.js [runId]");
    console.error("   Example: node src/scripts/checkNewData.js 7731ff7a-403d-4003-aa88-a02e08e19d16");
    process.exit(1);
  }
  
  await checkNewData(runId);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
