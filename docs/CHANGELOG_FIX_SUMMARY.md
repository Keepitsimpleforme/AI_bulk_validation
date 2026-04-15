# Validation Change Log and Fix Summary

## Context and Goal

The initial objective was to achieve end-to-end coverage parity:

- input records from GS1
- validated records in `validation_results`
- output delivery/reporting records

Target expectation: effectively 100% coverage for records that should be processed.

## Root Cause Learned During Coverage Work

During investigation, a key blocker was identified at source API behavior:

- offset/page style fetching had practical limits and gaps for large pending datasets
- this caused mismatch risk between source availability and pipeline processing

The architecture shifted to GS1 cursor-based pagination and checkpoint resume mechanics to close these gaps.

## Architecture / Pipeline Changes Introduced

Based on repository history and docs:

- Cursor-based ingestion and checkpointing
- Resume support for interrupted runs
- Queue decoupling (`raw_batches` -> `validated_batches`)
- Validation persistence (`validation_results`)
- Delivery idempotency + outbox replay
- Hourly publish + main-app CSV publication
- Backfill tooling for historical or missed windows
- Coverage verification and discrepancy analysis scripts

Reference commits include multiple coverage-related fixes and later architecture hardening (for example `2fa31d7`, `51de8e2`, `41e2c43`, `8e6b9b4`, `f9d20e5`, `53b05f0`, `de04b84`, `67305a9`, `2c55e86`, `761097c`, `172ad16`, `f3a85f3`).

## Validation Logic Fixes Recently Addressed

Recent rule logic updates in `src/validation/rules.js`:

- Exemption engine applied at rule-key level via `exempted_fields`
- MRP market-specific behavior:
  - if `target_market` is India -> MRP must be positive
  - if target market is non-India -> MRP value not mandatory
- Weight logic updates:
  - if net content unit is `each/piece/pieces/nos` -> skip all gross/net checks
  - otherwise gross/net values and units are mandatory
  - gross >= net comparison supports mass (`g`,`kg`) and volume (`ml`,`l`) conversions
  - unknown or cross-dimension units do not trigger numeric comparison

Primary related commits:

- `d6b7339` (exemption engine + weight logic refactor)
- `cb65667` (mandatory gross/net path and unitized-product handling refinement)

## What Was Fixed vs Not Addressed

### Fixed

- Market-specific MRP applicability (India vs non-India)
- Weight checks for `ml/l` added alongside `g/kg`
- Full weight-rule bypass for unitized products (`each/piece/pieces/nos`)
- Documentation alignment in `AI_Validation_Rulebook.html` with runtime behavior

### Not Addressed in This Change Set

- Broader unit-conversion matrix beyond current supported mass/volume synonyms
- Product-domain exceptions outside current exemption key model
- Any schema-level redesign (this work is business-rule level)
- Historical data backfill correctness for already-processed periods (handled via separate backfill/ops process, not this rule patch)

