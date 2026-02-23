# Running with Docker

Run the full pipeline (Postgres, Redis, API, workers) with Docker Compose. No need to install Node, Postgres, or Redis on the host.

---

## Prerequisites

- Docker and Docker Compose v2 (`docker compose` or `docker-compose`) on the host (VM or laptop).
- A `.env` file with at least `GS1_TOKEN`. Copy from `.env.example`.

---

## Quick start

```bash
# 1. From project root
cd /path/to/AI_Bulk   # or bulk-validation

# 2. Create .env (copy from .env.example and set GS1_TOKEN, etc.)
cp .env.example .env
# Edit .env and set GS1_TOKEN, HOURLY_PUBLISH_URL, DOWNSTREAM_URL as needed.

# 3. Start Postgres and Redis, run migrations, then start all services
docker compose up -d postgres redis
docker compose run --rm migrate
docker compose up -d

# 4. Check
docker compose ps
curl -s http://localhost:3000/healthz
```

`outputs/` (gtins CSV, batch JSON, reports) is mounted from the host at `./outputs`.

---

## What runs

| Service             | Role |
|---------------------|------|
| postgres            | PostgreSQL 16 |
| redis               | Redis 7 |
| app                 | API + ingestion (port 3000) |
| worker-validation   | Validation worker |
| worker-delivery     | Delivery worker |
| worker-outbox-replay| Retries failed delivery every 10 min |
| scheduler           | Starts a run for today every 15 min |
| report-scheduler    | Run + daily reports every 2 h |
| hourly-publish      | PUTs cumulative day results every hour |

Compose overrides `DATABASE_URL` and `REDIS_URL` to use the `postgres` and `redis` services. Other vars (e.g. `GS1_TOKEN`, `HOURLY_PUBLISH_URL`) come from `.env`.

---

## Commands

```bash
# Start everything (builds image first time)
docker compose up -d

# Run migrations only (one-off)
docker compose run --rm migrate

# View logs
docker compose logs -f
docker compose logs -f app worker-validation

# Stop
docker compose down

# Stop and remove DB/Redis data
docker compose down -v
```

---

## On the VM (e.g. CentOS)

If Docker isn’t installed:

```bash
# CentOS 7
sudo yum install -y yum-utils
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl start docker
sudo systemctl enable docker
```

Then clone the repo, add `.env`, and run:

```bash
cd /root/midas-gs1/AI_Bulk
docker compose up -d postgres redis
docker compose run --rm migrate
docker compose up -d
```

---

## Optional: API base URL

The scheduler starts runs by calling the API. In Docker it uses `API_BASE_URL=http://app:3000`. For local runs you can set `API_BASE_URL` in `.env` if the API is on another host/port.

---

## Debugging and getting validated data

To see whether the system is fetching from GS1, validating, and writing to the DB:

**1. Run the diagnostic (DB + queues + config summary)**

```bash
docker compose run --rm app node src/scripts/diagnose.js
```

Or locally (with the same `DATABASE_URL` and `REDIS_URL` as the app):

```bash
npm run diagnose
```

This prints: latest runs (status, items_fetched, validated_count), validation result count for today, queue depths, and whether `GS1_TOKEN` / URLs are set.

**2. Check logs**

- Scheduler (starts a run for today every 15 min):  
  `docker compose logs scheduler --tail 30`
- API + ingestion (fetches from GS1, enqueues batches):  
  `docker compose logs app --tail 50`
- Validation worker:  
  `docker compose logs worker-validation --tail 30`

**3. If there are no runs or you want to force a run**

```bash
# Replace YYYY-MM-DD with today’s date (e.g. 2026-02-23)
curl -X POST http://localhost:3000/v1/runs \
  -H "Content-Type: application/json" \
  -d '{"status":"pending","from":"YYYY-MM-DD","to":"YYYY-MM-DD","resultPerPage":100}'
```

Then run `diagnose` again or check a specific run:

```bash
npm run check:newdata -- <runId>
```

**4. If a run exists but `items_fetched` stays 0**

- Ingestion is likely failing (e.g. GS1 401). Set a valid `GS1_TOKEN` in `.env` and restart:  
  `docker compose up -d app`
- Confirm with app logs:  
  `docker compose logs app --tail 50`

**5. Once there is validated data for today**

- The **hourly-publish** container PUTs cumulative results to `HOURLY_PUBLISH_URL` every hour. No extra step needed.
- To test once:  
  `docker compose run --rm hourly-publish`
