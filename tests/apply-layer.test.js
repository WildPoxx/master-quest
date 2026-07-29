import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { applyPatchPlan, applyQuestPatch } from "../src/apply/apply-patch-plan.js";
import { generatePatchPlan } from "../src/continuity/patch-plan.js";
import { readQuestStates } from "../src/fql/read-quest-states.js";
import { readJson } from "./helpers.js";

test("apply layer dry-run previews append-subquest-id without writing", async () => {
  const journal = makeMutableJournalDocuments(await readJson(resolve("fixtures/fql/live-snapshot-2026-06-18-tree-anomaly.json")));
  const plan = generatePatchPlan(readQuestStates({ journal }), { now: "2026-06-18T14:20:30.048Z" });
  const beforeParent = getFqlPayload(journal, "PLEaT1CvUVnkpL16");

  const batch = await applyPatchPlan(plan, {
    journal,
    now: "2026-06-18T21:20:00.000Z"
  });

  const result = batch.results[0];
  const afterParent = getFqlPayload(journal, "PLEaT1CvUVnkpL16");

  assert.equal(batch.status, "dry-run");
  assert.equal(result.status, "dry-run");
  assert.equal(result.changedFoundryDocuments, false);
  assert.equal(result.backup.required, true);
  assert.equal(result.backup.created, false);
  assert.equal(result.applied.mutation.appendedValue, "5AE6Io6xzP50ut4X");
  assert.deepEqual(afterParent.subquests, beforeParent.subquests);
});

test("apply layer applies append-subquest-id with backup and post-validation", async () => {
  const journal = makeMutableJournalDocuments(await readJson(resolve("fixtures/fql/live-snapshot-2026-06-18-tree-anomaly.json")));
  const plan = generatePatchPlan(readQuestStates({ journal }), { now: "2026-06-18T14:20:30.048Z" });
  const backups = [];

  const batch = await applyPatchPlan(plan, {
    journal,
    dryRun: false,
    approved: true,
    now: "2026-06-18T21:20:00.000Z",
    createBackup: async (request) => {
      backups.push(request);
      return {
        id: "backup-1",
        entryCount: request.entries.length,
        operation: request.operation
      };
    }
  });

  const result = batch.results[0];
  const parent = getFqlPayload(journal, "PLEaT1CvUVnkpL16");
  const child = getFqlPayload(journal, "5AE6Io6xzP50ut4X");
  const postPlan = generatePatchPlan(readQuestStates({ journal }), { now: "2026-06-18T21:21:00.000Z" });

  assert.equal(batch.status, "completed");
  assert.equal(result.status, "applied");
  assert.equal(result.changedFoundryDocuments, true);
  assert.equal(result.backup.created, true);
  assert.equal(result.backup.record.id, "backup-1");
  assert.equal(result.postValidation.ok, true);
  assert.equal(backups.length, 1);
  assert.equal(backups[0].entries.length, 2);
  assert.deepEqual(parent.subquests, ["Ogk5sjYltcuUXFyu", "5AE6Io6xzP50ut4X"]);
  assert.equal(child.parent, "PLEaT1CvUVnkpL16");
  assert.equal(postPlan.observations.questTopologyIssues.length, 0);
  assert.equal(postPlan.proposedChanges.length, 0);
});

test("post-apply snapshot fixture has no topology patch and direct apply is already-fixed", async () => {
  const repairedJournal = makeMutableJournalDocuments(await readJson(resolve("fixtures/fql/live-snapshot-2026-06-18-tree-repaired.json")));
  const anomalyJournal = makeMutableJournalDocuments(await readJson(resolve("fixtures/fql/live-snapshot-2026-06-18-tree-anomaly.json")));
  const anomalyPlan = generatePatchPlan(readQuestStates({ journal: anomalyJournal }), { now: "2026-06-18T14:20:30.048Z" });
  const repairedPlan = generatePatchPlan(readQuestStates({ journal: repairedJournal }), { now: "2026-06-18T21:14:51.035Z" });

  assert.equal(anomalyPlan.observations.questTopologyIssues.length, 1);
  assert.equal(anomalyPlan.proposedChanges.length, 1);
  assert.equal(repairedPlan.observations.questTopologyIssues.length, 0);
  assert.equal(repairedPlan.proposedChanges.length, 0);

  const result = await applyQuestPatch(anomalyPlan.proposedChanges[0], {
    journal: repairedJournal,
    dryRun: false,
    approved: true,
    createBackup: async () => {
      throw new Error("backup should not be created for already-fixed patches");
    }
  });

  assert.equal(result.status, "already-fixed");
  assert.equal(result.changedFoundryDocuments, false);
  assert.equal(result.backup.created, false);
  assert.equal(result.alreadyFixed, true);
});

function makeMutableJournalDocuments(fixtures) {
  return fixtures.map((fixture) => {
    const doc = structuredClone(fixture);

    doc.getFlag = function getFlag(moduleId, key) {
      return this.flags?.[moduleId]?.[key] ?? null;
    };

    doc.setFlag = async function setFlag(moduleId, key, value) {
      this.flags ??= {};
      this.flags[moduleId] ??= {};
      this.flags[moduleId][key] = structuredClone(value);
      return this;
    };

    return doc;
  });
}

function getFqlPayload(journal, id) {
  return journal.find((doc) => doc.id === id).getFlag("forien-quest-log", "json");
}
