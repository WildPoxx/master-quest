import assert from "node:assert/strict";
import test from "node:test";
import {
  continueMasterQuestAuthoringWizard,
  startMasterQuestAuthoringWizard
} from "../src/authoring/master-quest-authoring-wizard.js";

test("startMasterQuestAuthoringWizard creates a local questioning state from a rough idea", () => {
  const wizard = startMasterQuestAuthoringWizard(
    "A station at the border stops answering after a strange light."
  );

  assert.equal(wizard.schemaVersion, 1);
  assert.equal(wizard.mode, "local-authoring-wizard");
  assert.equal(wizard.stage, "questioning");
  assert.equal(wizard.revision, 1);
  assert.equal(wizard.draft.source, "native");
  assert.equal(wizard.assessment.readyForPreview, false);
  assert.equal(wizard.previews.foundryExport.writeMode, "none");
  assert.equal(wizard.previews.foundryExport.readyForWrite, false);
  assert.ok(wizard.questions.some((question) => question.id === "q-missing-objectives"));
  assert.ok(wizard.nextActions.every((action) => action.type === "answer-question"));
});

test("continueMasterQuestAuthoringWizard applies answers and reaches review stage", () => {
  const started = startMasterQuestAuthoringWizard(
    "A station at the border stops answering after a strange light."
  );
  const continued = continueMasterQuestAuthoringWizard(started, {
    "q-missing-title": "Border Light",
    "q-missing-dramatic-question": "Can the posse discover what crossed the border before the station burns?",
    "q-missing-objectives": [
      {
        title: "Reach the silent station",
        successCriteria: "The posse enters before the burn clock fills."
      }
    ],
    "q-missing-opposition": [
      {
        label: "Glass Burn",
        kind: "hazard",
        agenda: "Turn the station into a lure.",
        visibility: "gm"
      }
    ],
    "q-missing-consequence": {
      clocks: [{ label: "Station Burn", max: 6, consequence: "The station becomes unusable." }],
      rewards: [{ title: "Border telemetry", kind: "information", visibility: "player" }]
    },
    "q-missing-player-safe-summary": "A remote border station has gone silent after witnesses saw a strange light."
  });

  assert.equal(continued.sessionId, started.sessionId);
  assert.equal(continued.revision, 2);
  assert.equal(continued.stage, "review");
  assert.equal(continued.draft.title, "Border Light");
  assert.equal(continued.draft.id, "mq-border-light");
  assert.equal(continued.draft.objectives.length, 1);
  assert.equal(continued.draft.threats.length, 1);
  assert.equal(continued.draft.clocks.length, 1);
  assert.equal(continued.draft.rewards.length, 1);
  assert.equal(continued.assessment.readyForPreview, true);
  assert.equal(continued.previews.foundryExport.readyForExportPlan, true);
  assert.ok(continued.nextActions.some((action) => action.type === "review-gm-preview"));
});

test("wizard keeps player-safe preview separated from GM secrets", () => {
  const started = startMasterQuestAuthoringWizard({
    title: "Host Signal",
    premise: "A machine signal is looking for a host.",
    dramaticQuestion: "Can the posse identify the host before activation?",
    objectives: ["Investigate the tremors"],
    threats: [{ label: "Host Algorithm", kind: "environment", visibility: "secret" }],
    rewards: ["Lower vault access"],
    playerSafeSummary: "Tremors point to an old machine below the colony.",
    gmSecrets: [{ label: "Host candidate", notes: "The host is a friendly NPC." }]
  });

  assert.equal(started.stage, "review");
  assert.match(started.previews.gm.markdown, /Host candidate/);
  assert.match(started.previews.gm.markdown, /Host Algorithm/);
  assert.doesNotMatch(started.previews.playerSafe.markdown, /Host candidate/);
  assert.doesNotMatch(started.previews.playerSafe.markdown, /Host Algorithm/);
});

test("wizard API state does not call Foundry-style write methods", () => {
  const throwIfCalled = () => {
    throw new Error("Foundry write should not be called.");
  };
  const foundryLikeObject = {
    get game() {
      throwIfCalled();
    },
    setFlag: throwIfCalled,
    update: throwIfCalled
  };

  const wizard = startMasterQuestAuthoringWizard({
    title: "Local Only",
    premise: "The wizard lives before any Foundry write.",
    dramaticQuestion: "Can it remain inert?",
    objectives: ["Keep the plan local."],
    threats: ["Premature write"],
    rewards: ["Safety"]
  });
  const continued = continueMasterQuestAuthoringWizard(wizard, {
    scenes: [{ title: "Review the plan", challengeType: "social" }]
  });

  assert.equal(wizard.previews.foundryExport.writeMode, "none");
  assert.equal(continued.previews.foundryExport.readyForWrite, false);
  assert.equal(foundryLikeObject.setFlag, throwIfCalled);
});
