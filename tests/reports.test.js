import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { generatePatchPlan } from "../src/continuity/patch-plan.js";
import { readQuestStates } from "../src/fql/read-quest-states.js";
import { generateGMReport } from "../src/reports/gm-report.js";
import { generatePlayerRecap } from "../src/reports/player-recap.js";
import { makeMockJournalDocuments, readJson } from "./helpers.js";

async function getStates() {
  const fixtures = await readJson(resolve("fixtures/fql/sample-journal-quests.json"));
  return readQuestStates({ journal: makeMockJournalDocuments(fixtures) });
}

test("GM report may include private GM material", async () => {
  const report = generateGMReport(await getStates());

  assert.match(report, /Secret Cassian pressure/);
  assert.match(report, /Hidden leverage against Cassian/);
  assert.match(report, /Hidden Faction Clock/);
});

test("player recap excludes GM notes, hidden quests, hidden tasks, and hidden rewards", async () => {
  const recap = generatePlayerRecap(await getStates());

  assert.match(recap, /The convoy case remains open/);
  assert.match(recap, /Find the relay survivor/);
  assert.match(recap, /Public salvage access/);
  assert.doesNotMatch(recap, /Secret Cassian/);
  assert.doesNotMatch(recap, /Hidden leverage against Cassian/);
  assert.doesNotMatch(recap, /Faction secret/);
  assert.doesNotMatch(recap, /Hidden Faction Clock/);
});

test("patch plan is dry-run, approval-gated, and deterministic with fixed time", async () => {
  const questStates = await getStates();
  const options = { now: "2026-06-08T00:00:00.000Z" };
  const first = generatePatchPlan(questStates, options);
  const second = generatePatchPlan(questStates, options);

  assert.deepEqual(first, second);
  assert.equal(first.mode, "dry-run");
  assert.equal(first.requiresHumanApproval, true);
  assert.deepEqual(first.proposedChanges, []);
  assert.match(first.safety.join("\n"), /No quest was completed/);
});
