# AI Bulk Validation — Bug Fixes & Rule Changes Documentation

**Date:** 2026-05-13  
**Files Modified:**
- `src/validation/rules.js`
- `src/validation/normalize.js`
- `src/validation/rules.test.js`
- `src/validation/normalize.test.js`
- `src/services/deliveryService.js`

---

## Bugs Fixed (4 Issues)

### Bug #1 — FSSAI License Number Incorrectly Rejected
**Problem:** Valid 14-digit FSSAI numbers were being rejected even when correct.

**Root Cause:** The FSSAI lookup in `rules.js` only checked **nested** key paths (`child.fssai_lic._no_`), but GS1 data stores FSSAI as a **flat key** `"fssai_lic._no."` directly on the `child` object. The code never found the value → always `undefined` → always rejected.

**Fix in `rules.js`:**
Added logic to safely check 4 key formats in priority order: flat key with dot → flat key without dot → nested with underscore → nested without underscore.

---

### Bug #2 — Gross Weight & Net Content Payload Changes
**Problem:** Non-unitized products (like Food items) were being rejected because `gross_weight` and `net_weight` were missing at the top level. Furthermore, the GS1 API began sending `net_content` as a combined string (e.g. `"800 g"`).

**Root Cause:** GS1 stopped sending weights at the root payload level and buried them inside `weights_and_measures`. Additionally, the combined `"800 g"` string broke the internal `parseWeightUnit` function which expected clean, separated fields.

**Fix in `normalize.js`:**
1. **Lifting Weights:** Added logic to extract `gross_weight` and `net_weight` from `weights_and_measures` and attach them to the top level of the product where the validator expects them.
2. **String Extraction:** Added a `parseNetContent` regex function to split combined strings (e.g. `"800 g"` or `"3 each"`) into distinct `value` and `unit` fields.
3. **Re-syncing:** Updated the `weights_and_measures` object during normalization so downstream processes receive clean, parsed data.

---

### Bug #3 — Overseas Products Rejected for Missing MRP Details
**Problem:** Non-India market products were being rejected for missing MRP, MRP Location, and MRP Activation Date.

**Root Cause:** The MRP Activation Date and MRP Location checks were running **unconditionally** for all markets. Only the MRP value check was properly gated behind the `isIndiaMarket` flag.

**Fix in `rules.js`:**
Wrapped the `mrp_activation_date` and `mrp_location` validation rules inside an `if (isIndiaMarket)` condition.

---

### Bug #4 — Rejection Remarks Not Clear
**Problem:** The rejection message `"Weights: Gross Weight, Net Weight and their units should all be provided"` was a single blanket message that didn't specify which exact field was missing, confusing the business team. Additionally, downstream apps weren't formatting these JSON arrays correctly.

**Fix in `rules.js` & `deliveryService.js`:**
1. Replaced the blanket message with individual, specific rejection remarks for each field (e.g., `"Gross Weight Unit: Unit of measurement is missing. Gross Weight Unit (e.g. g, kg) must be provided."`).
2. Updated `deliveryService.js` to map raw rejection arrays into semicolon-separated strings (using `rowToMainAppCsvRow`) so they display cleanly in downstream UI.

---

## Complete Validation Rules Reference (Current State)

### Exemption Engine
Any rule key listed in `product.exempted_fields[].fields[]` will be **skipped** during validation. The exemption key must match the `ruleKey` in the table below (case-insensitive).

### All Validation Rules

