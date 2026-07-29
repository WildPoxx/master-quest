import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { readJson } from "./helpers.js";

const indexPath = resolve("fixtures/swade_5_2_6/technical.index.json");

test("SWADE 5.2.6 technical corpus points to real local sources", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);

  assert.equal(index.caseId, "swade_5_2_6_technical_corpus");
  assert.equal(index.systemId, "swade");
  assert.equal(index.version, "5.2.6");
  assert.equal(index.localSources.length >= 9, true);

  for (const source of index.localSources) {
    assert.equal(existsSync(resolve(sourceRoot, source.path)), true, `${source.path} should exist`);
  }
});

test("SWADE 5.2.6 release manifest is pinned to Foundry 13 and exposes core packs", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);
  const manifestPath = resolve(
    sourceRoot,
    index.localSources.find((source) => source.id === "system_manifest_release").path
  );
  const manifest = await readJson(manifestPath);

  assert.equal(manifest.id, "swade");
  assert.equal(manifest.version, "5.2.6");
  assert.equal(Number(manifest.compatibility.minimum), 13.339);
  assert.equal(Number(manifest.compatibility.verified), 13);
  assert.equal(Number(manifest.compatibility.maximum), 13);
  assert.deepEqual(
    manifest.packs.map((pack) => pack.name),
    ["skills", "edges", "hindrances", "powers", "system-docs"]
  );
  assert.equal(manifest.relationships.recommends[0].id, "complete-card-management");
});

test("SWADE source runtime registers custom documents and combat subtypes", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);
  const runtimeEntry = await readFile(
    resolve(sourceRoot, index.localSources.find((source) => source.id === "runtime_entry").path),
    "utf8"
  );
  const combatDoc = await readFile(
    resolve(sourceRoot, index.localSources.find((source) => source.id === "combat_doc").path),
    "utf8"
  );
  const actorDoc = await readFile(
    resolve(sourceRoot, index.localSources.find((source) => source.id === "actor_doc").path),
    "utf8"
  );

  assert.match(runtimeEntry, /CONFIG\.Actor\.documentClass = SwadeActor/);
  assert.match(runtimeEntry, /CONFIG\.Combat\.documentClass = SwadeCombat/);
  assert.match(runtimeEntry, /CONFIG\.ChatMessage\.documentClass = SwadeChatMessage/);
  assert.match(runtimeEntry, /CONFIG\.Combat\.dataModels = data\.combat\.combatConfig/);

  assert.match(combatDoc, /typeSelect\.value === 'dramaticTask'/);
  assert.match(combatDoc, /actionDeck/);
  assert.match(combatDoc, /spendBenny/);

  assert.match(actorDoc, /get hasJoker/);
  assert.match(actorDoc, /get bennies/);
  assert.match(actorDoc, /hasArcaneBackground/);
});

test("SWADE baseline docs preserve the GM-helper and separate-skill decisions", async () => {
  const baselineDoc = await readFile(resolve("docs/17_SWADE_5_2_6_FVTT_Baseline.md"), "utf8");
  const skillSpecDoc = await readFile(resolve("docs/18_SWADE_FVTT_Skill_Spec.md"), "utf8");

  assert.match(baselineDoc, /Foundry VTT 13\.351/);
  assert.match(baselineDoc, /Dramatic Tasks/);
  assert.match(baselineDoc, /Joker's Wild/);
  assert.match(baselineDoc, /base ja esta suficiente/);

  assert.match(skillSpecDoc, /swade-fvtt-mechanics-model/);
  assert.match(skillSpecDoc, /skill de SWADE-FVTT separada/);
  assert.match(skillSpecDoc, /nao automatizar decisao narrativa de mestre/);
});
