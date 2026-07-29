import assert from "node:assert/strict";
import test from "node:test";
import {
  assessMasterQuestDraft,
  createMasterQuestDraft,
  generateMasterQuestAuthoringQuestions,
  generateMasterQuestPreview,
  suggestMasterQuestElements
} from "../src/authoring/master-quest-authoring.js";

test("createMasterQuestDraft normalizes a short briefing into a native local draft", () => {
  const draft = createMasterQuestDraft("A broken signal calls the posse into the Junkyard.");

  assert.equal(draft.schemaVersion, 1);
  assert.equal(draft.title, "Untitled MasterQuest");
  assert.equal(draft.id, "mq-untitled-masterquest");
  assert.equal(draft.scope, "quest");
  assert.equal(draft.status, "draft");
  assert.equal(draft.system, "agnostic");
  assert.equal(draft.systemProfile, null);
  assert.equal(draft.source, "native");
  assert.equal(draft.premise, "A broken signal calls the posse into the Junkyard.");
  assert.equal(draft.foundryMapping.writeMode, "none");
  assert.equal(draft.foundryMapping.fqlStrategy, "none");
  assert.equal(Object.hasOwn(draft, "flags"), false);
  assert.equal(draft.challengeSuggestions.some((suggestion) => suggestion.includes("SWADE")), false);

  const assessment = assessMasterQuestDraft(draft);
  assert.equal(assessment.readyForPreview, false);
  assert.equal(assessment.readyForFoundryExport, false);
  assert.deepEqual(
    assessment.missing.map((issue) => issue.code).filter((code) => code !== "missing-title"),
    [
      "missing-dramatic-question",
      "missing-objectives",
      "missing-opposition",
      "missing-consequence"
    ]
  );
});

test("createMasterQuestDraft preserves a complete native authoring seed", () => {
  const draft = createMasterQuestDraft({
    id: "mq-junkyard-hounds-test",
    title: "The Junkyard Hounds",
    systemProfile: "swade",
    premise: "The posse follows an impossible memory signal into the Junkyard.",
    dramaticQuestion: "Can the posse recover the signal before the route collapses?",
    playerSafeSummary: "A strange signal points toward an old machine graveyard.",
    continuityMode: "mid-campaign",
    partyAnchors: [{ label: "Jax", kind: "pc", role: "scout" }],
    objectives: [
      {
        title: "Reach the signal perimeter",
        successCriteria: "The posse enters the Junkyard without losing the trail.",
        failureConsequence: "The route pressure clock advances."
      }
    ],
    scenes: [
      {
        title: "Pressure on the Route",
        purpose: "Stress the crossing before arrival.",
        challengeType: "dramatic-task",
        gmNotes: "Escalate only if the players ignore the signal drift."
      }
    ],
    threats: [
      {
        label: "Steel Vultures",
        kind: "creature",
        agenda: "Follow the expedition and strike at exposed gear.",
        visibility: "gm",
        swadeRole: "supporting threat"
      }
    ],
    clues: [
      {
        label: "Dermal tracker residue",
        summary: "A residue pattern suggests someone tagged the route.",
        visibility: "player"
      }
    ],
    rewards: [
      {
        title: "Old field map",
        kind: "information",
        visibility: "player",
        unlockCondition: "Recovered from the signal cache."
      }
    ],
    gmSecrets: ["The signal is not a distress call; it is a filter."],
    clocks: [{ label: "Route Pressure", max: 6, consequence: "The safest path closes." }]
  });

  assert.equal(draft.id, "mq-junkyard-hounds-test");
  assert.equal(draft.title, "The Junkyard Hounds");
  assert.equal(draft.system, "agnostic");
  assert.equal(draft.systemProfile.id, "swade");
  assert.equal(draft.systemProfile.version, "5.2.6");
  assert.equal(draft.contextProfile.continuityMode, "mid-campaign");
  assert.equal(draft.objectives[0].id, "mq-obj-reach-the-signal-perimeter");
  assert.equal(draft.scenes[0].challengeType, "dramatic-task");
  assert.equal(draft.threats[0].kind, "creature");
  assert.equal(draft.rewards[0].kind, "information");
  assert.equal(draft.challengeSuggestions.some((suggestion) => suggestion.includes("SWADE")), false);
  assert.ok(draft.systemProfile.suggestions.some((suggestion) => suggestion.includes("SWADE profile")));
  assert.ok(draft.spotlightSuggestions.some((suggestion) => suggestion.includes("Jax")));

  const assessment = assessMasterQuestDraft(draft);
  assert.equal(assessment.readyForPreview, true);
  assert.equal(assessment.readyForFoundryExport, false);
  assert.equal(assessment.missing.length, 0);
});

