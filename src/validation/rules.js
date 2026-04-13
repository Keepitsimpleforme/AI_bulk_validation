const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));

const hasValue = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  return String(value).trim().length > 0;
};

const toNumber = (value) => Number.parseFloat(String(value));

// ─── EXEMPTION ENGINE BUILER ───
const buildExemptedSet = (product) => {
  const set = new Set();
  const arr = product.exempted_fields || [];
  for (const group of arr) {
    if (Array.isArray(group.fields)) {
      for (const field of group.fields) {
        set.add(String(field).trim().toLowerCase());
      }
    }
  }
  return set;
};

// ─── WEIGHTS AND MEASURES INTELLIGENCE ───
const parseWeightUnit = (a, b) => {
  // GS1 frequently reverses numbers and strings in their JSON keys!
  // This physically extracts whichever string represents the alphabetic "Unit" and which is the numeric "Value".
  const strA = String(a ?? "").trim().toLowerCase();
  const strB = String(b ?? "").trim().toLowerCase();
  
  if (Number.isNaN(Number(strA)) && !Number.isNaN(Number(strB))) {
    return { unit: strA, value: strB };
  } else if (!Number.isNaN(Number(strA)) && Number.isNaN(Number(strB))) {
    return { unit: strB, value: strA };
  }
  return { unit: strA, value: strB }; 
};

const validateWeightsAndMeasures = (product, reportError) => {
  const wAm = product.weights_and_measures || {};
  const { unit: netUnit, value: netVal } = parseWeightUnit(wAm.measurement_unit, wAm.net_content);
  
  // Safely locate Gross and Net weights no matter where GS1 buries them in the packaging attributes
  const packaging = product.attributes?.packaging?.child || {};
  const grossW = product.gross_weight || packaging.gross_weight?.child?.value;
  const grossU = product.gross_weight_unit || packaging.gross_weight?.child?.unit;
  
  const netW = product.net_weight || packaging.net_weight?.child?.value;
  const netU = product.net_weight_unit || packaging.net_weight?.child?.unit;

  // RULE 0: For unitized products, skip all gross/net validations.
  if (netUnit === "each" || netUnit === "piece" || netUnit === "pieces" || netUnit === "nos") {
    return;
  }

  // Gross/Net values and units are mandatory for acceptance.
  if (!hasValue(grossW) || !hasValue(netW) || !hasValue(grossU) || !hasValue(netU)) {
    reportError("weights_required", "Weights: Gross Weight, Net Weight and their units should all be provided");
    return;
  }

  // RULE 1: UNIT OF MEASUREMENT SHOULD BE THERE
  if (hasValue(netVal) && !hasValue(netUnit)) {
    reportError("net_content_unit", "Net Content Unit: Should be provided");
  }
  if (hasValue(grossW) && !hasValue(grossU)) {
    reportError("gross_weight_unit", "Gross Weight Unit: Should be provided");
  }
  if (hasValue(netW) && !hasValue(netU)) {
    reportError("net_weight_unit", "Net Weight Unit: Should be provided");
  }
  
  // RULE 2: IN CASE OF MASS/VOLUME UNITS -> GROSS WEIGHT >= NET WEIGHT
  const toComparableUnit = (v, u) => {
    let num = Number.parseFloat(v);
    if (!Number.isFinite(num)) return null;
    const strU = String(u || "").toLowerCase().trim();
    if (strU === "kg" || strU === "kilogram" || strU === "kilograms") {
      return { dimension: "mass", value: num * 1000 };
    }
    if (strU === "g" || strU === "gram" || strU === "grams") {
      return { dimension: "mass", value: num };
    }
    if (
      strU === "l" ||
      strU === "lt" ||
      strU === "liter" ||
      strU === "liters" ||
      strU === "litre" ||
      strU === "litres"
    ) {
      return { dimension: "volume", value: num * 1000 };
    }
    if (
      strU === "ml" ||
      strU === "milliliter" ||
      strU === "milliliters" ||
      strU === "millilitre" ||
      strU === "millilitres"
    ) {
      return { dimension: "volume", value: num };
    }
    return null;
  };
  
  if (hasValue(grossW) && hasValue(netW) && hasValue(grossU) && hasValue(netU)) {
    const grossComparable = toComparableUnit(grossW, grossU);
    const netComparable = toComparableUnit(netW, netU);
    
    if (
      grossComparable !== null &&
      netComparable !== null &&
      grossComparable.dimension === netComparable.dimension
    ) {
      if (grossComparable.value < netComparable.value) {
        reportError("weights", "Weights: Gross Weight must be mathematically greater than or equal to Net Weight");
      }
    }
  }
};

