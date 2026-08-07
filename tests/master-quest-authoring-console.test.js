import assert from "node:assert/strict";
import test from "node:test";
import { createOlfFqlApi } from "../src/api.js";
import { openMasterQuestAuthoringConsole } from "../src/ui/authoring-console.js";

test("authoring console opens through ApplicationV2 without Foundry writes", async () => {
  const api = createOlfFqlApi({
    game: {
      system: { id: "swade", version: "5.2.6", title: "SWADE" }
    }
  });
  const calls = [];

  class FakeApplicationV2 {
    constructor(options = {}) {
      this.options = options;
      this.rendered = false;
    }

    async render(force) {
      calls.push({ type: "render", force });
      this.rendered = true;
      return this;
    }

    async _prepareContext() {
      return {};
    }
  }

  const app = await api.masterQuest.openAuthoringConsole({
    applicationClass: FakeApplicationV2,
    forceNew: true
  });

  assert.equal(app.rendered, true);
  assert.equal(calls.length, 1);
  assert.equal(app.session.mode, "local-authoring-wizard");
  assert.equal(app.session.draft.system, "agnostic");
  assert.equal(app.session.draft.systemProfile.id, "swade");
  assert.equal(app.session.previews.foundryExport.writeMode, "none");
  assert.equal(app.session.previews.foundryExport.readyForWrite, false);
});

test("authoring console reports missing ApplicationV2 instead of falling back to appv1", async () => {
  const api = createOlfFqlApi();
  const warnings = [];
  const result = await openMasterQuestAuthoringConsole({
    api,
    applicationClass: null,
    ui: {
      notifications: {
        warn(message) {
          warnings.push(message);
        }
      }
    }
  });

  assert.equal(result.opened, false);
  assert.equal(result.reason, "missing-application-v2");
  assert.match(warnings[0], /ApplicationV2/);
});

test("authoring console exposes local suggestion controls", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/ui/authoring-console.js", import.meta.url), "utf8"));

  assert.match(source, /data-action="suggest"/);
  assert.match(source, /data-target="complete"/);
  assert.match(source, /suggestElements/);
});
test("authoring console exposes explicit Journal save controls", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/ui/authoring-console.js", import.meta.url), "utf8"));

  assert.match(source, /data-action="save-journal"/);
  assert.match(source, /Save to Journal/);
  assert.match(source, /saveDraftToJournal/);
});

test("authoring console copy buttons are clearly labeled and explained as copy actions", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/ui/authoring-console.js", import.meta.url), "utf8"));

  // Rotulos visiveis deixam claro que copiam.
  assert.match(source, /Copy GM/);
  assert.match(source, /Copy Player/);
  assert.match(source, /Copy Data/);

  // Legenda explica que copiam para a area de transferencia, nao salvam.
  assert.match(source, /mq-copy-note/);
  assert.match(source, /clipboard/);

  // data-action preservados (contrato de UI nao quebrado).
  assert.match(source, /data-action="copy-gm"/);
  assert.match(source, /data-action="copy-player"/);
  assert.match(source, /data-action="copy-json"/);
});

test("authoring console surfaces party and story anchor fields", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/ui/authoring-console.js", import.meta.url), "utf8"));

  assert.match(source, /renderTextarea\("partyAnchors"/);
  assert.match(source, /renderTextarea\("storyAnchors"/);
  assert.match(source, /Party anchors/);
  assert.match(source, /Story anchors/);
  assert.match(source, /partyAnchors: textToList/);
  assert.match(source, /storyAnchors: textToList/);
});

test("createDraft normalizes plain-string anchors coming from the console seed", () => {
  const api = createOlfFqlApi();
  const draft = api.masterQuest.createDraft({
    title: "Anchor test",
    premise: "Testing anchors",
    objectives: ["Reach the outpost"],
    partyAnchors: ["Kaelen"],
    storyAnchors: ["O Pacto de Ferro"]
  });

  assert.equal(draft.partyAnchors[0].label, "Kaelen");
  assert.equal(draft.partyAnchors[0].kind, "pc");
  assert.equal(draft.storyAnchors[0].label, "O Pacto de Ferro");
  assert.equal(draft.storyAnchors[0].kind, "custom");
});

test("authoring console exposes an Advance button only after a successful save", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/ui/authoring-console.js", import.meta.url), "utf8"));

  assert.match(source, /data-action="advance"/);
  assert.match(source, /Advance/);
  assert.match(source, /savedDraft \?/);
  assert.match(source, /advanceToAdventureReview/);
});

test("advanceToAdventureReview requires a saved draft and opens the review", async () => {
  const api = createOlfFqlApi({
    game: { system: { id: "swade", version: "5.2.6", title: "SWADE" } }
  });
  const warns = [];
  const ui = {
    notifications: {
      info: () => {},
      warn: (message) => warns.push(message),
      error: () => {}
    }
  };

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

  const app = await api.masterQuest.openAuthoringConsole({
    applicationClass: FakeApplicationV2,
    forceNew: true,
    ui
  });

  // Sem save: avisa e nao avanca.
  app.advanceToAdventureReview();
  assert.equal(warns.length, 1);

  // Com save: abre a Adventure Review com o draft atual.
  app.savedDraft = { status: "created", journalEntryName: "MasterQuest - Teste" };
  const review = await app.advanceToAdventureReview();
  assert.equal(review.rendered, true);
  assert.equal(review.draft.title, app.session.draft.title);
});