test("generateMasterQuestAuthoringQuestions asks for missing hybrid-flow inputs", () => {
  const result = generateMasterQuestAuthoringQuestions({
    title: "Ash Gate"
  });

  const questionCodes = result.questions.map((question) => question.code);
  assert.ok(questionCodes.includes("missing-premise"));
  assert.ok(questionCodes.includes("missing-dramatic-question"));
  assert.ok(questionCodes.includes("missing-objectives"));
  assert.ok(questionCodes.includes("missing-opposition"));
  assert.ok(questionCodes.includes("missing-consequence"));
  assert.ok(result.questions.every((question) => question.prompt.length > 0));
});


test("suggestMasterQuestElements derives operational fields from creative inputs", () => {
  const suggestion = suggestMasterQuestElements({
    title: "Black Sun Choir",
    premise: "A future city begins singing in the voice of a dead star-god.",
    dramaticQuestion: "Can the heroes stop the hymn before it rewrites everyone?",
    playerSafeSummary: "A forbidden signal is spreading through the city."
  });

  assert.equal(suggestion.mode, "local-authoring-assistant");
  assert.equal(suggestion.target, "complete");
  assert.ok(suggestion.fieldSuggestions.objectives.length >= 3);
  assert.ok(suggestion.fieldSuggestions.clues.length >= 3);
  assert.ok(suggestion.fieldSuggestions.rewards.length >= 3);
  assert.ok(suggestion.fieldSuggestions.riskNotes.some((note) => note.includes("pista critica")));
  assert.ok(suggestion.safety.some((line) => line.includes("No Foundry document")));
});
test("generateMasterQuestPreview separates GM material from player-safe preview", () => {
  const draft = createMasterQuestDraft({
    title: "The Quiet Engine",
    premise: "A buried engine is waking under the colony.",
    dramaticQuestion: "Will the posse shut it down before it chooses a host?",
    playerSafeSummary: "Unexplained tremors point to an old machine below the colony.",
    objectives: [
      { title: "Find the access shaft", visibility: "player" },
      { title: "Identify the host candidate", kind: "hidden", visibility: "secret" }
    ],
    threats: [
      { label: "The Engine Mind", kind: "environment", agenda: "Choose a host.", visibility: "secret" },
      { label: "Public tremors", kind: "hazard", visibility: "player" }
    ],
    rewards: [{ title: "Access to the lower vault", visibility: "player" }],
    gmSecrets: [{ label: "Host candidate", notes: "The likely host is a friendly NPC." }],
    riskNotes: ["Do not reveal the host candidate until the third clue."]
  });

  const gmPreview = generateMasterQuestPreview(draft, { audience: "gm" });
  const playerPreview = generateMasterQuestPreview(draft, { audience: "player-safe" });

  assert.equal(gmPreview.audience, "gm");
  assert.match(gmPreview.markdown, /Host candidate/);
  assert.match(gmPreview.markdown, /The Engine Mind/);
  assert.match(gmPreview.markdown, /Do not reveal/);

  assert.equal(playerPreview.audience, "player-safe");
  assert.match(playerPreview.markdown, /Unexplained tremors/);
  assert.match(playerPreview.markdown, /Find the access shaft/);
  assert.match(playerPreview.markdown, /Access to the lower vault/);
  assert.doesNotMatch(playerPreview.markdown, /Host candidate/);
  assert.doesNotMatch(playerPreview.markdown, /The Engine Mind/);
  assert.doesNotMatch(playerPreview.markdown, /Do not reveal/);
});

test("native authoring API does not require or mutate Foundry-style objects", async () => {
  const draft = createMasterQuestDraft({
    title: "No Foundry Write",
    premise: "A local draft exists before any world write.",
    dramaticQuestion: "Can it remain local?",
    objectives: ["Prove the draft path is clean."],
    threats: ["Process confusion"],
    rewards: ["A safer workflow"]
  });

  const throwIfCalled = () => {
    throw new Error("Foundry write should not be called by authoring v0.1");
  };
  const fakeJournalEntry = {
    getFlag: throwIfCalled,
    setFlag: throwIfCalled,
    update: throwIfCalled
  };

  const assessment = assessMasterQuestDraft(draft);
  const questions = generateMasterQuestAuthoringQuestions(draft);
  const preview = generateMasterQuestPreview(draft, { audience: "gm" });

  assert.equal(assessment.readyForFoundryExport, false);
  assert.equal(questions.draftId, draft.id);
  assert.equal(preview.draftId, draft.id);
  assert.equal(fakeJournalEntry.setFlag, throwIfCalled);
});

