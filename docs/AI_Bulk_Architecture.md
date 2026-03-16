# AI_Bulk Validation Pipeline — Architecture
*Version 1.1 · Single source of truth for the ingestion-to-delivery pipeline.*

## 1. Overview
AI_Bulk is a Node.js pipeline that fetches GS1 product records on a 15-minute schedule, validates each item against schema and business rules, and delivers accepted batches to a downstream service. All state is persisted in PostgreSQL; inter-stage communication uses BullMQ queues backed by Redis.

| Stage | Input | Output |
| :--- | :--- | :--- |
| **Scheduler** (15 min) | System clock · today (IST) | New run or resume existing run |
| **Ingestion** | GS1 cursor API | `raw_batches` queue · checkpoints · run counters |
| **Validation** | `raw_batches` jobs | `validation_results` · `validated_batches` queue |
| **Delivery** | `validated_batches` jobs | `PUT` to `DOWNSTREAM_URL` · idempotency keys |
| **Outbox Replay** | `delivery_outbox` (failed) | Retry `PUT` to `DOWNSTREAM_URL` |
| **Hourly Publish** | `validation_results` (today) | `PUT` to dashboard & main-app endpoints |
| **Main-App CSV** | `validation_results` (today) | `POST` CSV to `MAIN_APP_CSV_URL` |

## 2. Ingestion
### 2.1 Trigger Sources
| Source | Behaviour |
| :--- | :--- |
| **Scheduler** | Every 15 min: resume a stalled run, or create a new one for today (IST) if none is active and no recent success. |
| **API — POST /v1/runs** | Creates run with from/to dates and optional startCursor; launches `ingestRun` in background. |
| **API — POST /v1/runs/:id/resume** | Restarts a run from its last checkpoint `cursor_out`. |

### 2.2 Backfill Ingestion & Historical Runs (New)
For validating historical or pending items bypassing the strict 12,000 GS1 API limit, manual backfills can be triggered via CLI. Backfill skips previously validated GTINs automatically.

You can customize backfills using the following environments and arguments: 

**Arguments:**
- `--from <YYYY-MM-DD>`: Start date for the chunk.
- `--to <YYYY-MM-DD>`: End date for the chunk.

**Environment Variables:**
- `BACKFILL_RESULT_PER_PAGE=100`: Increases items fetched per request (default `10`), speeding up massive backfills significantly.

**Possible Types of Runs:**
```bash
# 1. Standard Run: Fetches all pending items from all time (caps at 12,000 items)
npm run backfill

# 2. Date-Filtered Run: Fetches pending items explicitly created within a date window
npm run backfill -- --from 2024-01-01 --to 2024-06-30

# 3. High-Speed Date-Filtered Run: Uses 100 items per page to maximize network efficiency
BACKFILL_RESULT_PER_PAGE=100 npm run backfill -- --from 2026-03-15 --to 2026-03-16

# 4. Hourly Publish Force Push: Forces the hourly worker to publish legacy payloads (chunked automatically by 5,000 records) to Downstream Dashboards
HOURLY_PUBLISH_TIMEOUT_MS=300000 npm run worker:hourly-publish -- "2026-03-11"
```

### 2.3 Ingestion Loop
`ingestionService.js` runs the following steps per page until `hasNextPage` is false or the raw queue exceeds `RAW_QUEUE_HIGH_WATERMARK` (default 200 jobs):

1. **Backpressure check**: Abort loop if `raw_batches` depth > watermark.
2. **Fetch page**: `fetchGs1Page()` — cursor mode (`paginate=cursor`, `resultperPage` from run config). Note: Backfills use `sortBy=created_date`.
3. **Enqueue**: Add job to `raw_batches` with `runId`, `batchId`, items, cursor metadata.
4. **Persist**: `insertBatchEvent()`, `upsertCheckpoint()`, `incrementRunCounters()`.
5. **Advance**: Set `cursor` = `nextCursor`, repeat.
6. **Finalise**: `markIngestionCompleted(runId)`, `tryFinalizeRun(runId)`.

### 2.4 Cross-Run Cursor
When creating a new run the API calls `getLastRunCheckpointForDate(from)`. Only cursors from runs with `items_fetched > 0` and `ingestion_completed = false` are reused, preventing replay of an end-of-stream cursor that returns 0 items.

