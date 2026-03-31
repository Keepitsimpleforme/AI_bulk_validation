// build csv with the exact columns needed for the main app

import { stringify } from "csv-stringify/sync";

// required columns in order
export const MAIN_APP_CSV_HEADERS = [
  "Company Name",
  "GTIN",
  "AI Verified Status",
  "AI Verified Reason",
  "GCP",
  "Exempted fields",
  "Category Name",
  "Subcategory Name",
  "Product Name",
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
  "modified_date",
  "created_date",
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

// extract value using different possible keys
const getAny = (obj, keys, def = "") => {
  if (obj == null) return def;
  for (const k of keys) {
    const v = get(obj, k);
    if (v !== "" && v != null) return v;
  }
  return def;
};

const arrFirst = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr[0] : null);

// format db row into the main app csv format
export const rowToMainAppCsvRow = (row) => {
  const p = row.product_snapshot ?? {};
  const mrp = arrFirst(p.mrp) ?? {};
  const reasonStr = Array.isArray(row.reasons) ? row.reasons.join("; ") : String(row.reasons ?? "");

  const status = row.validation_status ?? "";
  // gs1 keys can be dashboard style or camelCase
  return {
    "Company Name": getAny(p, ["Company Name", "company_detail.name", "company_name", "companyName"]),
    "AI Verified Status": status,
    "AI Verified Reason": reasonStr,
    "GCP": getAny(p, ["GCP", "gcp"]),
    "Exempted fields": getAny(p, ["Exempted fields", "exempted_fields"]),
    "Category Name": getAny(p, ["Category Name", "category", "category_name", "categoryName"]),
    "Subcategory Name": getAny(p, ["Subcategory Name", "sub_category", "subcategory", "subcategory_name"]),
    "Product Name": getAny(p, ["Product Name", "name", "product_name", "productName"]),
    "GTIN": row.gtin ?? "",
    "Product Description": getAny(p, ["Product Description", "description", "product_description"]),
    "Price": getAny(p, ["Price", "price"]) || get(mrp, "mrp"),
    "Location MRP": getAny(p, ["Location MRP"]) || get(mrp, "location"),
    "Target Market": getAny(p, ["Target Market", "target_market"]) || get(mrp, "target_market"),
    "Country of Origin": getAny(p, ["Country of Origin", "country_of_origin"]),
    "Approval Status": getAny(p, ["Approval Status", "approval_status"]),
    "Email": getAny(p, ["Email", "email"]),
    "Condition": getAny(p, ["Condition", "condition"]),
    "Brand Name": getAny(p, ["Brand Name", "brand", "brand_name", "brandName"]),
    "Gross Weight": getAny(p, ["Gross Weight", "gross_weight"]),
    "Gross Weight Unit": getAny(p, ["Gross Weight Unit", "gross_weight_unit"]),
    "Net Content": getAny(p, ["Net Content", "net_content"]) || get(p, "weights_and_measures.net_content"),
    "Net Content Unit": getAny(p, ["Net Content Unit", "net_content_unit"]),
    "Net Weight": getAny(p, ["Net Weight", "net_weight"]) || get(p, "weights_and_measures.net_weight"),
    "Net Weight Unit": getAny(p, ["Net Weight Unit", "measurement_unit"]) || get(p, "weights_and_measures.measurement_unit"),
    "Packaging unit": getAny(p, ["Packaging unit", "packaging_unit"]),
    "Packaging type": getAny(p, ["Packaging type", "packaging_type"]),
    "modified_date": getAny(p, ["modified_date", "Product Updated Date", "product_updated_date", "updated_at"]),
    "created_date": getAny(p, ["created_date", "Product Created Date", "created_at"]),
    "HS Code": getAny(p, ["HS Code", "hs_code"]),
    "Product Status": getAny(p, ["Product Status", "product_status"]),
    "Product SKU": getAny(p, ["Product SKU", "product_sku", "sku"]),
    "Product Remarks": getAny(p, ["Product Remarks", "product_remarks", "remarks"]),
    "Valid From": getAny(p, ["Valid From", "activation_date"]),
    "Valid Till": getAny(p, ["Valid Till", "deactivation_date"]),
    "Product Priority": getAny(p, ["Product Priority", "product_priority"]),
    "Product Parent SKU": getAny(p, ["Product Parent SKU", "product_parent_sku"]),
    "SGST": getAny(p, ["SGST", "sgst"]),
    "IGST": getAny(p, ["IGST", "igst"]),
    "CGST": getAny(p, ["CGST", "cgst"]),
    "Primary Depth": getAny(p, ["Primary Depth", "primary_depth"]),
    "Front Image": getAny(p, ["Front Image", "front_image"]) || get(p, "images.front"),
    "Back Image": getAny(p, ["Back Image", "back_image"]) || get(p, "images.back"),
    "Top Image": getAny(p, ["Top Image", "top_image"]) || get(p, "images.top"),
    "Bottom Image": getAny(p, ["Bottom Image", "bottom_image"]) || get(p, "images.bottom"),
    "Artwork Front": getAny(p, ["Artwork Front", "artwork_front"]),
    "Artwork Back": getAny(p, ["Artwork Back", "artwork_back"]),
    "Right Image": getAny(p, ["Right Image", "right_image"]) || get(p, "images.right"),
    "Left Image": getAny(p, ["Left Image", "left_image"]) || get(p, "images.left"),
    "Products Count": getAny(p, ["Products Count", "products_count"]),
    // legacy keys to keep dashboard working
    GTIN_number: row.gtin ?? "",
    Status: status
  };
};

// combine headers and rows into a single csv string
export const buildMainAppCsv = (rows) => {
  const csvRows = rows.map((row) => rowToMainAppCsvRow(row));
  return stringify(csvRows, {
    header: true,
    columns: MAIN_APP_CSV_HEADERS,
    quoted: true,
    quoted_empty: true
  });
};