| # | Rule Key | Field Checked | Condition | Rejection Message | Applies To |
|---|----------|---------------|-----------|-------------------|------------|
| 1 | `gtin` | `product.gtin` | Must have a value | `GTIN NUMBER: Should be provided` | All |
| 2 | `activation_date` | `product.activation_date` | Must be valid `YYYY-MM-DD` | `Activation Date: invalid` | All |
| 3 | `deactivation_date` | `product.deactivation_date` | Must be valid `YYYY-MM-DD` | `Deactivation Date: invalid` | All |
| 4 | `brand` | `product.brand` | Must have a value | `Brand Name: Should be provided` | All |
| 5 | `name` | `product.name` | Must have a value | `Product Name: Should be provided` | All |
| 6 | `description` | `product.description` | Must have a value | `Product Description: Should be provided` | All |
| 7 | `category` | `product.category` | Must have a value | `Category: Not Accepted` | All |
| 8 | `sub_category` | `product.sub_category` | Must have a value | `Sub Category: Not Accepted` | All |
| 9 | `company_name` | `product.company_detail.name` | Must have a value | `Company Name: Not Accepted` | All |
| 10 | `hs_code` | `product.hs_code` | Must have a value | `HS Code: Should be provided` | All |
| 11 | `igst` | `product.igst` | Must have a value | `IGST: Should be provided` | All |

#### Weights & Measures Rules
> [!NOTE]
> All weight rules are **skipped** if `net_content` unit is `each`, `piece`, `pieces`, or `nos` (unitized products).

| # | Rule Key | Field Checked | Condition | Rejection Message |
|---|----------|---------------|-----------|-------------------|
| 12 | `gross_weight` | `product.gross_weight` | Must have a value | `Gross Weight: Value is missing. Gross Weight must be provided.` |
| 13 | `gross_weight_unit` | `product.gross_weight_unit` | Must have a value | `Gross Weight Unit: Unit of measurement is missing...` |
| 14 | `net_weight` | `product.net_weight` | Must have a value | `Net Weight: Value is missing. Net Weight must be provided.` |
| 15 | `net_weight_unit` | `product.net_weight_unit` | Must have a value | `Net Weight Unit: Unit of measurement is missing...` |
| 16 | `net_content_unit` | `weights_and_measures.net_content` | Unit required if value exists | `Net Content Unit: Unit of measurement is missing...` |
| 17 | `weights` | Gross vs Net comparison | Gross Weight ≥ Net Weight (same dimension) | `Gross Weight vs Net Weight: Gross Weight (X unit) is less than Net Weight (Y unit)...` |

#### MRP Rules

| # | Rule Key | Field Checked | Condition | Rejection Message | Applies To |
|---|----------|---------------|-----------|-------------------|------------|
| 18 | `mrp` | `product.mrp[0].mrp` | Must be > 0 | `MRP: Should be not be null and be positive` | **India only** |
| 19 | `target_market` | `product.mrp[0].target_market` | Must have a value | `Target Market: Should be provided` | All |
| 20 | `mrp_activation_date` | `product.mrp[0].activation_date` | Must be valid `YYYY-MM-DD` | `MRP Activation Date: Should be provided or be valid` | **India only** |
| 21 | `mrp_location` | `product.mrp[0].location` | Must have a value | `MRP Location: Should be provided` | **India only** |

#### Food Category Rules (only when `category = "food"`)

| # | Rule Key | Field Checked | Condition | Rejection Message |
|---|----------|---------------|-----------|-------------------|
| 22 | `fssai_lic._no.` | FSSAI license number | Must be 14 digits, start with 1 or 2 | `FSSAI NUMBER: Should be of length 14 and should start with either 1 or 2` |
| 23 | `food_type` | `regulatory_data.child.food_type` | Must have a value | `food_type: Not Accepted` |
| 24 | `shelf_life_value` | `shelf_life.child.value` | Must have a value | `Shelf Life Value: Should be provided` |
| 25 | `shelf_life_unit` | `shelf_life.child.unit` | Must have a value | `Shelf Life Unit: Should be provided` |
| 26 | `shelf_life_based_on` | `shelf_life.child.based_on` | Must have a value | `Shelf Life Based On: Should be provided` |

---

## Test Coverage
Both the unit tests (`rules.test.js`, `normalize.test.js`) and the live integration tests have been fully updated. The test payloads now simulate the exact modern API structure returned by GS1 where weights are embedded within `weights_and_measures` and `net_content` is a combined string. 

All 11 tests pass successfully.
