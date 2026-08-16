import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  INTERFACE_SKIN_SETTING,
  INTERFACE_SKINS,
  applyInterfaceSkin,
  getInterfaceSkin,
  normalizeInterfaceSkin,
  refreshOpenMasterQuestSkins,
  registerInterfaceSkinSettings
} from "../src/foundry/skin-settings.js";

test("interface skin is a world setting with parchment as the safe default", () => {
  const registrations = [];
  const document = { querySelectorAll: () => [] };
  const game = {
    settings: {
      register: (...args) => registrations.push(args),
      get: () => "cosmic"
    }
  };

  registerInterfaceSkinSettings({ game, document });

  assert.equal(registrations.length, 1);
  const [moduleId, key, config] = registrations[0];
  assert.equal(moduleId, "master-quest");
  assert.equal(key, INTERFACE_SKIN_SETTING);
  assert.equal(config.scope, "world");
  assert.equal(config.config, true);
  assert.equal(config.default, INTERFACE_SKINS.parchment);
  assert.deepEqual(Object.keys(config.choices), ["pergaminho", "cosmic"]);
  assert.equal(getInterfaceSkin({ game }), INTERFACE_SKINS.cosmic);
  assert.equal(normalizeInterfaceSkin("removed-skin"), INTERFACE_SKINS.parchment);
});

test("skin is attached only to MasterQuest roots and live settings updates refresh open windows", () => {
  const root = { dataset: {}, matches: (selector) => selector === ".masterquest" };
  const content = { closest: (selector) => (selector === ".masterquest" ? root : null) };
  const game = { settings: { get: () => INTERFACE_SKINS.cosmic } };

  assert.equal(applyInterfaceSkin(content, { game }), INTERFACE_SKINS.cosmic);
  assert.equal(root.dataset.mqSkin, INTERFACE_SKINS.cosmic);

  root.dataset = {};
  refreshOpenMasterQuestSkins({ game, document: { querySelectorAll: () => [root] } });
  assert.equal(root.dataset.mqSkin, INTERFACE_SKINS.cosmic);
});

test("every MasterQuest ApplicationV2 surface applies the selected skin at its own root", async () => {
  const files = [
    "src/ui/master-quest-hub.js",
    "src/ui/quest-details.js",
    "src/ui/quest-log.js",
    "src/ui/authoring-console.js",
    "src/ui/import-adventure.js",
    "src/ui/adventure-review.js"
  ];

  for (const file of files) {
    const source = await readFile(resolve(file), "utf8");
    assert.match(source, /applyInterfaceSkin\(content, \{ game: this\.game \}\)/, file);
  }
});
