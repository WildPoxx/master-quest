import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { readContinuityReportState } from "../src/continuity/read-continuity-report.js";
import { readJson } from "./helpers.js";

const indexPath = resolve("fixtures/module_1/session_03_closeout/reports.index.json");

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[—–]/g, "-")
    .toLowerCase();
}

async function loadReport(reportId) {
  const index = await readJson(indexPath);
  const report = index.reports.find((entry) => entry.id === reportId);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);
  const sourcePath = resolve(sourceRoot, report.path);
  const text = await readFile(sourcePath, "utf8");
  return readContinuityReportState(text, { sourcePath });
}

test("module closeout report is parsed as module scope with grouped objectives and closeouts", async () => {
  const state = await loadReport("module_1_closeout");

  assert.equal(state.questTitle, "Ferrugem sob as Estrelas");
  assert.equal(state.reportScope, "module");
  assert.equal(state.reportedStatus, "completed");
  assert.deepEqual(state.objectiveCounts, {
    completed: 5,
    failed: 0,
    pending: 0
  });
  assert.deepEqual(state.rewardCounts, {
    obtained: 4,
    pending: 1
  });

  assert.equal(
    state.completedObjectives.some((entry) => entry.group === "A Chave de Rastro" && entry.text === "Criar ou estabilizar a Chave de Rastro."),
    true
  );
  assert.equal(
    state.pendingObjectives.some((entry) =>
      entry.group === "A Chave de Rastro"
      && normalize(entry.text) === normalize("Investigar terminal de transmissao usado por Nikko.")
    ),
    true
  );
  assert.equal(
    state.looseEnds.some((entry) =>
      normalize(entry.group) === normalize("Pontas Soltas Registradas - A Chave de Rastro")
      && normalize(entry.text).includes(normalize("Rastrear assinatura Axyon."))
    ),
    true
  );
  assert.equal(
    state.closeoutEntries.some((entry) => entry.title === "Ferrugem sob as Estrelas" && entry.scope === "module"),
    true
  );
});

test("prior session report for A Chave de Rastro is parsed as active session state", async () => {
  const state = await loadReport("prior_subquest_a_chave_de_rastro_session_02");

  assert.equal(state.questTitle, "A Chave de Rastro");
  assert.equal(state.reportScope, "session");
  assert.equal(state.reportedStatus, "active");
  assert.deepEqual(state.objectiveCounts, {
    completed: 6,
    failed: 0,
    pending: 2
  });
  assert.deepEqual(state.rewardCounts, {
    obtained: 2,
    pending: 3
  });
  assert.equal(state.reportAlerts.length, 1);
  assert.equal(
    state.obtainedRewards.some((entry) => normalize(entry) === normalize("Pista: tres sinais do Satelite - SWIX")),
    true
  );
  assert.equal(
    state.closeoutEntries[0].gmComment.includes("Nikko Varr"),
    true
  );
});

test("session report with multiple closeout entries preserves both closeouts", async () => {
  const state = await loadReport("subquest_rastro_vivo_dentinho");

  assert.equal(state.questTitle, "O Rastro Vivo de Dentinho");
  assert.equal(state.reportScope, "session");
  assert.equal(state.reportedStatus, "completed");
  assert.equal(state.closeoutEntries.length, 2);
  assert.equal(state.closeoutEntries.every((entry) => entry.scope === "session"), true);
  assert.equal(
    state.closeoutEntries.some((entry) => entry.summary.includes("Evitar separar Floyd e Dentinho sem necessidade extrema")),
    true
  );
});