## 3. Queues (BullMQ + Redis)
| Queue | Purpose | Producer | Consumer |
| :--- | :--- | :--- | :--- |
| `raw_batches` | GS1 batches awaiting validation | Ingestion loop | `worker-validation` |
| `validated_batches` | Validated records awaiting delivery | `worker-validation` | `worker-delivery` |
| `dead_letter` | Reserved for undeliverable jobs | — | — |

Concurrency is controlled per queue via `RAW_QUEUE_CONCURRENCY` and `VALIDATED_QUEUE_CONCURRENCY`. An optional `DELIVERY_DELAY_HOURS` setting holds validated jobs before they become processable.

## 4. Validation
`validationWorker.js` consumes `raw_batches` jobs and delegates each to `validationService.js`, which applies the following pipeline per item:
1. **Normalise**: Standardise field names and types.
2. **Schema validate**: Zod schema check → `schemaValid` flag.
3. **Business rules**: Domain-specific constraints → `businessValid` flag + reasons array.
4. **Persist**: Insert into `validation_results` (`gtin`, `validationStatus`, `productSnapshot JSONB`, …).
5. **Output files**: Append to `outputs/<date>/gtins.csv` and batch JSON.
6. **Enqueue**: Push to `validated_batches` with `validatedRecords` payload.
7. **Counters**: Increment `validated_count`, `accepted_count`, `rejected_count`, `schema_invalid` on run row.

## 5. Database Schema (PostgreSQL)
| Table | Purpose |
| :--- | :--- |
| `runs` | One row per run: status, date range, `result_per_page`, `ingestion_completed`, all counters. |
| `run_checkpoints` | Latest cursor per run (`cursor_in` / `cursor_out`). Used for resume and cross-run cursor. |
| `batch_events` | One row per batch: `batch_id`, `run_id`, page seq, item count, event type. |
| `validation_results` | One row per product: `gtin`, `validation_status`, reasons (JSONB), `product_snapshot` (JSONB). |
| `idempotency_keys` | Per-delivery key (`run_id` + `batch_id`) to prevent duplicate delivery. |
| `delivery_outbox` | Failed delivery payloads for retry: attempts, `next_retry_at`, last_error. |
| `schema_migrations` | Migration version tracking. |

Key relationships: `runs` → `run_checkpoints` (1:1), `batch_events` (1:N), `validation_results` (1:N). Batches are logical — identified by `batch_id` across `batch_events` and `validation_results`.

## 6. Delivery
| Component | Behaviour |
| :--- | :--- |
| `deliveryWorker.js` | Consumes `validated_batches`; calls `deliverValidatedBatch()` per job. |
| `deliveryService.js` | `PUT` `{ data: validatedRecords }` to `DOWNSTREAM_URL`. On success: save idempotency keys, increment `delivered_count`, `tryFinalizeRun()`. On failure: increment `delivery_failed_count`, write to `delivery_outbox`. |
| `outboxReplayWorker.js` | Polls every 10 min; retries due outbox rows; backs off or marks delivered. |

## 7. Publish
| Worker | Interval | Action |
| :--- | :--- | :--- |
| `hourlyPublishWorker.js` | Every 60 min | Deduplicate today's `validation_results` by GTIN → chunk payload to 5000 max → `PUT` to `HOURLY_PUBLISH_URL` and `MAIN_APP_PUBLISH_URL`. |
| `mainAppCsvWorker.js` | Every 60 min | Same dataset → `buildMainAppCsv()` → `POST` CSV to `MAIN_APP_CSV_URL` (if configured). |
| `reportSchedulerWorker.js` | Every 2 h | Generate run reports and daily summary JSON/CSV to `outputs/`. |

## 8. API Endpoints
| Method | Path | Purpose |
| :--- | :--- | :--- |
| GET | `/healthz` | Health check. |
| GET | `/metrics` | Prometheus metrics. |
| POST | `/v1/runs` | Create run (body: from, to, resultPerPage, optional startCursor). |
| GET | `/v1/runs/:runId` | Run details. |
| POST | `/v1/runs/:runId/resume` | Resume run from checkpoint. |
| GET | `/v1/runs/:runId/report` | Run report. |
| GET | `/v1/runs/:runId/results.csv` | CSV export of validation results. |
| GET | `/v1/reports/daily` | Daily summary (query param: date). |

