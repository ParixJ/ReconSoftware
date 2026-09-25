import crypto from "node:crypto";
import { runScrutiny } from "../core/runScrutiny.js";
import {
  claimNextAuditRun, completeAuditRun, failAuditRun, sourcesForAuditRun,
} from "./reportService.js";

const workerId = crypto.randomUUID();
let active = false;
let scheduled = false;
let periodicCheck;

async function drain() {
  if (active) return;
  active = true;
  try {
    let run;
    while ((run = claimNextAuditRun(workerId))) {
      try {
        const sources = sourcesForAuditRun(run).map((source) => source.parsed);
        const output = runScrutiny({ sources, checkIds: run.checkIds,
          reportTaxpayerId: run.reportTaxpayerId, parameters: run.parameters });
        const results = output.results.map((result) => ({ ...result, runId: run.id }));
        completeAuditRun(run.id, workerId, results);
      } catch (error) {
        if (process.env.NODE_ENV !== "test") console.error("Scrutiny run failed", { runId: run.id, error });
        failAuditRun(run.id, workerId);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  } finally {
    active = false;
  }
}

export function scheduleAuditRuns() {
  if (scheduled || active) return;
  scheduled = true;
  setImmediate(() => {
    scheduled = false;
    drain().catch((error) => {
      if (process.env.NODE_ENV !== "test") console.error("Audit run worker failed", error);
    });
  });
}

export function startAuditWorker() {
  if (periodicCheck) return;
  scheduleAuditRuns();
  periodicCheck = setInterval(scheduleAuditRuns, 60_000);
  periodicCheck.unref?.();
}
