/**
 * Parse a combined net_content string like "800 g" or "60 each" into { value, unit }.
 * Returns { value, unit } or null if the string cannot be parsed.
 */
const parseNetContent = (netContent) => {
  if (!netContent) return null;
  const str = String(netContent).trim();
  // Match pattern: number (possibly decimal) followed by optional space and unit text
  const match = str.match(/^([\d.]+)\s*(.+)$/);
  if (match) {
    return { value: match[1], unit: match[2].trim() };
  }
  return null;
};

export const normalizeProduct = (raw) => {
  const product = { ...raw };
  product.gtin = product.gtin !== undefined && product.gtin !== null ? String(product.gtin) : "";

  const wm = product.weights_and_measures || {};

  // Lift gross_weight and net_weight from weights_and_measures to top level
  // when they are not already present at the top level.
  if (!product.gross_weight && wm.gross_weight) {
    product.gross_weight = wm.gross_weight;
  }
  if (!product.net_weight && wm.net_weight) {
    product.net_weight = wm.net_weight;
  }

  // Use measurement_unit from weights_and_measures as the weight unit
  // when top-level units are missing.
  if (!product.gross_weight_unit && product.gross_weight && wm.measurement_unit) {
    product.gross_weight_unit = wm.measurement_unit;
  }
  if (!product.net_weight_unit && product.net_weight && wm.measurement_unit) {
    product.net_weight_unit = wm.measurement_unit;
  }

  // Parse combined net_content string (e.g., "800 g" → value: "800", unit: "g")
  // and set measurement_unit and net_content as separate clean fields.
  const parsed = parseNetContent(wm.net_content);
  if (parsed) {
    if (!product.measurement_unit) {
      product.measurement_unit = parsed.unit;
    }
    if (!product.net_content) {
      product.net_content = parsed.value;
    }
    // Update weights_and_measures so downstream reads clean separated values
    product.weights_and_measures = {
      ...wm,
      measurement_unit: wm.measurement_unit || parsed.unit,
      net_content: parsed.value
    };
  } else {
    // net_content is not a combined string; just lift as-is
    if (!product.measurement_unit && wm.measurement_unit) {
      product.measurement_unit = wm.measurement_unit;
    }
    if (!product.net_content && wm.net_content) {
      product.net_content = wm.net_content;
    }
  }

  return product;
};
