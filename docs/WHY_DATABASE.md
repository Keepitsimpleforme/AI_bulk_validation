# Why we use a database

The pipeline uses **PostgreSQL** for durable state that survives restarts and supports correctness guarantees. Below is what each part is used for.

---

## Tables and purpose

| Table | Why we need it |
|-------|----------------|
| **runs** | One row per validation run: status, date range, counts (items_fetched, validated_count, delivered_count, etc.). Needed to know run state, show progress, and decide when a run is finished. Survives process restarts so we don’t lose track of runs. |
| **run_checkpoints** | Stores the GS1 cursor (cursor_out) per run. If ingestion stops (crash, deploy), we can **resume** from the last checkpoint instead of re-fetching from the start. |
| **validation_results** | Every validated record (gtin, status, reasons, etc.) is stored here. Used for: **hourly publish** (cumulative results for the day), **reports**, **CSV/JSON outputs**, and auditing. Queues are in-memory (Redis); the DB is the source of truth for what was validated. |
| **delivery_outbox** | When delivery to the downstream fails, the batch is written here. The **outbox-replay** worker retries these rows later. This gives **at-least-once delivery** even after restarts. |
| **idempotency_keys** | Records which records were successfully delivered (by a key derived from gtin + dates + status). Used to avoid **duplicate delivery** if the same batch is retried. |
| **batch_events** | Audit trail of batches (enqueued, etc.); supports debugging and analytics. |

---

## Why not only Redis or only files?

- **Redis** is used for **queues** (raw_batches, validated_batches): fast, decouples workers, supports retries and delays. It is not used as the only store of run state or validation results, because we need durable, queryable history and the ability to resume and report.
- **Files** (e.g. CSV under `outputs/`) are **outputs** for humans and for verification. The DB remains the source of truth so we can regenerate reports, run hourly publish from a single query, and resume safely.

---

## Summary

The database is used so that:

1. **Runs and progress** are durable and visible across restarts.
2. **Ingestion can resume** from the last cursor (checkpoints).
3. **Validation results** are stored once and used for hourly publish, reports, and outputs.
4. **Delivery** is reliable (outbox + idempotency) even when the downstream or the process fails.

Without the DB we would lose run state on restart, couldn’t resume ingestion reliably, couldn’t do hourly cumulative publish from a single consistent view, and would risk duplicate or lost delivery.
