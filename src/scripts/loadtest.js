import { randomUUID } from "node:crypto";
import { rawBatchesQueue } from "../lib/queues.js";
import { logger } from "../lib/logger.js";
import { db } from "../lib/db.js";

const totalItems = Number(process.env.LOADTEST_TOTAL_ITEMS ?? 45000);
const batchSize = Number(process.env.LOADTEST_BATCH_SIZE ?? 100);
const runId = process.env.LOADTEST_RUN_ID ?? randomUUID();
const runStatusFilter = process.env.LOADTEST_STATUS_FILTER ?? "pending";
const runDate = process.env.LOADTEST_DATE ?? "2026-02-10";
const runResultPerPage = Number(process.env.LOADTEST_RESULT_PER_PAGE ?? 100);

const makeItem = (i) => ({
  gtin: `890${String(i).padStart(10, "0")}`,
  activation_date: "2026-02-10",
  deactivation_date: "2026-12-10",
  brand: "Test Brand",
  name: `Product ${i}`,
  description: "Load test product",
  category: i % 3 === 0 ? "food" : "non-food",
  sub_category: "general",
  company_detail: { name: "ACME" },
  hs_code: "1234",
  igst: "18",
  measurement_unit: "g",
  net_content: "500",
  mrp: [
    {
      mrp: "100",
      target_market: "IN",
      activation_date: "2026-02-10",
      location: "IN"
    }
  ],
  attributes: {
    regulatory_data: {
      child: {
        fssai_lic: { _no: "12345678901234" },
        food_type: "veg"
      }
    },
    shelf_life: { child: { value: "12", unit: "month", based_on: "mfg" } }
  }
});

const run = async () => {
  await db.query(
    `INSERT INTO runs (
       run_id, status, status_filter, from_date, to_date, result_per_page,
       pages_fetched, items_fetched, ingestion_completed
     )
     VALUES ($1, 'RUNNING', $2, $3::date, $3::date, $4, $5, $6, TRUE)
     ON CONFLICT (run_id) DO NOTHING`,
    [runId, runStatusFilter, runDate, runResultPerPage, Math.ceil(totalItems / batchSize), totalItems]
  );

  let sent = 0;
  let seq = 0;
  while (sent < totalItems) {
    const size = Math.min(batchSize, totalItems - sent);
    const items = Array.from({ length: size }, (_, idx) => makeItem(sent + idx + 1));
    seq += 1;
    await rawBatchesQueue.add("validate-batch", {
      runId,
      batchId: randomUUID(),
      sourcePageSeq: seq,
      cursorIn: null,
      cursorOut: null,
      items
    });
    sent += size;
  }
  logger.info(
    { runId, totalItems, batchSize, jobs: seq, runDate, runStatusFilter },
    "load test batches enqueued"
  );
};

run()
  .then(async () => {
    await db.end();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error({ err: error }, "load test enqueue failed");
    await db.end();
    process.exit(1);
  });
