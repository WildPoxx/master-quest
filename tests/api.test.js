import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { createOlfFqlApi } from "../src/api.js";
import { makeMockJournalDocuments, readJson } from "./helpers.js";

test("public API exposes the planned MVP methods", async () => {
  const fixtures = await readJson(resolve("fixtures/fql/sample-journal-quests.json"));
  const game = { journal: makeMockJournalDocuments(fixtures) };
  const api = createOlfFqlApi({ game });

  assert.equal(api.moduleId, "master-quest");
  assert.equal(typeof api.readQuestStates, "function");
  assert.equal(typeof api.assessQuestMigration, "function");
  assert.equal(typeof api.readAdventureJournalIndex, "function");
  assert.equal(typeof api.generateGMReport, "function");
  assert.equal(typeof api.generatePlayerRecap, "function");
  assert.equal(typeof api.generatePatchPlan, "function");
  assert.equal(typeof api.generateGMPatchReview, "function");
  assert.equal(typeof api.applyPatchPlan, "function");
  assert.equal(typeof api.detectMasterQuestSystemProfile, "function");
  assert.equal(typeof api.createMasterQuestDraft, "function");
  assert.equal(typeof api.assessMasterQuestDraft, "function");
  assert.equal(typeof api.generateMasterQuestAuthoringQuestions, "function");
  assert.equal(typeof api.generateMasterQuestPreview, "function");
  assert.equal(typeof api.suggestMasterQuestElements, "function");
  assert.equal(typeof api.generateMasterQuestFoundryExportPreview, "function");
  assert.equal(typeof api.generateMasterQuestImportPreview, "function");
  assert.equal(typeof api.saveMasterQuestDraftToJournal, "function");
  assert.equal(typeof api.startMasterQuestAuthoringWizard, "function");
  assert.equal(typeof api.continueMasterQuestAuthoringWizard, "function");
  assert.equal(typeof api.openMasterQuestAuthoringConsole, "function");
  assert.equal(typeof api.startCloseoutWizard, "function");
  assert.equal(typeof api.masterQuest.createDraft, "function");
  assert.equal(typeof api.masterQuest.detectSystemProfile, "function");
  assert.equal(typeof api.masterQuest.generateImportPreview, "function");
  assert.equal(typeof api.masterQuest.suggestElements, "function");
  assert.equal(typeof api.masterQuest.saveDraftToJournal, "function");
  assert.equal(typeof api.masterQuest.openAuthoringConsole, "function");
  assert.equal(typeof api.legacyFql.readQuestStates, "function");
  assert.equal(api.readQuestStates().length, 2);
});

test("public MasterQuest authoring API does not touch Foundry context", () => {
  const api = createOlfFqlApi({
    get game() {
      throw new Error("Authoring API should not resolve Foundry game context.");
    }
  });

  const draft = api.masterQuest.createDraft({
    title: "Clean Draft",
    premise: "A native quest is created locally.",
    dramaticQuestion: "Can it stay detached from Foundry writes?",
    objectives: ["Create a local plan."],
    threats: ["Premature mutation"],
    rewards: ["A safe preview"]
  });

  const assessment = api.masterQuest.assessDraft(draft);
  const playerPreview = api.masterQuest.generatePreview(draft, { audience: "player" });
  const suggestion = api.masterQuest.suggestElements(draft, { target: "clues" });
  const exportPreview = api.masterQuest.generateFoundryExportPreview(draft);
  const importPreview = api.masterQuest.generateImportPreview("A source text for a later draft.");
  const wizard = api.masterQuest.startAuthoringWizard(draft);
  const continuedWizard = api.masterQuest.continueAuthoringWizard(wizard, {
    scenes: [{ title: "Safe local review", challengeType: "social" }]
  });

  assert.equal(draft.source, "native");
  assert.equal(draft.system, "agnostic");
  assert.equal(draft.foundryMapping.writeMode, "none");
  assert.equal(assessment.readyForFoundryExport, false);
  assert.equal(playerPreview.audience, "player-safe");
  assert.equal(suggestion.mode, "local-authoring-assistant");
  assert.equal(suggestion.target, "clues");
  assert.equal(exportPreview.writeMode, "none");
  assert.equal(exportPreview.readyForWrite, false);
  assert.equal(importPreview.writeMode, "none");
  assert.equal(wizard.mode, "local-authoring-wizard");
  assert.equal(continuedWizard.previews.foundryExport.writeMode, "none");
});

