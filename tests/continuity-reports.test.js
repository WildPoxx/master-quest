import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { readJson } from "./helpers.js";

const indexPath = resolve("fixtures/module_1/session_03_closeout/reports.index.json");

test("Session 03 founding continuity reports are indexed and available", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);

  assert.equal(index.caseId, "module_1_session_03_closeout");
  assert.equal(index.reports.length, 6);
  assert.equal(index.moduleReportSubquests.length, 5);

  for (const report of index.reports) {
    const reportPath = resolve(sourceRoot, report.path);
    assert.equal(existsSync(reportPath), true, `${report.path} should exist`);
  }
});

test("module-level report records all Module 1 subquests as completed", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);
  const moduleReport = index.reports.find((report) => report.kind === "module_closeout");
  const text = await readFile(resolve(sourceRoot, moduleReport.path), "utf8");

  assert.match(text, /Quest Principal:\*\* Ferrugem sob as Estrelas/);

  for (const subquest of index.moduleReportSubquests) {
    assert.equal(subquest.status, "completed");
    assert.match(text, new RegExp(escapeRegExp(`| ${subquest.title} | completed |`)));
  }
});

test("A Chave de Rastro is covered by Session 02 report and Session 03 module consolidation", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);
  const chave = index.moduleReportSubquests.find((subquest) => subquest.title === "A Chave de Rastro");
  const priorReport = index.reports.find((report) => report.id === chave.priorReportId);
  const priorText = await readFile(resolve(sourceRoot, priorReport.path), "utf8");

  assert.equal(chave.session03IndividualReportProvided, false);
  assert.equal(chave.priorReportProvided, true);
  assert.equal(priorReport.reportedStatus, "active");
  assert.equal(priorReport.moduleCloseoutStatus, "completed");
  assert.match(priorText, /Quest Principal:\*\* A Chave de Rastro/);
  assert.match(priorText, /Status:\*\* active/);
  assert.match(priorText, /Definir o estado final da Chave ao fim do Ato II/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
