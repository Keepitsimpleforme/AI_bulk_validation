const isNumericLike = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  const text = String(value).trim();
  return text.length > 0 && !Number.isNaN(Number(text));
};

const isUnitLike = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  const unit = String(value).trim().toLowerCase();
  return ["g", "kg", "ml", "l", "each"].includes(unit);
};

export const normalizeProduct = (raw) => {
  const product = { ...raw };
  product.gtin = product.gtin !== undefined && product.gtin !== null ? String(product.gtin) : "";

  const topMeasurement = product.measurement_unit;
  const topNetContent = product.net_content;
  const wmMeasurement = product.weights_and_measures?.measurement_unit;
  const wmNetContent = product.weights_and_measures?.net_content;

  let measurementUnit = topMeasurement ?? wmMeasurement;
  let netContent = topNetContent ?? wmNetContent;

  // Some GS1 payloads invert value/unit: measurement_unit=50, net_content=g.
  if (isNumericLike(measurementUnit) && isUnitLike(netContent)) {
    const swappedMeasurementUnit = netContent;
    const swappedNetContent = measurementUnit;
    measurementUnit = swappedMeasurementUnit;
    netContent = swappedNetContent;
  }

  if (measurementUnit !== undefined) {
    product.measurement_unit = measurementUnit;
  }
  if (netContent !== undefined) {
    product.net_content = netContent;
  }

  return product;
};
