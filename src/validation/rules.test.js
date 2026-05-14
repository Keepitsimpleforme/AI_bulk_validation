import test from "node:test";
import assert from "node:assert/strict";
import { validateBusinessRules } from "./rules.js";
import { normalizeProduct } from "./normalize.js";
import { productSchema } from "./schema.js";

// Mirrors validationService.js: normalize → schema gate → business rules.
// The schema is used only as a yes/no gate; the rules read from the
// normalized object directly so they see every field normalize lifted.
const runFullPipeline = (raw) => {
  const normalized = normalizeProduct(raw);
  const parsed = productSchema.safeParse(normalized);
  if (!parsed.success) {
    return { status: "SchemaInvalid", reasons: ["Schema validation failed"] };
  }
  return validateBusinessRules(normalized);
};

const base = {
  brand: "ANNAI ARAVINDH HERBALS PVT LTD",
  name: "Gokshuradi Guggulu 500Mg Tablet 60 Nos",
  description: "Gokshuradi Guggulu 500Mg Tablet 60 Nos",
  derived_description: "ANNAI ARAVINDH HERBALS PVT LTD Gokshuradi Guggulu 500Mg Tablet 60 Nos case 60 each",
  gtin: 8906183052619,
  country_of_origin: "India",
  category: "Health Care",
  sub_category: "Ayurvedic Health Care Products",
  activation_date: "2026-04-07",
  deactivation_date: "2041-04-07",
  created_date: "2026-04-07 05:13:54",
  modified_date: "2026-04-07 05:13:54",
  type: "basic",
  packaging_type: "Primary",
  primary_gtin: "",
  images: {},
  company_detail: {
    name: "ANNAI ARAVINDH HERBALS PRIVATE LIMITED",
    gcp: 890618305,
    address: {
      address1: "No.1,2&3(First Floor), Seemathamman Colony,",
      address2: "Mettukuppam Pattai, Maduravoyal",
      city: "CHENNAI",
      state: "Tamil Nadu",
      country: "India",
      pincode: "600095"
    }
  },
  weights_and_measures: {
    measurement_unit: "each",
    net_content: "60 each",
    gross_weight: "600",
    net_weight: "500"
  },
  dimensions: {
    measurement_unit: "",
    height: null,
    width: null,
    depth: null
  },

  case_configuration: [],
  mrp: [
    {
      mrp: 165,
      target_market: "India",
      activation_date: "2026-04-07",
      currency: "Rupees",
      location: "Tamil Nadu"
    }
  ],
  hs_code: "30039013",
  igst: "5",
  sgst: "2.5",
  cgst: "2.5",
  attributes: {
    "product_listing_page_url_(marketplace/e-commerce_sites)": "Marketplace / E-commerce sites"
  },
  exempted_fields: []
};

