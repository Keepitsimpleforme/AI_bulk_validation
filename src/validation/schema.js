import { z } from "zod";

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
