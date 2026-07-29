import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { readJson } from "./helpers.js";

const procedureIndexPath = resolve("fixtures/module_1/planning_to_foundry/procedure.index.json");
const scriptsIndexPath = resolve("fixtures/legacy_scripts/scripts.index.json");

test("Module 1 planning-to-Foundry corpus points to real source files", async () => {
  const index = await readJson(procedureIndexPath);
  const sourceRoot = resolve(dirname(procedureIndexPath), index.sourceRoot);

  assert.equal(index.caseId, "module_1_planning_to_foundry");
  assert.equal(existsSync(resolve(sourceRoot, index.zipPath)), true);
  assert.equal(index.planningSources.filter((source) => source.kind === "act_source").length, 3);

  for (const source of index.planningSources) {
    const sourcePath = resolve(sourceRoot, source.path);
    assert.equal(existsSync(sourcePath), true, `${source.path} should exist`);
  }
});

test("Module 1 Foundry Journal exports are parseable and preserve page counts", async () => {
  const index = await readJson(procedureIndexPath);
  const sourceRoot = resolve(dirname(procedureIndexPath), index.sourceRoot);

  for (const journal of index.foundryJournalExports) {
    const journalPath = resolve(sourceRoot, journal.path);
    const data = JSON.parse(await readFile(journalPath, "utf8"));

    assert.equal(data.name, journal.title);
    assert.equal(Array.isArray(data.pages), true);
    assert.equal(data.pages.length, journal.expectedPages, `${journal.title} page count changed`);
  }
});

test("legacy scripts inventory points to the real macro archive", async () => {
  const index = await readJson(scriptsIndexPath);
  const zipPath = resolve(dirname(scriptsIndexPath), index.sourceZip);

  assert.equal(index.caseId, "legacy_fql_olf_scripts");
  assert.equal(existsSync(zipPath), true);
  assert.equal(index.macros.length, 4);
  assert.deepEqual(
    index.macros.map((macro) => macro.id),
    ["closeout_assistant", "continuity_report", "quest_update_assistant", "reset_quest_state"]
  );
});
