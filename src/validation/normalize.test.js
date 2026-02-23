import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct } from "./normalize.js";

test("normalizes numeric gtin to string", () => {
  const out = normalizeProduct({ gtin: 8901234567890 });
  assert.equal(out.gtin, "8901234567890");
});

test("normalizes swapped weights_and_measures fields", () => {
  const out = normalizeProduct({
    gtin: "1",
    weights_and_measures: {
      measurement_unit: "50",
      net_content: "g"
    }
  });
  assert.equal(out.measurement_unit, "g");
  assert.equal(out.net_content, "50");
});