// ─── MASTER VALIDATION HUB ───
export const validateBusinessRules = (product) => {
  const reasons = [];
  const exemptedSet = buildExemptedSet(product);
  
  // Smart Wrapper: Before pushing an error to the database, ask the Exemption Set if this rule was bypassed!
  const reportError = (ruleKey, message) => {
    if (!exemptedSet.has(ruleKey.toLowerCase())) {
      reasons.push(message);
    }
  };

  if (!hasValue(product.gtin)) reportError("gtin", "GTIN NUMBER: Should be provided");
  if (!isValidDate(product.activation_date)) reportError("activation_date", "Activation Date: invalid");
  if (!isValidDate(product.deactivation_date)) reportError("deactivation_date", "Deactivation Date: invalid");
  if (!hasValue(product.brand)) reportError("brand", "Brand Name: Should be provided");
  if (!hasValue(product.name)) reportError("name", "Product Name: Should be provided");
  if (!hasValue(product.description)) reportError("description", "Product Description: Should be provided");
  if (!hasValue(product.category)) reportError("category", "Category: Not Accepted");
  if (!hasValue(product.sub_category)) reportError("sub_category", "Sub Category: Not Accepted");
  if (!hasValue(product.company_detail?.name)) reportError("company_name", "Company Name: Not Accepted");
  if (!hasValue(product.hs_code)) reportError("hs_code", "HS Code: Should be provided");
  if (!hasValue(product.igst)) reportError("igst", "IGST: Should be provided");

  // Fire the intelligent Weight Scanner
  validateWeightsAndMeasures(product, reportError);

  const firstMrp = product.mrp?.[0];
  const targetMarket = String(firstMrp?.target_market ?? "").trim().toLowerCase();
  const isIndiaMarket = targetMarket === "india";
  if (isIndiaMarket && (!hasValue(firstMrp?.mrp) || Number(firstMrp?.mrp) <= 0)) {
    reportError("mrp", "MRP: Should be not be null and be positive");
  }
  if (!hasValue(firstMrp?.target_market)) {
    reportError("target_market", "Target Market: Should be provided");
  }
  if (!isValidDate(firstMrp?.activation_date)) {
    reportError("mrp_activation_date", "MRP Activation Date: Should be provided or be valid");
  }
  if (!hasValue(firstMrp?.location)) {
    reportError("mrp_location", "MRP Location: Should be provided");
  }

  if (String(product.category ?? "").toLowerCase() === "food") {
    const fssai =
      product.attributes?.regulatory_data?.child?.fssai_lic?._no_ ??
      product.attributes?.regulatory_data?.child?.fssai_lic?._no;
      
    if (!hasValue(fssai) || String(fssai).length !== 14 || !/^[12]/.test(String(fssai))) {
      // Note the rulekey physically matches the exact GS1 string 'fssai_lic._no.'
      reportError("fssai_lic._no.", "FSSAI NUMBER: Should be of length 14 and should start with either 1 or 2");
    }
    if (!hasValue(product.attributes?.regulatory_data?.child?.food_type)) {
      reportError("food_type", "food_type: Not Accepted");
    }
    if (!hasValue(product.attributes?.shelf_life?.child?.value)) {
      reportError("shelf_life_value", "Shelf Life Value: Should be provided");
    }
    if (!hasValue(product.attributes?.shelf_life?.child?.unit)) {
      reportError("shelf_life_unit", "Shelf Life Unit: Should be provided");
    }
    if (!hasValue(product.attributes?.shelf_life?.child?.based_on)) {
      reportError("shelf_life_based_on", "Shelf Life Based On: Should be provided");
    }
  }

  return {
    status: reasons.length ? "Rejected" : "Accepted",
    reasons
  };
};
