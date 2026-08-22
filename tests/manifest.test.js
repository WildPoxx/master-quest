import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import test from "node:test";
import { readJson } from "./helpers.js";

const moduleDir = resolve(".");

test("module manifest matches Foundry v14 scaffold contract", async () => {
  const manifest = await readJson(resolve(moduleDir, "module.json"));

  if (!process.env.GITHUB_ACTIONS) {
    assert.equal(manifest.id, basename(moduleDir));
  }
  assert.equal(manifest.id, "master-quest");
  assert.equal(manifest.title, "MasterQuest");
  assert.match(String(manifest.compatibility.minimum), /^14/);
  // 1.1.1: subido de 14.365 para 14.367 depois de conferir as notas das duas releases —
  // nenhuma toca ApplicationV2, DragDrop, abas, CSS, ProseMirror, Journal, ownership nem
  // settings, que e onde o modulo vive. O valor fica TRAVADO de proposito: subir `verified`
  // e ato deliberado, feito com as notas na frente, nunca um numero que acompanha o humor.
  assert.equal(manifest.compatibility.verified, "14.367");
  assert.equal(
    Object.hasOwn(manifest.compatibility, "maximum"),
    false,
    "the v14 line should not hard-block on a maximum generation"
  );
  assert.equal(Object.hasOwn(manifest, "system"), false);
  assert.equal(manifest.relationships?.requires, undefined);
  assert.equal(manifest.relationships?.systems, undefined);

  for (const modulePath of manifest.esmodules) {
    assert.equal(existsSync(resolve(moduleDir, modulePath)), true, `${modulePath} should exist`);
  }

  for (const stylePath of manifest.styles ?? []) {
    assert.equal(existsSync(resolve(moduleDir, stylePath)), true, `${stylePath} should exist`);
  }
});

