import express from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createRun, getCheckpoint, getLastRunCheckpointForDate, getRun, updateRunStatus } from "../repositories/runRepository.js";
import { generateDailySummary, generateRunReport, generateValidationResultsCSV } from "../services/reportingService.js";
import { ingestRun } from "../services/ingestionService.js";

export const runRouter = express.Router();

runRouter.post("/v1/runs", async (req, res, next) => {
  try {
    const runId = randomUUID();
    let { status, from, to, resultPerPage = 100, startCursor } = req.body ?? {};
    if (!from || !to) {
      return res.status(400).json({ message: "from and to (YYYY-MM-DD) are required" });
    }
    if (from === to && typeof to === "string" && !to.includes("T")) {
      to = `${to}T23:59:59`;
    }
    if (startCursor == null) {
      startCursor = await getLastRunCheckpointForDate(from);
    }
    const run = await createRun({
      runId,
      statusFilter: status,
      from,
      to,
      resultPerPage
    });

    ingestRun({
      runId,
      statusFilter: status,
      from,
      to,
      resultPerPage,
      startCursor: startCursor ?? null
    })
      .then(() => undefined)
      .catch(async () => updateRunStatus(runId, "PARTIAL_FAILED"));

    res.status(202).json({
      runId: run.run_id,
      status: run.status,
      startCursor: startCursor ?? null
    });
  } catch (error) {
    next(error);
  }
});

runRouter.get("/v1/runs/:runId", async (req, res, next) => {
  try {
    const run = await getRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ message: "Run not found" });
    }
    return res.json(run);
  } catch (error) {
    return next(error);
  }
});

runRouter.post("/v1/runs/:runId/resume", async (req, res, next) => {
  try {
    const run = await getRun(req.params.runId);
    if (!run) {
      return res.status(404).json({ message: "Run not found" });
    }
    const checkpoint = await getCheckpoint(req.params.runId);
    await updateRunStatus(req.params.runId, "RUNNING");

    ingestRun({
      runId: run.run_id,
      statusFilter: run.status_filter,
      from: run.from_date,
      to: run.to_date,
      resultPerPage: run.result_per_page,
      startCursor: checkpoint?.cursor_out ?? null
    })
      .then(() => undefined)
      .catch(async () => updateRunStatus(run.run_id, "PARTIAL_FAILED"));

    return res.status(202).json({
      runId: run.run_id,
      resumedFromCursor: checkpoint?.cursor_out ?? null
    });
  } catch (error) {
    return next(error);
  }
});

runRouter.get("/v1/runs/:runId/report", async (req, res, next) => {
  try {
    const result = await generateRunReport(req.params.runId);
    return res.json(result.report);
  } catch (error) {
    return next(error);
  }
});

runRouter.get("/v1/runs/:runId/results.csv", async (req, res, next) => {
  try {
    const { csvPath } = await generateValidationResultsCSV(req.params.runId);
    const fileContent = await fs.readFile(csvPath);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="validation_results_${req.params.runId}.csv"`);
    return res.send(fileContent);
  } catch (error) {
    return next(error);
  }
});

runRouter.get("/v1/reports/daily", async (req, res, next) => {
  try {
    const date = req.query.date;
    if (!date) {
      return res.status(400).json({ message: "date query param is required" });
    }
    const result = await generateDailySummary(String(date));
    return res.json(result.summary);
  } catch (error) {
    return next(error);
  }
});
