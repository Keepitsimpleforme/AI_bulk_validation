import test from "node:test";
import assert from "node:assert/strict";
import { validateBusinessRules } from "./rules.js";

const base = {
  gtin: "8901234567890",
  activation_date: "2026-02-10",
  deactivation_date: "2026-12-10",
  brand: "ACME",
  name: "Good Product",
  description: "Desc",
  category: "non-food",
  sub_category: "general",
  company_detail: { name: "ACME Pvt" },
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
  ]
};

test("accepts valid non-food product", () => {
  const result = validateBusinessRules(base);
  assert.equal(result.status, "Accepted");
  assert.equal(result.reasons.length, 0);
});

test("rejects invalid date and required fields", () => {
  const result = validateBusinessRules({
    ...base,
    activation_date: "10-02-2026",
    brand: ""
  });
  assert.equal(result.status, "Rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("Activation Date")));
  assert.ok(result.reasons.some((reason) => reason.includes("Brand Name")));
});

test("rejects invalid food-specific fields", () => {
  const result = validateBusinessRules({
    ...base,
    category: "food",
    attributes: {
      regulatory_data: { child: { fssai_lic: { _no: "123" }, food_type: "" } },
      shelf_life: { child: { value: "", unit: "", based_on: "" } }
    }
  });
  assert.equal(result.status, "Rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("FSSAI NUMBER")));
  assert.ok(result.reasons.some((reason) => reason.includes("Shelf Life")));
});
