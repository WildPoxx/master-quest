import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  FOUNDRY_CORE_KEY_FILES,
  readZip,
  readZipEntryText
} from "../scripts/build-foundry-core-index.js";
import { readJson } from "./helpers.js";

const moduleDir = resolve(".");

test("Foundry 13.351 core ZIP baseline points to the real local release", async () => {
  const index = await readJson(resolve(moduleDir, "fixtures/foundry_13_351/core.index.json"));
  const zipPath = resolve(moduleDir, index.source.zipPath);

  assert.equal(index.schemaVersion, 1);
  assert.equal(index.source.zipFileName, "FoundryVTT-Linux-13.351.zip");
  assert.equal(existsSync(zipPath), true, "Foundry 13.351 ZIP should exist beside the module folder");

  const zip = await readZip(zipPath);
  const packageJson = JSON.parse(readZipEntryText(zip, "resources/app/package.json"));

  assert.equal(packageJson.name, "foundryvtt");
  assert.equal(packageJson.version, "13.351.0");
  assert.equal(packageJson.release.generation, 13);
  assert.equal(packageJson.release.build, 351);
  assert.equal(packageJson.release.node_version, 20);
  assert.equal(index.release.version, packageJson.version);
  assert.equal(index.release.generation, packageJson.release.generation);
  assert.equal(index.release.build, packageJson.release.build);
  assert.equal(index.source.entryCount, zip.entries.length);
});

test("Foundry 13.351 compact index covers key OLF contract files", async () => {
  const index = await readJson(resolve(moduleDir, "fixtures/foundry_13_351/core.index.json"));
  const indexedPaths = new Set(index.keyFiles.map((entry) => entry.path));

  for (const keyFile of FOUNDRY_CORE_KEY_FILES) {
    assert.equal(indexedPaths.has(keyFile), true, `${keyFile} should be listed in the compact index`);
  }

  for (const keyFile of index.keyFiles) {
    assert.equal(keyFile.present, true, `${keyFile.path} should be present in the Foundry ZIP`);
    assert.equal(typeof keyFile.uncompressedSize, "number");
    assert.ok(keyFile.uncompressedSize > 0, `${keyFile.path} should not be empty`);
  }

  assert.ok(index.interestGroups.packages.paths.includes("resources/app/common/packages/base-package.mjs"));
  assert.ok(index.interestGroups.documents.paths.includes("resources/app/common/documents/journal-entry.mjs"));
  assert.ok(index.interestGroups.journalSheets.paths.includes("resources/app/templates/journal/pages/text/edit.hbs"));
  assert.ok(index.interestGroups.applicationApi.paths.includes("resources/app/client/applications/api/application.mjs"));
  assert.ok(index.interestGroups.compendiums.paths.includes("resources/app/client/documents/collections/compendium-collection.mjs"));
  assert.ok(index.interestGroups.types.paths.includes("resources/app/common/documents/_types.mjs"));
});

test("Foundry 13.351 compact index records OLF operational guardrails", async () => {
  const index = await readJson(resolve(moduleDir, "fixtures/foundry_13_351/core.index.json"));

  assert.ok(index.operationalRules.some((rule) => rule.includes("ApplicationV2")));
  assert.ok(index.operationalRules.some((rule) => rule.includes("JournalEntry.pages")));
  assert.ok(index.operationalRules.some((rule) => rule.includes("MACRO_SCRIPT")));
  assert.ok(index.operationalRules.some((rule) => rule.includes("Compendiums")));
});
