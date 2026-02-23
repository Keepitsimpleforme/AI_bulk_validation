import client from "prom-client";

const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const metrics = {
  gs1PagesFetchedTotal: new client.Counter({
    name: "gs1_pages_fetched_total",
    help: "Total GS1 pages fetched",
    registers: [register]
  }),
  gs1ItemsFetchedTotal: new client.Counter({
    name: "gs1_items_fetched_total",
    help: "Total GS1 items fetched",
    registers: [register]
  }),
  validationItemsTotal: new client.Counter({
    name: "validation_items_total",
    help: "Total items validated",
    registers: [register]
  }),
  validationAcceptedTotal: new client.Counter({
    name: "validation_accepted_total",
    help: "Total accepted items",
    registers: [register]
  }),
  validationRejectedTotal: new client.Counter({
    name: "validation_rejected_total",
    help: "Total rejected items",
    registers: [register]
  }),
  deliverySuccessTotal: new client.Counter({
    name: "delivery_success_total",
    help: "Total successful delivery records",
    registers: [register]
  }),
  deliveryFailedTotal: new client.Counter({
    name: "delivery_failed_total",
    help: "Total failed delivery records",
    registers: [register]
  }),
  retryTotal: new client.Counter({
    name: "retry_total",
    help: "Retry attempts by component",
    labelNames: ["component"],
    registers: [register]
  }),
  queueDepthRawBatches: new client.Gauge({
    name: "queue_depth_raw_batches",
    help: "Queue depth for raw batches",
    registers: [register]
  }),
  queueDepthValidatedBatches: new client.Gauge({
    name: "queue_depth_validated_batches",
    help: "Queue depth for validated batches",
    registers: [register]
  })
};

export const metricsRegistry = register;
