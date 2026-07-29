import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { generatePatchPlan } from "../src/continuity/patch-plan.js";
import { readQuestStatesFromSnapshot } from "../src/fql/read-live-snapshot.js";
import { readQuestStates } from "../src/fql/read-quest-states.js";
import { generateGMPatchReview } from "../src/reports/gm-patch-review.js";
import { makeMockJournalDocuments, readJson } from "./helpers.js";

test("patch plan recommends safe parent subquest repair from live snapshot fixture", async () => {
  const fixtures = await readJson(resolve("fixtures/fql/live-snapshot-2026-06-18-tree-anomaly.json"));
  const questStates = readQuestStates({ journal: makeMockJournalDocuments(fixtures) });
  const plan = generatePatchPlan(questStates, { now: "2026-06-18T14:20:30.048Z" });

  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.requiresHumanApproval, true);
  assert.equal(plan.proposedChanges.length, 1);

  const [change] = plan.proposedChanges;
  assert.equal(change.type, "quest-tree-repair");
  assert.equal(change.operation, "append-subquest-id");
  assert.equal(change.status, "recommended");
  assert.equal(change.targetQuestId, "PLEaT1CvUVnkpL16");
  assert.equal(change.targetQuestName, "OLF — Pontas Soltas");
  assert.equal(change.childQuestId, "5AE6Io6xzP50ut4X");
  assert.equal(change.childQuestName, "M01 — Ferrugem sob as Estrelas");
  assert.equal(change.valueToAppend, "5AE6Io6xzP50ut4X");
  assert.equal(change.requiresHumanApproval, true);
  assert.match(change.safeBecause.join("\n"), /No quest status, task, reward, note, or ownership value is changed/);

  assert.deepEqual(
    plan.observations.questTopologyIssues.map((issue) => issue.code),
    ["parent-missing-child-link"]
  );
  assert.match(plan.safety.join("\n"), /No data was changed/);
});

test("full live snapshot fixture feeds patch plan and GM review", async () => {
  const fixtures = await readJson(resolve("fixtures/fql/live-snapshot-2026-06-18-all-quests.compact.json"));
  const snapshot = {
    source: {
      foundryVersion: "13.351",
      systemId: "swade",
      systemVersion: "5.2.6",
      fqlVersion: "v0.9.0"
    },
    fqlQuests: fixtures.map((doc) => ({
      id: doc.id,
      uuid: doc.uuid,
      name: doc.name,
      folderName: doc.folderName,
      ownership: doc.ownership,
      fqlPayload: doc.flags["forien-quest-log"].json,
      olfFlags: doc.flags["outsiders-lost-frontier"] ?? null
    }))
  };

  const questStates = readQuestStatesFromSnapshot(snapshot);
  const plan = generatePatchPlan(questStates, { now: "2026-06-18T14:20:30.048Z" });
  const review = generateGMPatchReview(plan, questStates);

  assert.equal(questStates.length, 14);
  assert.equal(plan.proposedChanges.length, 1);
  assert.equal(plan.proposedChanges[0].operation, "append-subquest-id");
  assert.equal(plan.proposedChanges[0].targetQuestId, "PLEaT1CvUVnkpL16");
  assert.equal(plan.proposedChanges[0].childQuestId, "5AE6Io6xzP50ut4X");
  assert.equal(plan.observations.questTopologyIssues.length, 1);

  assert.match(review, /Quests analisadas: 14/);
  assert.match(review, /Recomendacoes de patch: 1/);
  assert.match(review, /append-subquest-id/);
  assert.match(review, /5AE6Io6xzP50ut4X/);
  assert.match(review, /Quests sem flags OLF: 1/);
  assert.match(review, /Este relatorio e somente leitura/);
});
