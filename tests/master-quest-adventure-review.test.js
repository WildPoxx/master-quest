import assert from "node:assert/strict";
import test from "node:test";
import { createOlfFqlApi } from "../src/api.js";
import { masterQuestDraftToSeed } from "../src/authoring/master-quest-authoring.js";
import {
  openMasterQuestAdventureReview,
  renderAdventureReview
} from "../src/ui/adventure-review.js";

class FakeApplicationV2 {
  constructor(options = {}) {
    this.options = options;
  }

  async render() {
    this.rendered = true;
    return this;
  }

  async _prepareContext() {
    return {};
  }
}

test("adventure review refuses to open without a reviewable draft", async () => {
  const warns = [];
  const result = await openMasterQuestAdventureReview({
    draft: null,
    applicationClass: FakeApplicationV2,
    ui: { notifications: { warn: (message) => warns.push(message) } }
  });

  assert.equal(result.opened, false);
  assert.equal(result.reason, "missing-draft");
  assert.equal(warns.length, 1);
});

test("adventure review reports missing ApplicationV2 instead of guessing", async () => {
  const api = createOlfFqlApi();
  const draft = api.masterQuest.createDraft({ title: "T", premise: "P" });
  const warns = [];

  const result = await openMasterQuestAdventureReview({
    api,
    draft,
    applicationClass: null,
    ui: { notifications: { warn: (message) => warns.push(message) } }
  });

  assert.equal(result.opened, false);
  assert.equal(result.reason, "missing-application-v2");
  assert.match(warns[0], /ApplicationV2/);
});

test("renderAdventureReview produces a read-only structured planning document", () => {
  const api = createOlfFqlApi({
    game: { system: { id: "swade", version: "5.2.6", title: "SWADE" } }
  });
  const draft = api.masterQuest.createDraft({
    title: "Rota ao Junkyard",
    premise: "A party precisa cruzar a fronteira de sucata.",
    dramaticQuestion: "Eles chegam antes da tempestade?",
    objectives: ["Cruzar a fronteira"],
    threats: ["Abutres de Aço"],
    clues: ["Marca de pneu fresca"],
    rewards: ["Mapa do atalho"],
    partyAnchors: ["Kaelen"],
    storyAnchors: ["O Pacto de Ferro"]
  });

  const html = renderAdventureReview({ draft, systemProfile: draft.systemProfile });

  assert.match(html, /Adventure Review/);
  assert.match(html, /Rota ao Junkyard/);
  assert.match(html, /Somente leitura/);
  assert.match(html, /data-action="close-review"/);
  assert.match(html, /Objetivos/);
  assert.match(html, /Cruzar a fronteira/);
  assert.match(html, /Abutres de Aço/);
  assert.match(html, /Party anchors/);
  assert.match(html, /Kaelen/);
  assert.match(html, /Story anchors/);
  assert.match(html, /O Pacto de Ferro/);
});

test("renderAdventureReview shows empty sections as planned-but-empty, never crashing", () => {
  const api = createOlfFqlApi();
  const draft = api.masterQuest.createDraft({ title: "Esqueleto", premise: "Só o começo." });

  const html = renderAdventureReview({ draft, systemProfile: null });

  assert.match(html, /Esqueleto/);
  assert.match(html, /Nada planejado ainda\./);
  assert.match(html, /Agnostic/);
});

test("opening the adventure review renders through the provided ApplicationV2", async () => {
  const api = createOlfFqlApi();
  const draft = api.masterQuest.createDraft({ title: "T", premise: "P" });

  const review = await openMasterQuestAdventureReview({
    api,
    draft,
    applicationClass: FakeApplicationV2,
    forceNew: true,
    ui: { notifications: {} }
  });

  assert.equal(review.rendered, true);
  assert.equal(review.draft.title, "T");
});

test("masterQuestDraftToSeed flattens draft objects back into editable string lists", () => {
  const api = createOlfFqlApi();
  const draft = api.masterQuest.createDraft({
    title: "T",
    premise: "P",
    objectives: ["A", "B"],
    clues: ["C"],
    partyAnchors: ["Kaelen"]
  });

  const seed = masterQuestDraftToSeed(draft);
  assert.equal(seed.title, "T");
  assert.deepEqual(seed.objectives, ["A", "B"]);
  assert.deepEqual(seed.clues, ["C"]);
  assert.deepEqual(seed.partyAnchors, ["Kaelen"]);
});

test("adventure review back-to-draft reopens the console with the draft content", async () => {
  const api = createOlfFqlApi();
  const draft = api.masterQuest.createDraft({
    title: "Rota",
    premise: "P",
    objectives: ["Cruzar a fronteira"]
  });

  const review = await openMasterQuestAdventureReview({
    api,
    draft,
    applicationClass: FakeApplicationV2,
    forceNew: true,
    ui: { notifications: {} }
  });

  const consoleApp = await review.backToDraft();
  assert.equal(consoleApp.seed.title, "Rota");
  assert.deepEqual(consoleApp.seed.objectives, ["Cruzar a fronteira"]);
});

test("adventure review suggest action reopens the console with merged suggestions", async () => {
  const api = createOlfFqlApi({
    game: { system: { id: "swade", version: "5.2.6", title: "SWADE" } }
  });
  const draft = api.masterQuest.createDraft({
    title: "Rota",
    premise: "A party precisa cruzar a fronteira de sucata.",
    objectives: ["Cruzar a fronteira"]
  });

  const review = await openMasterQuestAdventureReview({
    api,
    draft,
    applicationClass: FakeApplicationV2,
    forceNew: true,
    ui: { notifications: {} }
  });

  const consoleApp = await review.suggestAndEdit("objectives");
  assert.ok(Array.isArray(consoleApp.seed.objectives));
  assert.ok(consoleApp.seed.objectives.includes("Cruzar a fronteira"));
});
