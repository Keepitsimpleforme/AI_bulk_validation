import express from "express";
import { config } from "./config.js";
import { logger } from "./lib/logger.js";
import { metricsRegistry } from "./lib/metrics.js";
import { runRouter } from "./api/runRoutes.js";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(runRouter);

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, service: "bulk-validation-pipeline" });
});

app.get("/metrics", async (_req, res) => {
  res.setHeader("Content-Type", metricsRegistry.contentType);
  res.send(await metricsRegistry.metrics());
});

app.use((error, _req, res, _next) => {
  logger.error({ err: error }, "request failed");
  const message = config.nodeEnv === "production" ? "Internal server error" : error.message;
  res.status(500).json({ message });
});

const server = app.listen(config.port, () => {
  logger.info({ port: config.port }, "bulk validation API started");
});

function shutdown(signal) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
