import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { readJson } from "./helpers.js";

const indexPath = resolve("fixtures/module_2/a_sun_for_each_destiny/journal-corpus.index.json");

test("Module 2 active corpus points to current A Sun for Each Destiny sources", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);

  assert.equal(index.caseId, "module_2_a_sun_for_each_destiny_journal_corpus");
  assert.equal(index.moduleTitle, "A Sun for Each Destiny");
  assert.equal(index.status, "active_foundry_journal_baseline");
  assert.equal(index.sourceFiles.length, 4);

  for (const source of index.sourceFiles) {
    assert.equal(existsSync(resolve(sourceRoot, source.path)), true, `${source.path} should exist`);
  }
});

test("Module 2 active corpus validates the exported Foundry Journal entries", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);

  assert.equal(index.journalExports.length, 8);

  for (const journalExport of index.journalExports) {
    const journalPath = resolve(sourceRoot, journalExport.path);
    assert.equal(existsSync(journalPath), true, `${journalExport.path} should exist`);

    const exported = await readJson(journalPath);
    assert.equal(exported.name, journalExport.expectedName);
    assert.equal(exported.pages.length, journalExport.expectedPageCount);
  }
});

test("Module 2 active corpus preserves the three-act Foundry Journal spine", async () => {
  const index = await readJson(indexPath);
  const journalNames = index.journalExports.map((journalExport) => journalExport.expectedName);

  assert.deepEqual(
    journalNames.filter((name) => name.includes("Ato")),
    [
      "03. Ato I — The Junkyard Hounds",
      "04. Ato II — A Caçada de Kryll",
      "05. Ato III — A Porta Queimada"
    ]
  );

  assert.equal(
    index.controlPanelImplications.includes("Journal page text must not be exposed by default through public API calls."),
    true
  );
});
