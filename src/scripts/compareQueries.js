/**
 * Compare Page Number Mode vs Cursor Mode queries to understand discrepancy.
 * 
 * Usage:
 *   node src/scripts/compareQueries.js [runId]
 */

import axios from "axios";
import { config } from "../config.js";
import dotenv from "dotenv";

dotenv.config();

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

async function compareQueries(runId) {
  console.log("\n╔════════════════════════════════════════════════════════════════╗");
  console.log("║     QUERY COMPARISON: Page Number vs Cursor Mode              ║");
  console.log("╚════════════════════════════════════════════════════════════════╝");
  
  // Get run details to get date range
  let fromDate = "2026-02-20";
  let toDate = "2026-02-20T23:59:59";
  let statusFilter = "pending";
  
  if (runId) {
    try {
      const { default: axios } = await import("axios");
      const { data: run } = await axios.get(`http://127.0.0.1:${config.port}/v1/runs/${runId}`);
      fromDate = normalizeDateForGs1(run.from_date);
      toDate = normalizeDateForGs1(run.to_date);
      if (fromDate === toDate && !toDate.includes("T")) {
        toDate = `${toDate}T23:59:59`;
      }
      statusFilter = run.status_filter || "pending";
      console.log(`\nRun ID: ${runId}`);
      console.log(`Date Range: ${fromDate} to ${toDate}`);
    } catch (e) {
      console.log(`\nUsing default date range: ${fromDate} to ${toDate}`);
    }
  }
  
  const url = `${GS1_BASE}${config.gs1.productsPath}`;
  
  console.log("\n─ Query 1: Page Number Mode (for totalResults) ──────────────────");
  const pageNumParams = {
    status: statusFilter,
    from: fromDate,
    to: toDate,
    resultperPage: 10
    // Note: NOT using paginate=cursor, so it uses Page Number Mode
  };
  
  console.log("Parameters:", JSON.stringify(pageNumParams, null, 2));
  
  try {
    const pageNumRes = await axios.get(url, {
      params: pageNumParams,
      timeout: 20000,
      headers: { Authorization: `Bearer ${GS1_TOKEN}` }
    });
    
    const pageInfo = pageNumRes.data?.pageInfo || {};
    console.log("\nResponse:");
    console.log(`  totalResults:        ${pageInfo.totalResults || "N/A"}`);
    console.log(`  totalPage:          ${pageInfo.totalPage || "N/A"}`);
    console.log(`  currentPageResults: ${pageInfo.currentPageResults || 0}`);
    console.log(`  Items in response:  ${(pageNumRes.data?.items || []).length}`);
    
    const pageNumTotal = pageInfo.totalResults || 0;
    
    console.log("\n─ Query 2: Cursor Mode (First Page) ────────────────────────────");
    const cursorParams1 = {
      paginate: "cursor",
      status: statusFilter,
      from: fromDate,
      to: toDate,
      resultperPage: 100
    };
    
    console.log("Parameters:", JSON.stringify(cursorParams1, null, 2));
    
    const cursorRes1 = await axios.get(url, {
      params: cursorParams1,
      timeout: 20000,
      headers: { Authorization: `Bearer ${GS1_TOKEN}` }
    });
    
    const cursorPageInfo = cursorRes1.data?.pageInfo || {};
    const items1 = cursorRes1.data?.items || [];
    const nextCursor = cursorRes1.data?.nextCursor || cursorPageInfo.nextCursor;
    const hasNext = cursorRes1.data?.hasNextPage || cursorPageInfo.hasNextPage;
    
    console.log("\nResponse:");
    console.log(`  Items in response:   ${items1.length}`);
    console.log(`  hasNextPage:        ${hasNext}`);
    console.log(`  nextCursor:         ${nextCursor ? "Present" : "None"}`);
    console.log(`  totalResults:       ${cursorPageInfo.totalResults || "N/A (not returned in cursor mode)"}`);
    
    console.log("\n─ Query 3: Cursor Mode (Second Page with cursor) ────────────────");
    if (nextCursor) {
      const cursorParams2 = {
        paginate: "cursor",
        status: statusFilter,
        from: fromDate,  // Including date filters
        to: toDate,      // Including date filters
        cursor: nextCursor,
        resultperPage: 100
      };
      
      console.log("Parameters:", JSON.stringify(cursorParams2, null, 2));
      
      const cursorRes2 = await axios.get(url, {
        params: cursorParams2,
        timeout: 20000,
        headers: { Authorization: `Bearer ${GS1_TOKEN}` }
      });
      
      const items2 = cursorRes2.data?.items || [];
      console.log("\nResponse:");
      console.log(`  Items in response:   ${items2.length}`);
      console.log(`  Note: Check if items match date range`);
    }
    
    console.log("\n─ Query 4: Cursor Mode (Second Page WITHOUT date filters) ───────");
    if (nextCursor) {
      const cursorParams3 = {
        paginate: "cursor",
        status: statusFilter,
        cursor: nextCursor,  // Only cursor, no date filters
        resultperPage: 100
      };
      
      console.log("Parameters:", JSON.stringify(cursorParams3, null, 2));
      console.log("⚠️  WARNING: This is what we were doing BEFORE the fix!");
      
      const cursorRes3 = await axios.get(url, {
        params: cursorParams3,
        timeout: 20000,
        headers: { Authorization: `Bearer ${GS1_TOKEN}` }
      });
      
      const items3 = cursorRes3.data?.items || [];
      console.log("\nResponse:");
      console.log(`  Items in response:   ${items3.length}`);
      console.log(`  ⚠️  This may return items outside date range!`);
    }
    
    console.log("\n─ Comparison Summary ────────────────────────────────────────────");
    console.log(`  Page Number Mode Total: ${pageNumTotal}`);
    console.log(`  Cursor Mode (with filters): Fetching...`);
    console.log(`  Cursor Mode (without filters): May fetch more items`);
    console.log("\n  Key Differences:");
    console.log("    1. Page Number Mode returns totalResults");
    console.log("    2. Cursor Mode does NOT return totalResults");
    console.log("    3. Cursor Mode WITH date filters should match Page Number Mode");
    console.log("    4. Cursor Mode WITHOUT date filters may fetch extra items");
    
  } catch (error) {
    console.error("\n❌ Error:", error.message);
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", JSON.stringify(error.response.data, null, 2));
    }
  }
}

const runId = process.argv[2];
compareQueries(runId).catch(console.error);
