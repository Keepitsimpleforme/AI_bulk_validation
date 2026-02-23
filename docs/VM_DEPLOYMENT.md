# VM deployment: run production flow end-to-end

This guide gets the full pipeline running on an Ubuntu VM so scheduler, ingestion, validation, delivery, hourly publish, and reports all run as in production. Validation outputs (gtins CSV + per-batch JSON) are written under the project’s **output** directory so you can verify behaviour; you can set the push URLs later.

**No extra cost:** PostgreSQL and Redis run on the **same VM** as the app. For full step-by-step setup (including a free VM and DB), see **[VM_SETUP_FREE.md](VM_SETUP_FREE.md)**.

---

## 1. Prerequisites

- Ubuntu VM (e.g. 22.04) with SSH access (root or sudo).
- Code on the VM (clone or copy the repo into `/opt/bulk-validation` or your chosen path).

---

## 2. Bootstrap the server (once)

On the VM, from the project root (e.g. `/opt/bulk-validation`):

```bash
sudo bash scripts/vm/bootstrap.sh
```

This installs/ensures: Node 20, Redis, PostgreSQL, Nginx, UFW; creates app user and `outputs` directory. Adjust `APP_DIR`, `APP_USER`, `NODE_MAJOR` via env if needed.

---

## 3. Database setup (once)

```bash
sudo bash scripts/vm/setup_db.sh
```

Creates DB and user (default: `bulk_validation` / `bulk_user` / `bulk_pass`). Override with `DB_NAME`, `DB_USER`, `DB_PASS` if needed.

---

## 4. App setup (project directory)

Assume you’re in the project root (e.g. `/opt/bulk-validation`). If you copied code as root, fix ownership:

```bash
sudo chown -R bulkapp:bulkapp /opt/bulk-validation
```

As the app user (or the user that will run the app):

```bash
cd /opt/bulk-validation
cp .env.example .env
```

Edit `.env` and set at least:

- **GS1_TOKEN** – required for ingestion.
- **DATABASE_URL** – e.g. `postgres://bulk_user:bulk_pass@127.0.0.1:5432/bulk_validation`
- **REDIS_URL** – e.g. `redis://127.0.0.1:6379`

You can leave these for later (no push until you set them):

- **DOWNSTREAM_URL** – batch delivery (PUT). Leave empty or set to a stub if you don’t want to push yet.
- **HOURLY_PUBLISH_URL** – hourly cumulative validated results (PUT, body `{"data":[...]}`). e.g. `http://localhost:3000/store_product_auto_validate`.

Optional:

- **DELIVERY_DELAY_HOURS** – e.g. `2` to delay delivery by 2 hours.
- **PORT** – API port (default 3000).

Then:

```bash
npm ci
npm run migrate
```

---

## 5. Start the full production stack (PM2)

Still in project root:

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

Run the command that `pm2 startup` prints (usually a `sudo env ... pm2 startup` line) so PM2 comes back after reboot.

What runs:

| Process            | Role                                      |
|--------------------|-------------------------------------------|
| bulk-api           | API + ingestion (runs when a run is started) |
| worker-validation  | Validates batches, writes outputs         |
| worker-delivery    | Sends validated batches to DOWNSTREAM_URL |
| worker-outbox-replay | Retries failed deliveries (cron 10 min) |
| scheduler          | Starts a run for today every 15 min (cron) |
| report-scheduler   | Run + daily reports every 2 h (cron)      |
| hourly-publish     | PUTs cumulative day results every hour (cron), body `{"data":[...]}` |

---

## 6. Verify: outputs and health

- **Output directory (for checking that code is working)**  
  All paths below are under the project root (e.g. `/opt/bulk-validation`).

  - **Daily gtins CSV (append per batch)**  
    `outputs/<YYYY-MM-DD>/gtins_<YYYY-MM-DD>.csv`  
    Columns: `GTIN_number`, `Status`, `Reason`, `Date`.

  - **Per-batch validation records (one file per batch)**  
    `outputs/<YYYY-MM-DD>/batches/<runId>_<batchId>.json`  
    JSON array of `{ GTIN_number, Status, Reason, Date }` for that batch. Use these to verify each batch run.

  - **Run reports**  
    `outputs/<date>/runs/<runId>/` (run report, validation results CSV, etc.) and daily summaries.

- **Health**

  ```bash
  curl -s http://127.0.0.1:3000/healthz
  ```

- **PM2**

  ```bash
  pm2 list
  pm2 logs
  ```

- **Runs**  
  After ~15 minutes the scheduler will have started a run. Check run status (replace `<runId>` with an id from logs or DB):

  ```bash
  npm run check:newdata -- <runId>
  ```

---

## 7. When you’re ready: set push URLs

Update `.env`:

- **DOWNSTREAM_URL** – URL for batch delivery (PUT). Restart delivery worker after change:  
  `pm2 restart worker-delivery`
- **HOURLY_PUBLISH_URL** – URL for hourly cumulative validated results (PUT, body `{"data":[...]}`). Restart not required; next hourly cron will use the new value.

No code change needed; the existing logic for pushing validated results (hourly updates to the pushing URL) stays the same. The only addition is writing each batch’s validation records under `outputs/` so you can confirm the pipeline is working before and after setting these URLs.

---

## 8. Quick reference

| Task              | Command / location |
|-------------------|--------------------|
| Logs              | `pm2 logs`         |
| Restart all       | `pm2 restart all`  |
| Outputs           | `outputs/<date>/gtins_*.csv`, `outputs/<date>/batches/*.json`, `outputs/<date>/runs/` |
| Env template      | `.env.example`     |
| Migrations        | `npm run migrate`  |
