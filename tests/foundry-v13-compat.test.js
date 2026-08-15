import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { readJson } from "./helpers.js";

const moduleDir = resolve(".");

test("Foundry 13.351 baseline records the runtime and Journal contracts used by MasterQuest", async () => {
  const index = await readJson(resolve(moduleDir, "fixtures/foundry_13_351/core.index.json"));

  assert.equal(index.release.version, "13.351.0");
  assert.equal(index.release.generation, 13);
  assert.equal(index.release.build, 351);
  assert.equal(index.release.nodeVersion, 20);
  assert.equal(index.release.engines.node, ">=20.18.0 <23.0.0");

  const keyPaths = new Set(index.keyFiles.map((entry) => entry.path));
  for (const path of [
    "resources/app/client/applications/api/application.mjs",
    "resources/app/common/documents/journal-entry.mjs",
    "resources/app/common/documents/journal-entry-page.mjs"
  ]) {
    assert.ok(keyPaths.has(path), `Foundry 13.351 index must include ${path}`);
  }

  assert.ok(index.operationalRules.some((rule) => rule.includes("ApplicationV2")));
  assert.ok(index.operationalRules.some((rule) => rule.includes("JournalEntry.pages")));
});

test("V13 compatibility line keeps the V2 UI and defensive FilePicker lookup", async () => {
  for (const file of ["src/ui/authoring-console.js", "src/ui/adventure-review.js"]) {
    const source = await readFile(resolve(file), "utf8");
    assert.match(source, /foundry\?\.applications\?\.api\?\.ApplicationV2/);
    assert.match(source, /_renderHTML/);
    assert.match(source, /_replaceHTML/);
  }

  const picker = await readFile(resolve("src/foundry/file-picker.js"), "utf8");
  assert.match(picker, /foundry\?\.applications\?\.apps\?\.FilePicker/);
  assert.match(picker, /scope\?\.FilePicker/);
});

test("V13 contract preserves native Journal page ownership and HTML pages", async () => {
  const { buildMasterQuestDraftJournalPages } = await import("../src/foundry/master-quest-journal-storage.js");
  const pages = buildMasterQuestDraftJournalPages({
    id: "mq-v13-compat",
    title: "V13 Compatibility Draft",
    premise: "Journal-first storage remains generation-neutral.",
    dramaticQuestion: "Can the same Journal model run on V13?"
  });

  assert.ok(pages.length > 0);
  for (const page of pages) {
    assert.equal(page.type, "text");
    assert.equal(page.text.format, 1);
  }
});
