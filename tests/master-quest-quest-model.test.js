import assert from "node:assert/strict";
import test from "node:test";
import { createOlfFqlApi } from "../src/api.js";
import {
  generateMasterQuestQuestModel,
  generateMasterQuestQuestPreviewText
} from "../src/authoring/master-quest-quest-model.js";

test("quest model is a preview that never writes to Foundry", () => {
  const model = generateMasterQuestQuestModel({ title: "T", premise: "P" });

  assert.equal(model.kind, "master-quest-quest-model");
  assert.equal(model.writeMode, "none");
  assert.equal(model.mode, "preview");
  assert.ok(model.safety.some((entry) => /no journalentry/i.test(entry)));
});

test("quest model marks player-facing and GM-only content correctly", () => {
  const model = generateMasterQuestQuestModel({
    title: "Rota ao Junkyard",
    premise: "Cruzar a fronteira de sucata.",
    objectives: ["Cruzar a fronteira"],
    rewards: ["Mapa do atalho"],
    clues: ["Marca de pneu"],
    threats: ["Abutres de Aço"],
    gmSecrets: ["A ponte está minada"]
  });

  assert.equal(model.quest.title, "Rota ao Junkyard");
  assert.equal(model.quest.objectives[0].title, "Cruzar a fronteira");
  assert.equal(model.quest.objectives[0].visibility, "player");
  assert.equal(model.quest.rewards[0].visibility, "player");
  assert.equal(model.quest.clues[0].visibility, "gm");
  assert.equal(model.quest.threats[0].visibility, "gm");
  assert.equal(model.quest.secrets[0].visibility, "gm");
});

test("quest model derives optional subquests from scenes", () => {
  const model = generateMasterQuestQuestModel({
    title: "T",
    premise: "P",
    scenes: ["Emboscada na ravina", "Travessia da ponte"]
  });

  assert.equal(model.subquests.length, 2);
  assert.equal(model.subquests[0].title, "Emboscada na ravina");
  assert.equal(model.subquests[0].source, "scene");
  assert.equal(model.counts.subquests, 2);
});

test("quest preview text lists structured sections and the safety block", () => {
  const model = generateMasterQuestQuestModel({
    title: "Rota",
    premise: "P",
    objectives: ["Cruzar"],
    rewards: ["Mapa"]
  });
  const text = generateMasterQuestQuestPreviewText(model);

  assert.match(text, /Quest Preview: Rota/);
  assert.match(text, /Objetivos/);
  assert.match(text, /Cruzar/);
  assert.match(text, /Segurança/);
  assert.match(text, /writeMode: none/);
});

test("api exposes quest model generation with the runtime system profile", () => {
  const api = createOlfFqlApi({
    game: { system: { id: "swade", version: "5.2.6", title: "SWADE" } }
  });
  const model = api.masterQuest.generateQuestModel({ title: "T", premise: "P" });

  assert.equal(model.writeMode, "none");
  assert.ok(model.systemProfile);
  assert.equal(model.systemProfile.id, "swade");
});
