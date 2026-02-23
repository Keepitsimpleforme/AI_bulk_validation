/**
 * Build CSV for main use-case app with exact column set.
 * Each row: validation result + product snapshot (GS1 fields).
 */

import { stringify } from "csv-stringify/sync";

/** Main-app CSV columns in required order. */
export const MAIN_APP_CSV_HEADERS = [
  "Company Name",
  "AI Verified Status",
  "AI Verified Reason",
  "GCP",
  "Exempted fields",
  "Category Name",
  "Subcategory Name",
  "Product Name",
  "GTIN",
  "Product Description",
  "Price",
  "Location MRP",
  "Target Market",
  "Country of Origin",
  "Approval Status",
  "Email",
  "Condition",
  "Brand Name",
  "Gross Weight",
  "Gross Weight Unit",
  "Net Content",
  "Net Content Unit",
  "Net Weight",
  "Net Weight Unit",
  "Packaging unit",
  "Packaging type",
  "Product Updated Date",
  "HS Code",
  "Product Status",
  "Product SKU",
  "Product Remarks",
  "Valid From",
  "Valid Till",
  "Product Priority",
  "Product Parent SKU",
  "SGST",
  "IGST",
  "CGST",
  "Primary Depth",
  "Front Image",
  "Back Image",
  "Top Image",
  "Bottom Image",
  "Artwork Front",
  "Artwork Back",
  "Right Image",
  "Left Image",
  "Products Count"
];

const get = (obj, path, def = "") => {
  if (obj == null) return def;
  const parts = String(path).split(".");
  let v = obj;
  for (const p of parts) {
    v = v?.[p];
    if (v === undefined || v === null) return def;
  }
  return v === undefined || v === null ? def : String(v).trim();
};

const arrFirst = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null);

/**
 * Map one DB row (gtin, validation_status, reasons, product_snapshot) to main-app CSV row object.
 */
export const rowToMainAppCsvRow = (row) => {
  const p = row.product_snapshot ?? {};
  const mrp = arrFirst(p.mrp) ?? {};
  const reasonStr = Array.isArray(row.reasons) ? row.reasons.join("; ") : String(row.reasons ?? "");

  return {
    "Company Name": get(p, "company_detail.name"),
    "AI Verified Status": row.validation_status ?? "",
    "AI Verified Reason": reasonStr,
    "GCP": get(p, "gcp"),
    "Exempted fields": get(p, "exempted_fields"),
    "Category Name": get(p, "category"),
    "Subcategory Name": get(p, "sub_category"),
    "Product Name": get(p, "name"),
    "GTIN": row.gtin ?? "",
    "Product Description": get(p, "description"),
    "Price": get(p, "price") ?? get(mrp, "mrp"),
    "Location MRP": get(mrp, "location"),
    "Target Market": get(mrp, "target_market"),
    "Country of Origin": get(p, "country_of_origin"),
    "Approval Status": get(p, "approval_status"),
    "Email": get(p, "email"),
    "Condition": get(p, "condition"),
    "Brand Name": get(p, "brand"),
    "Gross Weight": get(p, "gross_weight"),
    "Gross Weight Unit": get(p, "gross_weight_unit"),
    "Net Content": get(p, "net_content") ?? get(p, "weights_and_measures.net_content"),
    "Net Content Unit": get(p, "net_content_unit"),
    "Net Weight": get(p, "net_weight") ?? get(p, "weights_and_measures.net_weight"),
    "Net Weight Unit": get(p, "measurement_unit") ?? get(p, "weights_and_measures.measurement_unit"),
    "Packaging unit": get(p, "packaging_unit"),
    "Packaging type": get(p, "packaging_type"),
    "Product Updated Date": get(p, "product_updated_date") ?? get(p, "updated_at"),
    "HS Code": get(p, "hs_code"),
    "Product Status": get(p, "product_status"),
    "Product SKU": get(p, "product_sku") ?? get(p, "sku"),
    "Product Remarks": get(p, "product_remarks") ?? get(p, "remarks"),
    "Valid From": get(p, "activation_date"),
    "Valid Till": get(p, "deactivation_date"),
    "Product Priority": get(p, "product_priority"),
    "Product Parent SKU": get(p, "product_parent_sku"),
    "SGST": get(p, "sgst"),
    "IGST": get(p, "igst"),
    "CGST": get(p, "cgst"),
    "Primary Depth": get(p, "primary_depth"),
    "Front Image": get(p, "front_image") ?? get(p, "images.front"),
    "Back Image": get(p, "back_image") ?? get(p, "images.back"),
    "Top Image": get(p, "top_image") ?? get(p, "images.top"),
    "Bottom Image": get(p, "bottom_image") ?? get(p, "images.bottom"),
    "Artwork Front": get(p, "artwork_front"),
    "Artwork Back": get(p, "artwork_back"),
    "Right Image": get(p, "right_image") ?? get(p, "images.right"),
    "Left Image": get(p, "left_image") ?? get(p, "images.left"),
    "Products Count": get(p, "products_count")
  };
};

/**
 * Build full CSV string for main app (header + rows).
 */
export const buildMainAppCsv = (rows) => {
  const csvRows = rows.map((row) => rowToMainAppCsvRow(row));
  return stringify(csvRows, {
    header: true,
    columns: MAIN_APP_CSV_HEADERS,
    quoted: true,
    quoted_empty: true
  });
};
