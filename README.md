# Bulk Validation Pipeline (Node.js)

Production-focused pipeline for GS1 cursor ingestion, rule validation, reliable downstream delivery, and run/daily reporting.

**Why we use a database:** See [docs/WHY_DATABASE.md](docs/WHY_DATABASE.md) for what PostgreSQL is used for (runs, checkpoints, validation results, delivery outbox, idempotency).

## 0) Local Setup (recommended first)

From project root:

```bash
cp .env.example .env
npm install
npm run docker:up
npm run migrate
```

Run API + workers in separate terminals:

```bash
npm run start
npm run worker:validation
npm run worker:delivery
```

When done:

```bash
npm run docker:down
```

## 1) VM Setup (free-first)

Run on your Ubuntu VM:

```bash
ssh root@<server-ip>
apt-get update && apt-get install -y git
git clone <your-repo-url> /opt/bulk-validation
cd /opt/bulk-validation
bash scripts/vm/bootstrap.sh
bash scripts/vm/setup_db.sh
cp .env.example .env
```

Set `.env` values (GS1 token, downstream URL, DB credentials), then:

```bash
npm ci
npm run migrate
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

**Note:** The PM2 config includes:
- a **scheduler worker** that automatically starts validation runs every 15 minutes
- optional **delivery delay**: set `DELIVERY_DELAY_HOURS=2` in `.env` to have validated batches wait 2 hours before the delivery worker sends them (fully automated; no manual start/stop)
- a **report-scheduler worker** that automatically generates reports every 2 hours
- an **hourly-publish worker** (cron every hour): set `HOURLY_PUBLISH_URL` in `.env`; it **PUT**s cumulative validated results for the day with body `{"data":[{ "GTIN_number", "Status", "Reason", "Date" }, ...]}`

**Validated outputs:**  
- **CSV:** Each validated batch appends to `outputs/<YYYY-MM-DD>/gtins_<YYYY-MM-DD>.csv` (columns: **GTIN_number**, **Status**, **Reason**, **Date**).  
- **Per-batch verification:** Each batch is also saved to `outputs/<YYYY-MM-DD>/batches/<runId>_<batchId>.json` so you can verify runs.

**VM deployment:** See **[docs/VM_DEPLOYMENT.md](docs/VM_DEPLOYMENT.md)** for the production flow. For **DB + everything on one VM at no extra cost**, see **[docs/VM_SETUP_FREE.md](docs/VM_SETUP_FREE.md)** (free-tier VM, Postgres and Redis on the same machine).

See `PRODUCTION_READINESS.md` for details.

## 2) Project Commands

```bash
npm run start
npm run worker:validation
npm run worker:delivery
npm run test
npm run loadtest
# Validate a previous day or date range (GS1 from/to) and write run + daily report outputs:
npm run validate:day              # default: yesterday
npm run validate:day -- 2026-02-19
npm run validate:day -- 2025-08-01 2026-01-12   # range (same as API from/to)
# or: FROM=2025-08-01 TO=2026-01-12 npm run validate:day
npm run check:newdata [runId]                   # Check if new data arrived and is being validated
npm run verify:continuous [date] [hours]        # Verify continuous validation is working (monitors for hours)
npm run monitor:reports -- <runId> <minutes>    # Monitor a run with detailed reports
npm run monitor:view [runId]                    # View monitoring dashboard for a run
```

## 3) API Endpoints

- `POST /v1/runs` with `{ "status": "pending", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD", "resultPerPage": 100 }`
- `GET /v1/runs/:runId`
- `POST /v1/runs/:runId/resume`
- `GET /v1/runs/:runId/report`
- `GET /v1/reports/daily?date=YYYY-MM-DD`
- `GET /metrics`
- `GET /healthz`

## 4) Learning Path (in build order)

1. **Infra basics**: VM hardening, process lifecycle (PM2), network edge (Nginx)
2. **Durability**: Postgres schema for runs/checkpoints/outbox/idempotency
3. **Queue decoupling**: BullMQ raw/validated queue flow
4. **Validation parity**: schema + business rule catalog implementation
5. **Reliable delivery**: retries, outbox, replay, idempotency keys
6. **Operations**: run reports, daily summaries, Prometheus metrics, alert thresholds
7. **Hardening**: 45k/day load profile and failure drills
