/**
 * One-off check: call GS1 API and report if it returns data.
 * Uses .env GS1_TOKEN, GS1_BASE_URL, GS1_PRODUCTS_PATH.
 *
 * Usage:
 *   node src/scripts/checkGs1Api.js [date]
 *   node src/scripts/checkGs1Api.js 2026-02-23
 * If date is omitted, uses today (local date YYYY-MM-DD).
 */

import axios from "axios";
import { config } from "../config.js";

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

async function main() {
  console.log("\n─── GS1 API check ───");
  console.log("Base URL:", config.gs1.baseUrl);
  console.log("Path:   ", config.gs1.productsPath);
  console.log("Token:  ", config.gs1.token ? "***set***" : "NOT SET");
  console.log("Date:   ", date);
  console.log("");

  if (!config.gs1.token) {
    console.error("Set GS1_TOKEN in .env and try again.");
    process.exit(1);
  }

  const url = `${config.gs1.baseUrl}${config.gs1.productsPath}`;
  const params = {
    paginate: "cursor",
    status: "pending",
    from: date,
    to: `${date}T23:59:59`,
    resultperPage: 10
  };

  try {
    const res = await axios.get(url, {
      params,
      timeout: config.gs1.timeoutMs,
      headers: { Authorization: `Bearer ${config.gs1.token}` }
    });

    const data = res.data ?? {};
    const pageInfo = data.pageInfo ?? {};
    const items =
      Array.isArray(data.items) ? data.items
      : Array.isArray(data.data) ? data.data
      : Array.isArray(data.products) ? data.products
      : [];

    const total = pageInfo.totalResults ?? data.totalResults ?? "(not in response)";
    console.log("Status:  ", res.status, "OK");
    console.log("Total (from API):", total);
    console.log("Items this page:", items.length);
    if (items.length > 0) {
      console.log("Sample keys:", Object.keys(items[0]).slice(0, 8).join(", "));
      console.log("\n--- EXCLUSIVE API PAYLOAD DUMP ---");
      console.log(JSON.stringify(items[5], null, 2));
      console.log("----------------------------------\n");
    }
    console.log("\nGS1 API is returning data. Pipeline can fetch and validate.");
    process.exit(0);
  } catch (err) {
    const status = err.response?.status;
    const body = err.response?.data;
    console.error("Request failed:", err.message);
    if (status) console.error("HTTP status:", status);
    if (body) console.error("Response:", typeof body === "object" ? JSON.stringify(body).slice(0, 300) : String(body).slice(0, 300));
    if (status === 401) console.error("\n→ 401: Check GS1_TOKEN (invalid or expired).");
    process.exit(1);
  }
}

main();