## 9. Configuration (Environment Variables)
| Variable | Purpose |
| :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `REDIS_URL` | Redis connection for BullMQ. |
| `GS1_TOKEN`, `GS1_BASE_URL` | GS1 API credentials and routing. |
| `DOWNSTREAM_URL`, `DELIVERY_DELAY_HOURS` | Validated batch delivery target and optional hold time. |
| `HOURLY_PUBLISH_URL`, `MAIN_APP_PUBLISH_URL` | Dashboard and main-app push endpoints. |
| `MAIN_APP_CSV_URL` | Optional CSV POST target. |
| `API_BASE_URL` | Scheduler-to-app address. |
| `RAW_QUEUE_HIGH_WATERMARK` | Backpressure threshold for ingestion loop (default 200). |
| `BACKFILL_RESULT_PER_PAGE` | Override default GS1 page fetch size for intensive backfills. |

## 10. Docker Topology
| Service | Command | Notes |
| :--- | :--- | :--- |
| `postgres` | `postgres:16-alpine` | Port 5432 |
| `redis` | `redis:7-alpine` | Port 6379 |
| `migrate` | `node src/scripts/migrate.js` | One-off; applies SQL migrations. |
| `app` | `node src/index.js` | Port 3000; API + ingestion orchestrator. |
| `worker-validation` | `node src/workers/validationWorker.js` | Concurrency via env. |
| `worker-delivery` | `node src/workers/deliveryWorker.js` | Concurrency via env. |
| `worker-outbox-replay`| `node src/workers/outboxReplayWorker.js` | Runs every 600 s. |
| `scheduler` | `node src/workers/schedulerWorker.js` | Runs every 900 s. |
| `report-scheduler` | `node src/workers/reportSchedulerWorker.js` | Runs every 7 200 s. |
| `hourly-publish` | `node src/workers/hourlyPublishWorker.js` | Every 3 600 s; host.docker.internal access. |
| `main-app-csv` | `node src/workers/mainAppCsvWorker.js`| Every 3 600 s; host.docker.internal access. |

## 11. Key Files Reference
| Layer | Files |
| :--- | :--- |
| **Entry** | `src/index.js` · `src/api/runRoutes.js` |
| **Ingestion** | `src/services/ingestionService.js` · `src/services/gs1Client.js` |
| **Queues** | `src/lib/queues.js` · `src/lib/redis.js` |
| **Validation** | `src/workers/validationWorker.js` · `src/services/validationService.js` |
| **Delivery** | `src/workers/deliveryWorker.js` · `src/services/deliveryService.js` |
| **Scheduler** | `src/workers/schedulerWorker.js` |
| **Publish** | `src/workers/hourlyPublishWorker.js` · `src/workers/mainAppCsvWorker.js` |
| **Repository** | `src/repositories/runRepository.js` · `validationRepository.js` |

## 12. Debug & Supporting Scripts
### Diagnostics & Health
| Script | Command | Purpose |
| :--- | :--- | :--- |
| `diagnose.js` | `npm run diagnose` | Latest runs, today's validation count, queue depths. |
| `diagnoseRuns.js` | `node … YYYY-MM-DD` | Per-date run list with counters and unique GTINs. |
| `verifyCoverage.js` | `npm run verify:coverage` | Compares GS1 GTINs with DB; reports coverage. |
| `checkGs1Api.js` | `npm run check:gs1` | One-off GS1 connectivity and sample cursor response. |
| `checkNewData.js` | `npm run check:newdata` | Quick run status: GS1 total vs fetched vs validated. |

### Analysis, Monitoring & Operations
| Script | Command | Purpose |
| :--- | :--- | :--- |
| `runBackfill.js` | `npm run backfill` | Retrieve missing historical validation pending items efficiently. |
| `analyzeDiscrepancy.js`| `npm run analyze:discrepancy` | Duplicate detection; compares DB count vs GS1 total. |
| `monitorRun.js` | `npm run monitor` | Live polling of run status and GS1 vs fetched. |
| `runPreviousDay.js` | `npm run validate:day` | Start a run for a date range (default: yesterday). |
| `migrate.js` | `npm run migrate` | Applies SQL migrations. |
| `health-check.sh` | `scripts/vm/health-check.sh` | Docker, PM2, API, Redis, Postgres health check. |
| `deploy.sh` | `scripts/vm/deploy.sh` | Git-based deploy: pull → build → migrate → up. |
