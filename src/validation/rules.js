const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));

const hasValue = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  return String(value).trim().length > 0;
};

const toNumber = (value) => Number.parseFloat(String(value));

const validateNetContent = (unitRaw, netContentRaw, reasons) => {
  const unit = String(unitRaw ?? "").toLowerCase();
  const netContent = String(netContentRaw ?? "");
  const numeric = toNumber(netContent);
  if (unit.includes("kg")) {
    if (!Number.isFinite(numeric) || String(Math.trunc(numeric)).length > 3) {
      reasons.push("Net Content: invalid for kg");
    }
  } else if (unit === "g" || unit.endsWith(" g")) {
    if (!Number.isFinite(numeric)) {
      reasons.push("Net Content: invalid for g");
    }
  } else if (unit === "l" || unit.endsWith(" l")) {
    if (!Number.isFinite(numeric) || String(Math.trunc(numeric)).length > 3) {
      reasons.push("Net Content: invalid for l");
    }
  } else if (unit.includes("ml")) {
    if (!Number.isFinite(numeric)) {
      reasons.push("Net Content: invalid for ml");
    }
  } else if (unit.includes("each")) {
    return;
  }
};

export const validateBusinessRules = (product) => {
  const reasons = [];

  if (!hasValue(product.gtin)) reasons.push("GTIN NUMBER: Should be provided");
  if (!isValidDate(product.activation_date)) reasons.push("Activation Date: invalid");
  if (!isValidDate(product.deactivation_date)) reasons.push("Deactivation Date: invalid");
  if (!hasValue(product.brand)) reasons.push("Brand Name: Should be provided");
  if (!hasValue(product.name)) reasons.push("Product Name: Should be provided");
  if (!hasValue(product.description)) reasons.push("Product Description: Should be provided");
  if (!hasValue(product.category)) reasons.push("Category: Not Accepted");
  if (!hasValue(product.sub_category)) reasons.push("Sub Category: Not Accepted");
  if (!hasValue(product.company_detail?.name)) reasons.push("Company Name: Not Accepted");
  if (!hasValue(product.hs_code)) reasons.push("HS Code: Should be provided");
  if (!hasValue(product.igst)) reasons.push("IGST: Should be provided");

  validateNetContent(product.measurement_unit, product.net_content, reasons);

  const firstMrp = product.mrp?.[0];
  if (!hasValue(firstMrp?.mrp) || Number(firstMrp?.mrp) <= 0) {
    reasons.push("MRP: Should be not be null and be positive");
  }
  if (!hasValue(firstMrp?.target_market)) {
    reasons.push("Target Market: Should be provided");
  }
  if (!isValidDate(firstMrp?.activation_date)) {
    reasons.push("MRP Activation Date: Should be provided or be valid");
  }
  if (!hasValue(firstMrp?.location)) {
    reasons.push("MRP Location: Should be provided");
  }

  if (String(product.category ?? "").toLowerCase() === "food") {
    const fssai =
      product.attributes?.regulatory_data?.child?.fssai_lic?._no_ ??
      product.attributes?.regulatory_data?.child?.fssai_lic?._no_ ??
      product.attributes?.regulatory_data?.child?.fssai_lic?._no;
    if (!hasValue(fssai) || String(fssai).length !== 14 || !/^[12]/.test(String(fssai))) {
      reasons.push("FSSAI NUMBER: Should be of length 14 and should start with either 1 or 2");
    }
    if (!hasValue(product.attributes?.regulatory_data?.child?.food_type)) {
      reasons.push("food_type: Not Accepted");
    }
    if (!hasValue(product.attributes?.shelf_life?.child?.value)) {
      reasons.push("Shelf Life Value: Should be provided");
    }
    if (!hasValue(product.attributes?.shelf_life?.child?.unit)) {
      reasons.push("Shelf Life Unit: Should be provided");
    }
    if (!hasValue(product.attributes?.shelf_life?.child?.based_on)) {
      reasons.push("Shelf Life Based On: Should be provided");
    }
  }

  return {
    status: reasons.length ? "Rejected" : "Accepted",
    reasons
  };
};
