import { config } from "../config.js";
import { validatedBatchesQueue } from "../lib/queues.js";
import { metrics } from "../lib/metrics.js";
import { incrementRunCounters, tryFinalizeRun } from "../repositories/runRepository.js";
import { insertValidationResults } from "../repositories/validationRepository.js";
import { appendToGtinsCsv, saveBatchValidationRecords } from "./gtinsCsvService.js";
import { productSchema } from "../validation/schema.js";
import { validateBusinessRules } from "../validation/rules.js";
import { normalizeProduct } from "../validation/normalize.js";

export const processRawBatch = async (payload) => {
  const normalizedRecords = [];
  let schemaInvalid = 0;
  let accepted = 0;
  let rejected = 0;

  for (const item of payload.items ?? []) {
    const normalizedItem = normalizeProduct(item);
    const schemaResult = productSchema.safeParse(normalizedItem);
    if (!schemaResult.success) {
      schemaInvalid += 1;
      normalizedRecords.push({
        runId: payload.runId,
        batchId: payload.batchId,
        gtin: String(item?.gtin ?? ""),
        validationStatus: "Rejected",
        reasons: ["Schema validation failed"],
        schemaValid: false,
        businessValid: false,
        productSnapshot: item ?? null
      });
      continue;
    }

    // Pass the normalized item — NOT schemaResult.data — to the business rules.
    // Zod strips undeclared keys, which would remove gross_weight/net_weight
    // (lifted by normalize), `attributes` (FSSAI/shelf_life), and
    // `exempted_fields` (exemption engine). The schema check above is purely
    // a gate; the canonical product shape lives in normalizeProduct.
    const business = validateBusinessRules(normalizedItem);
    const isAccepted = business.status === "Accepted";
    if (isAccepted) accepted += 1;
    else rejected += 1;

    normalizedRecords.push({
      runId: payload.runId,
      batchId: payload.batchId,
      gtin: normalizedItem.gtin,
      validationStatus: business.status,
      reasons: business.reasons,
      schemaValid: true,
      businessValid: isAccepted,
      productSnapshot: item ?? null
    });
  }

  await insertValidationResults(normalizedRecords);
  const dateKey = payload.fromDate ? String(payload.fromDate).slice(0, 10) : null;
  if (dateKey) {
    await appendToGtinsCsv(dateKey, normalizedRecords, "outputs");
    await saveBatchValidationRecords(dateKey, payload.runId, payload.batchId, normalizedRecords, "outputs");
  }
  const jobOpts = config.downstream.delayMs > 0 ? { delay: config.downstream.delayMs } : undefined;
  await validatedBatchesQueue.add(
    "deliver-batch",
    { ...payload, validatedRecords: normalizedRecords },
    jobOpts
  );

  await incrementRunCounters(payload.runId, {
    schema_invalid: schemaInvalid,
    validated_count: normalizedRecords.length,
    accepted_count: accepted,
    rejected_count: rejected
  });
  // Finalize when validation catches up with fetched count, even if delivery is disabled.
  await tryFinalizeRun(payload.runId);

  metrics.validationItemsTotal.inc(normalizedRecords.length);
  metrics.validationAcceptedTotal.inc(accepted);
  metrics.validationRejectedTotal.inc(rejected);
};
