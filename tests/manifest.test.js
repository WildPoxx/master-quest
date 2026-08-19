import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import test from "node:test";
import { readJson } from "./helpers.js";

const moduleDir = resolve(".");

test("module manifest matches the Foundry v13 beta contract", async () => {
  const manifest = await readJson(resolve(moduleDir, "module.json"));

  if (!process.env.GITHUB_ACTIONS) {
    assert.equal(manifest.id, basename(moduleDir));
  }
  assert.equal(manifest.id, "master-quest");
  assert.equal(manifest.title, "MasterQuest");
  assert.equal(manifest.version, "0.30.3-v13.2");
  assert.equal(manifest.compatibility.minimum, "13.351");
  assert.equal(manifest.compatibility.verified, "13.351");
  assert.equal(manifest.compatibility.maximum, "13");
  assert.match(manifest.manifest, /codex\/compat-v13\/module\.json$/);
  // O tag do download tem de ACOMPANHAR a versao, e nao ser conferido por conta propria:
  // um bump que esqueca a URL publica um manifest apontando para o pacote anterior, e o
  // Foundry instala a versao errada em silencio, sem erro nenhum na tela.
  assert.equal(
    manifest.download,
    `https://github.com/WildPoxx/master-quest/releases/download/v${manifest.version}/master-quest-v13.zip`
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
