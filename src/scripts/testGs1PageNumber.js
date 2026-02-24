/**
 * Test GS1 API - Page Number Mode (no paginate param).
 * Run locally or in Docker to see exact request/response.
 *
 * Usage: node src/scripts/testGs1PageNumber.js [date]
 *   node src/scripts/testGs1PageNumber.js 2026-02-24
 *   docker compose run --rm app node src/scripts/testGs1PageNumber.js 2026-02-24
 */

import axios from "axios";
import { config } from "../config.js";
import dotenv from "dotenv";

dotenv.config();

const date = process.argv[2] || new Date().toISOString().slice(0, 10);

const params = {
  status: "pending",
  from: date,
  to: `${date}T23:59`,
  resultperPage: 10
};

const url = `${config.gs1.baseUrl}${config.gs1.productsPath}`;
const fullUrl = `${url}?${new URLSearchParams(params).toString()}`;

console.log("\n─── GS1 API Test (Page Number Mode) ───");
console.log("Date:", date);
console.log("Token:", config.gs1.token ? `Bearer ${config.gs1.token.slice(0, 8)}...` : "NOT SET");
console.log("\nRequest:");
console.log("  URL:", fullUrl);
console.log("  Params:", JSON.stringify(params, null, 2));
console.log("  Headers: { Authorization: Bearer *** }");
console.log("");

if (!config.gs1.token) {
  console.error("Set GS1_TOKEN in .env");
  process.exit(1);
}

try {
  const res = await axios.get(url, {
    params,
    timeout: config.gs1.timeoutMs,
    headers: { Authorization: `Bearer ${config.gs1.token}` }
  });

  const data = res.data ?? {};
  const items = data.items ?? data.data ?? data.products ?? [];
  const pageInfo = data.pageInfo ?? {};

  console.log("Response:");
  console.log("  HTTP Status:", res.status);
  console.log("  API status:", data.status);
  console.log("  API message:", data.message);
  console.log("  pageInfo:", JSON.stringify(pageInfo, null, 2));
  console.log("  items.length:", items.length);

  if (items.length > 0) {
    console.log("  First item keys:", Object.keys(items[0]).join(", "));
    console.log("  First item gtin:", items[0].gtin ?? items[0].GTIN ?? "N/A");
  } else {
    console.log("\n  Full response:", JSON.stringify(data, null, 2));
  }
  console.log("");
} catch (err) {
  console.error("Error:", err.message);
  if (err.response) {
    console.error("HTTP:", err.response.status);
    console.error("Body:", JSON.stringify(err.response.data).slice(0, 500));
  }
  process.exit(1);
}
