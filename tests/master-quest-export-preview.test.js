import assert from "node:assert/strict";
import test from "node:test";
import { createMasterQuestDraft } from "../src/authoring/master-quest-authoring.js";
import { generateMasterQuestFoundryExportPreview } from "../src/authoring/master-quest-export-preview.js";

test("generateMasterQuestFoundryExportPreview creates a write-disabled Foundry plan", () => {
  const draft = createMasterQuestDraft({
    id: "mq-signal-cache",
    title: "Signal Cache",
    premise: "The posse tracks a memory signal into a buried relay.",
    dramaticQuestion: "Can they recover the relay before a rival faction burns it?",
    playerSafeSummary: "A strange relay signal points toward a buried cache.",
    objectives: [
      {
        title: "Find the relay entrance",
        successCriteria: "The entrance is located before the pressure clock fills."
      }
    ],
    scenes: [
      {
        title: "Dust Crossing",
        purpose: "Put travel pressure on the party.",
        challengeType: "dramatic-task"
      }
    ],
    threats: [
      {
        label: "Rival scavenger cell",
        kind: "faction",
        agenda: "Burn the relay before anyone reads it.",
        visibility: "gm"
      }
    ],
    clues: [{ label: "Pulse echo", summary: "The relay repeats a pre-Fall code.", visibility: "player" }],
    rewards: [{ title: "Relay coordinates", kind: "information", visibility: "player" }],
    clocks: [{ label: "Relay Burn", max: 6, consequence: "The rival cell destroys the signal core." }]
  });

  const preview = generateMasterQuestFoundryExportPreview(draft);

  assert.equal(preview.schemaVersion, 1);
  assert.equal(preview.mode, "preview-only");
  assert.equal(preview.writeMode, "none");
  assert.equal(preview.readyForExportPlan, true);
  assert.equal(preview.readyForWrite, false);
  assert.equal(preview.target.platform, "foundry-vtt");
  assert.equal(preview.target.foundryVersion, "13.351");
  assert.equal(preview.target.system, "agnostic");
  assert.equal(preview.target.systemProfile, null);
  assert.equal(preview.plannedDocuments.folders.length, 1);
  assert.equal(preview.plannedDocuments.journalEntries.length, 1);
  assert.equal(preview.plannedDocuments.questOps.length, 1);
  assert.ok(preview.operations.length > 3);
  assert.ok(preview.operations.every((operation) => operation.writeCapable === false));
  assert.ok(preview.operations.every((operation) => operation.requiresFutureApproval === true));
  assert.equal(preview.plannedDocuments.questOps[0].fqlStrategy, "none");
});

test("export preview carries optional SWADE profile without making it required", () => {
  const draft = createMasterQuestDraft({
    title: "SWADE Profile Check",
    premise: "A profile can guide OLF without becoming the core system.",
    dramaticQuestion: "Can the profile remain optional?",
    systemProfile: "swade",
    objectives: ["Keep the core agnostic."],
    scenes: [{ title: "Pressure test", challengeType: "dramatic-task" }],
    threats: [{ label: "Clock pressure", kind: "clock", swadeRole: "dramatic task pressure" }],
    rewards: ["A cleaner architecture"]
  });

  const preview = generateMasterQuestFoundryExportPreview(draft);
  const systemPage = preview.plannedDocuments.journalEntries[0].pages.find((page) => page.id === "system-profile");

  assert.equal(preview.target.system, "agnostic");
  assert.equal(preview.target.systemProfile.id, "swade");
  assert.match(systemPage.markdown, /SWADE 5\.2\.6/);
  assert.match(systemPage.markdown, /SWADE profile/);
});

test("export preview keeps GM secrets out of the player page", () => {
  const draft = createMasterQuestDraft({
    title: "Buried Host",
    premise: "A machine below the colony is choosing a host.",
    dramaticQuestion: "Can the posse identify the host before activation?",
    playerSafeSummary: "Unexplained tremors point to machinery beneath the colony.",
    objectives: [
      { title: "Investigate the tremors", visibility: "player" },
      { title: "Find the host candidate", kind: "hidden", visibility: "secret" }
    ],
    threats: [
      { label: "Host Algorithm", kind: "environment", visibility: "secret" },
      { label: "Public tremors", kind: "hazard", visibility: "player" }
    ],
    rewards: [{ title: "Lower vault access", visibility: "player" }],
    gmSecrets: [{ label: "Host candidate", notes: "The host is a friendly NPC." }]
  });

  const preview = generateMasterQuestFoundryExportPreview(draft);
  const journal = preview.plannedDocuments.journalEntries[0];
  const gmPage = journal.pages.find((page) => page.id === "gm-overview");
  const playerPage = journal.pages.find((page) => page.id === "player-brief");
  const secretPage = journal.pages.find((page) => page.id === "gm-secrets");

  assert.match(gmPage.markdown, /Host Algorithm/);
  assert.match(secretPage.markdown, /Host candidate/);
  assert.match(playerPage.markdown, /Unexplained tremors/);
  assert.doesNotMatch(playerPage.markdown, /Host Algorithm/);
  assert.doesNotMatch(playerPage.markdown, /Host candidate/);
});

test("export preview reports blockers for incomplete drafts", () => {
  const preview = generateMasterQuestFoundryExportPreview({
    title: "Thin Idea",
    premise: "Something is wrong at the border station."
  });

  assert.equal(preview.readyForExportPlan, false);
  assert.equal(preview.readyForWrite, false);
  assert.ok(preview.blockers.some((issue) => issue.code === "missing-dramatic-question"));
  assert.ok(preview.blockers.some((issue) => issue.code === "missing-objectives"));
  assert.ok(preview.blockers.some((issue) => issue.code === "missing-opposition"));
  assert.ok(preview.blockers.some((issue) => issue.code === "missing-consequence"));
  assert.equal(preview.plannedDocuments.journalEntries.length, 1);
});

test("export preview never calls Foundry document methods", () => {
  const draft = createMasterQuestDraft({
    title: "Local Export Preview",
    premise: "The GM wants to inspect a plan before writing.",
    dramaticQuestion: "Can the preview stay inert?",
    objectives: ["Inspect the plan."],
    threats: ["Premature write."],
    rewards: ["Confidence."]
  });

  const throwIfCalled = () => {
    throw new Error("Foundry write should not be called.");
  };
  const foundryLikeObject = {
    create: throwIfCalled,
    update: throwIfCalled,
    setFlag: throwIfCalled
  };

  const preview = generateMasterQuestFoundryExportPreview(draft);

  assert.equal(preview.writeMode, "none");
  assert.ok(preview.safety.some((line) => line.includes("No setFlag")));
  assert.equal(foundryLikeObject.setFlag, throwIfCalled);
});