export const baseFood = {
  brand: "Rosanna",
  name: "Gulkand (Damask Rose)",
  description: "Rosanna Gulkand is a premium rose preserve...",
  derived_description: "Rosanna Gulkand (Damask Rose) case 250 g",
  gtin: 8908030315007,
  country_of_origin: "India",
  category: "Food",
  sub_category: "Prepared/Preserved Foods",
  activation_date: "2026-04-05",
  deactivation_date: "2045-04-01",
  created_date: "2026-04-05 11:41:56",
  modified_date: "2026-04-06 20:23:38",
  type: "basic",
  packaging_type: "Primary",
  primary_gtin: "",
  images: {},
  company_detail: {
    name: "ROSANNA",
    gcp: 8908030315,
    address: {
      address1: "No. 3, SBM Colony, 2nd Main 3rd Cross,",
      address2: "Behind Khodeys Factory, Chunchagatta",
      city: "Bengaluru",
      state: "Karnataka",
      country: "India",
      pincode: "560062"
    }
  },
  weights_and_measures: {
    measurement_unit: "g",
    net_content: "250 g",
    gross_weight: "300",
    net_weight: "250"
  },
  dimensions: {
    measurement_unit: "",
    height: null,
    width: null,
    depth: null
  },

  case_configuration: [],
  mrp: [
    {
      mrp: 299,
      target_market: "India",
      activation_date: "2026-04-05",
      currency: "Rupees",
      location: "Pan India"
    }
  ],
  hs_code: "20060000",
  igst: "5",
  sgst: "2.5",
  cgst: "2.5",
  attributes: {
    regulatory_data: {
      child: {
        "fssai_lic._no.": "11226998000057",
        food_type: "Veg",
        vegan: "Yes"
      }
    },
    shelf_life: {
      child: {
        value: "12",
        unit: "Months",
        based_on: "Manufacturing Date"
      }
    },
    conveyable: "Yes",
    "bio-degradable_packaging": "No"
  },
  exempted_fields: []
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

test("allows missing MRP value when target market is non-India", () => {
  const result = validateBusinessRules({
    ...base,
    mrp: [
      {
        ...base.mrp[0],
        target_market: "UAE",
        mrp: ""
      }
    ]
  });
  assert.equal(result.status, "Accepted");
  assert.ok(!result.reasons.some((reason) => reason.includes("MRP:")));
});

test("rejects invalid MRP value when target market is India", () => {
  const result = validateBusinessRules({
    ...base,
    mrp: [
      {
        ...base.mrp[0],
        target_market: "India",
        mrp: 0
      }
    ]
  });
  assert.equal(result.status, "Rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("MRP:")));
});

test("rejects when gross volume is less than net volume", () => {
  const result = validateBusinessRules({
    ...base,
    weights_and_measures: {
      measurement_unit: "ml",
      net_content: "100 ml",
      gross_weight: "1",
      net_weight: "1200"
    },
    gross_weight: "1",
    gross_weight_unit: "L",
    net_weight: "1200",
    net_weight_unit: "ml"
  });
  assert.equal(result.status, "Rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("Gross Weight vs Net Weight:")));
});

test("rejects when any gross/net value or unit is missing", () => {
  const result = validateBusinessRules({
    ...base,
    weights_and_measures: {
      measurement_unit: "g",
      net_content: "100 g",
      gross_weight: "100",
      net_weight: "80"
    },
    gross_weight_unit: "",
    net_weight_unit: "g"
  });
  assert.equal(result.status, "Rejected");
  assert.ok(result.reasons.some((reason) => reason.includes("Gross Weight Unit: Unit of measurement is missing")));
});

test("allows missing gross/net fields when net content unit is each", () => {
  const result = validateBusinessRules({
    ...base,
    weights_and_measures: {
      measurement_unit: "each",
      net_content: "10 each"
    },
    gross_weight: "",
    gross_weight_unit: "",
    net_weight: "50",
    net_weight_unit: "g"
  });
  assert.equal(result.status, "Accepted");
  assert.ok(!result.reasons.some((reason) => reason.includes("Gross Weight")));
});

// ─── FULL PIPELINE TESTS (normalize → schema → rules) ───
// These mirror the production path in validationService.js and guard against
// the schema stripping fields the rules depend on.

test("pipeline: accepts product with weights nested in weights_and_measures (GS1 modern shape)", () => {
  const raw = {
    ...base,
    gross_weight: undefined,
    gross_weight_unit: undefined,
    net_weight: undefined,
    net_weight_unit: undefined,
    weights_and_measures: {
      measurement_unit: "g",
      net_content: "250 g",
      gross_weight: "300",
      net_weight: "250"
    }
  };
  const result = runFullPipeline(raw);
  assert.equal(
    result.status,
    "Accepted",
    `Expected Accepted, got ${result.status} with reasons: ${JSON.stringify(result.reasons)}`
  );
});

test("pipeline: preserves attributes so food-category FSSAI and shelf_life rules can read them", () => {
  const result = runFullPipeline(baseFood);
  assert.equal(
    result.status,
    "Accepted",
    `Food product with valid FSSAI/shelf_life should pass; got reasons: ${JSON.stringify(result.reasons)}`
  );
});

test("pipeline: preserves exempted_fields so the exemption engine works", () => {
  const raw = {
    ...base,
    gross_weight: undefined,
    gross_weight_unit: undefined,
    net_weight: undefined,
    net_weight_unit: undefined,
    weights_and_measures: {
      measurement_unit: "g",
      net_content: "250 g"
      // weights deliberately omitted — would normally reject
    },
    exempted_fields: [
      { fields: ["gross_weight", "gross_weight_unit", "net_weight", "net_weight_unit"] }
    ]
  };
  const result = runFullPipeline(raw);
  assert.equal(
    result.status,
    "Accepted",
    `Exemption should suppress weight errors; got reasons: ${JSON.stringify(result.reasons)}`
  );
});

test("pipeline: still rejects when weights are genuinely missing and unit is not 'each'", () => {
  const raw = {
    ...base,
    gross_weight: undefined,
    gross_weight_unit: undefined,
    net_weight: undefined,
    net_weight_unit: undefined,
    weights_and_measures: {
      measurement_unit: "g",
      net_content: "250 g"
      // no gross/net weights anywhere
    }
  };
  const result = runFullPipeline(raw);
  assert.equal(result.status, "Rejected");
  assert.ok(result.reasons.some((r) => r.includes("Gross Weight")));
  assert.ok(result.reasons.some((r) => r.includes("Net Weight")));
});
