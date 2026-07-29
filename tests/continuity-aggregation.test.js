import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { aggregateContinuityState } from "../src/continuity/aggregate-continuity-state.js";
import { readContinuityReportState } from "../src/continuity/read-continuity-report.js";
import { readJson } from "./helpers.js";

const indexPath = resolve("fixtures/module_1/session_03_closeout/reports.index.json");

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[â€”â€“]/g, "-")
    .toLowerCase();
}

async function loadContinuityReports() {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);

  return Promise.all(
    index.reports.map(async (report) => {
      const sourcePath = resolve(sourceRoot, report.path);
      const text = await readFile(sourcePath, "utf8");
      return readContinuityReportState(text, { sourcePath });
    })
  );
}

test("continuity aggregation prefers later consolidated closeout over prior active FQL state", async () => {
  const continuityReports = await loadContinuityReports();
  const questStates = [
    {
      id: "quest-a-chave",
      uuid: "JournalEntry.quest-a-chave",
      name: "A Chave de Rastro",
      status: "active",
      tasks: [],
      rewards: []
    }
  ];

  const state = aggregateContinuityState({ questStates, continuityReports });
  const quest = state.quests.find((entry) => entry.title === "A Chave de Rastro");

  assert.ok(quest);
  assert.equal(quest.currentQuestStatus, "active");
  assert.equal(quest.continuityStatus?.value, "completed");
  assert.equal(quest.continuityStatus?.scope, "module");
  assert.equal(
    quest.candidatePatchImplications.some((entry) =>
      entry.type === "status-review"
      && entry.currentStatus === "active"
      && entry.continuityStatus === "completed"
    ),
    true
  );
  assert.equal(
    quest.openThreads.some((entry) =>
      entry.type === "pending-objective"
      && normalize(entry.text).includes(normalize("Rastrear assinatura Axyon"))
    ),
    true
  );
  assert.equal(
    quest.uncertainties.some((entry) =>
      entry.type === "continuity-status-conflict"
      && entry.observedStatuses.includes("active")
      && entry.observedStatuses.includes("completed")
    ),
    true
  );
});

test("continuity aggregation keeps open threads visible even when closeout evidence marks quest completed", async () => {
  const continuityReports = await loadContinuityReports();
  const questStates = [
    {
      id: "quest-rastro-vivo",
      uuid: "JournalEntry.quest-rastro-vivo",
      name: "O Rastro Vivo de Dentinho",
      status: "active",
      tasks: [],
      rewards: []
    }
  ];

  const state = aggregateContinuityState({ questStates, continuityReports });
  const quest = state.quests.find((entry) => entry.title === "O Rastro Vivo de Dentinho");

  assert.ok(quest);
  assert.equal(quest.continuityStatus?.value, "completed");
  assert.equal(
    quest.candidatePatchImplications.some((entry) =>
      entry.type === "completed-with-open-threads"
      && entry.openThreadCount > 0
    ),
    true
  );
  assert.equal(
    quest.openThreads.some((entry) =>
      entry.type === "pending-objective"
      && normalize(entry.text).includes(normalize("Convencer Corte/Companhia de que Dentinho nao e so ativo tecnico"))
    ),
    true
  );
});

test("continuity aggregation flags report-only quests that are absent from current FQL state", async () => {
  const continuityReports = await loadContinuityReports();

  const state = aggregateContinuityState({
    questStates: [],
    continuityReports
  });

  const quest = state.quests.find((entry) => entry.title === "O Envenenamento de Lorna");

  assert.ok(quest);
  assert.equal(quest.questId, null);
  assert.equal(quest.continuityStatus?.value, "completed");
  assert.equal(
    quest.candidatePatchImplications.some((entry) => entry.type === "missing-fql-quest"),
    true
  );
});
