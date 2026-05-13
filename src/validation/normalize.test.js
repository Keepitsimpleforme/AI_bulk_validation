import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct } from "./normalize.js";

test("normalizes numeric gtin to string", () => {
  const out = normalizeProduct({ gtin: 8901234567890 });
  assert.equal(out.gtin, "8901234567890");
});

test("lifts gross_weight and net_weight from weights_and_measures to top level", () => {
  const out = normalizeProduct({
    gtin: "8905512005777",
    weights_and_measures: {
      measurement_unit: "g",
      net_weight: "800",
      net_content: "800 g",
      gross_weight: "900"
    }
  });
  assert.equal(out.gross_weight, "900");
  assert.equal(out.gross_weight_unit, "g");
  assert.equal(out.net_weight, "800");
  assert.equal(out.net_weight_unit, "g");
  assert.equal(out.measurement_unit, "g");
  assert.equal(out.net_content, "800");
});

test("does not overwrite top-level weights when already present", () => {
  const out = normalizeProduct({
    gtin: "123",
    gross_weight: "1000",
    gross_weight_unit: "kg",
    net_weight: "900",
    net_weight_unit: "kg",
    weights_and_measures: {
      measurement_unit: "g",
      net_weight: "500",
      gross_weight: "600"
    }
  });
  // Top-level values should NOT be overwritten
  assert.equal(out.gross_weight, "1000");
  assert.equal(out.gross_weight_unit, "kg");
  assert.equal(out.net_weight, "900");
  assert.equal(out.net_weight_unit, "kg");
});
