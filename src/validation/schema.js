import { z } from "zod";

// productSchema is used as a structural gate in validationService.js:
// `safeParse(...).success` decides whether an item is schema-valid (has gtin
// and activation_date). Downstream business rules read from the normalized
// object directly — not from schemaResult.data — so we don't list every field
// the rules care about here. Do NOT pass schemaResult.data into the rules:
// any unknown keys (gross_weight, attributes, exempted_fields, ...) would be
// stripped and break the rule evaluation.
const nonEmptyString = z.coerce.string().trim().min(1);

export const productSchema = z.object({
  gtin: nonEmptyString,
  activation_date: nonEmptyString,
  deactivation_date: z.coerce.string().trim().optional().nullable(),
  brand: z.any().optional(),
  name: z.any().optional(),
  description: z.any().optional(),
  category: z.any().optional(),
  sub_category: z.any().optional(),
  company_detail: z
    .object({
      name: z.any().optional()
    })
    .optional(),
  hs_code: z.any().optional(),
  igst: z.any().optional(),
  measurement_unit: z.any().optional(),
  net_content: z.any().optional(),
  weights_and_measures: z
    .object({
      measurement_unit: z.any().optional(),
      net_content: z.any().optional()
    })
    .optional(),
  mrp: z
    .array(
      z.object({
        mrp: z.any().optional(),
        target_market: z.any().optional(),
        activation_date: z.any().optional(),
        location: z.any().optional()
      })
    )
    .optional()
    .default([])
});
