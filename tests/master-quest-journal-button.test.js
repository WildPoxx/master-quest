import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("init registers MasterQuest button for the Journal directory", async () => {
  const init = await readFile(resolve("scripts/init.js"), "utf8");

  assert.match(init, /renderJournalDirectory/);
  assert.match(init, /injectMasterQuestJournalDirectoryButton/);
  assert.match(init, /openAuthoringConsole/);
});

test("journal button injector uses the Foundry directory footer contract", async () => {
  const source = await readFile(resolve("src/ui/journal-directory-button.js"), "utf8");

  assert.match(source, /data-masterquest-open-authoring/);
  assert.match(source, /\.directory-footer/);
  assert.match(source, /MasterQuest/);
});