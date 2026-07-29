import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { assessQuestMigration } from "../src/fql/assess-quest-migration.js";
import { makeMockJournalDocuments, readJson } from "./helpers.js";

test("assesses clean legacy quests as pass-through and preserves unknown fields", async () => {
  const fixtures = await readJson(resolve("fixtures/fql/sample-migration-cases.json"));
  const journal = makeMockJournalDocuments(fixtures);
  const assessments = assessQuestMigration({ journal });

  const clean = assessments.find((entry) => entry.questId === "quest-clean");

  assert.equal(clean.strategy, "pass-through");
  assert.equal(clean.legacyPayloadLooksSafe, true);
  assert.deepEqual(clean.preserveUnknownFields, ["customMystery"]);
  assert.equal(clean.issueCount, 0);
});

test("assesses malformed legacy quests with explicit repair actions", async () => {
  const fixtures = await readJson(resolve("fixtures/fql/sample-migration-cases.json"));
  const journal = makeMockJournalDocuments(fixtures);
  const assessments = assessQuestMigration({ journal });

  const broken = assessments.find((entry) => entry.questId === "quest-broken");
  const codes = broken.issues.map((entry) => entry.code);

  assert.equal(broken.strategy, "manual-review");
  assert.equal(broken.legacyPayloadLooksSafe, false);
  assert.equal(broken.targetStatus, "inactive");
  assert.ok(codes.includes("invalid-status"));
  assert.ok(codes.includes("task-missing-title"));
  assert.ok(codes.includes("task-not-object"));
  assert.ok(codes.includes("reward-missing-uuid"));
  assert.ok(codes.includes("reward-missing-data"));
  assert.ok(codes.includes("parent-invalid"));
  assert.ok(codes.includes("subquest-id-invalid"));
  assert.ok(broken.recommendedActions.includes("repair-parent-link"));
  assert.ok(broken.recommendedActions.includes("sanitize-reward"));
});
