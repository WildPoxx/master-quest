import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { readJson } from "./helpers.js";

test("PC anchor baseline index points to real exported FVTT actor files", async () => {
  const index = await readJson(resolve("fixtures/party/pc-roster.index.json"));
  const workspaceRoot = resolve(process.cwd(), "..", "..", "..");

  assert.equal(index.files.length, 6);

  for (const entry of index.files) {
    const target = resolve(workspaceRoot, index.sourceFolder, entry.name);
    await access(target);
  }

  assert.match(index.usageRule, /current PC versions/i);
});
