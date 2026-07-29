import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { readJson } from "./helpers.js";

const indexPath = resolve("fixtures/module_2/planning_seed/module2.seed.index.json");

test("Module 2 planning seed points to canonical source files", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);

  assert.equal(index.caseId, "module_2_planning_seed");
  assert.equal(index.sourceFiles.length, 3);

  for (const source of index.sourceFiles) {
    assert.equal(existsSync(resolve(sourceRoot, source.path)), true, `${source.path} should exist`);
  }
});

test("Module 2 seed requires one Journal entry for each satellite fragment", async () => {
  const index = await readJson(indexPath);

  assert.equal(index.fragments.length, 3);
  assert.equal(index.fragments.every((fragment) => fragment.journalEntryRequired), true);
  assert.deepEqual(
    index.fragments.map((fragment) => fragment.id),
    ["mainframe", "energy_core", "antenna_telemetry_hull"]
  );

  for (const fragment of ["Mainframe", "Energy Core", "Antenna / Telemetry Hull"]) {
    assert.equal(index.journalEntries.some((entry) => entry.includes(fragment)), true);
  }
});

test("Outpost 87 discovery rule does not hard-lock progress behind all three fragments", async () => {
  const index = await readJson(indexPath);

  assert.match(index.outpost87DiscoveryRule.twoFragments, /rough direction/);
  assert.match(index.outpost87DiscoveryRule.escapeValve, /Dramatic Task raises/);
  assert.equal(index.outpost87DiscoveryRule.threeFragments, "precise coordinates and technical proof");
});

test("Generated Module 2 docs preserve core planning decisions", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);

  for (const doc of index.generatedDocs) {
    assert.equal(existsSync(resolve(sourceRoot, doc.path)), true, `${doc.path} should exist`);
  }

  const planningDoc = await readFile(resolve(sourceRoot, index.generatedDocs[0].path), "utf8");
  const journalDoc = await readFile(resolve(sourceRoot, index.generatedDocs[1].path), "utf8");

  assert.match(planningDoc, /Antenna \/ Telemetry Hull of the Starwalker-IX/);
  assert.match(planningDoc, /Shizuka moves toward the Hell Raiders/);
  assert.match(planningDoc, /two fragments are enough to discover the existence and approximate direction of Outpost 87/);

  assert.match(journalDoc, /03\. Ponto 1 - Mainframe/);
  assert.match(journalDoc, /04\. Ponto 2 - Energy Core/);
  assert.match(journalDoc, /05\. Ponto 3 - Antenna \/ Telemetry Hull/);
});

test("Module 2 adventure plan sources exist and preserve the three-act structure", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);

  assert.equal(index.adventurePlanSources.length, 5);
  assert.equal(index.adventurePlanSources.filter((source) => source.kind === "act_source").length, 3);

  for (const source of index.adventurePlanSources) {
    assert.equal(existsSync(resolve(sourceRoot, source.path)), true, `${source.path} should exist`);
  }

  const modulePlan = await readFile(
    resolve(sourceRoot, index.adventurePlanSources.find((source) => source.id === "module2_plan").path),
    "utf8"
  );

  assert.match(modulePlan, /Sinal Memória \| Mainframe \/ Computador de Bordo/);
  assert.match(modulePlan, /Sinal Branco \| Energy Core de Aethera/);
  assert.match(modulePlan, /Sinal Eco \| Antena-Telemetria \/ carcaça Starwalker-IX/);
});

test("Module 2 Act I defines Steel Vultures as accessory antagonism and Blood Cross as rare pressure", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);
  const appendixPath = resolve(
    sourceRoot,
    index.adventurePlanSources.find((source) => source.id === "act_1_mainframe_encounters").path
  );

  const appendix = await readFile(appendixPath, "utf8");
  const act1 = await readFile(
    resolve(sourceRoot, index.adventurePlanSources.find((source) => source.id === "act_1_mainframe").path),
    "utf8"
  );

  assert.equal(index.clocks.includes("steel_vultures_on_the_trail"), true);
  assert.match(act1, /Os Abutres são o adversário humano principal do Ato I/);
  assert.match(appendix, /O sequestro de Floyd não deve ser obrigatório/);
  assert.match(appendix, /A Cruz de Sangue não deve ser antagonista planejada do Ato I/);
});

test("Module 2 Act I treats the active dimensional rift as the main Mainframe danger", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);
  const act1 = await readFile(
    resolve(sourceRoot, index.adventurePlanSources.find((source) => source.id === "act_1_mainframe").path),
    "utf8"
  );
  const appendix = await readFile(
    resolve(sourceRoot, index.adventurePlanSources.find((source) => source.id === "act_1_mainframe_encounters").path),
    "utf8"
  );
  const modulePlan = await readFile(
    resolve(sourceRoot, index.adventurePlanSources.find((source) => source.id === "module2_plan").path),
    "utf8"
  );

  assert.equal(index.clocks.includes("active_dimensional_rift_instability"), true);
  assert.match(modulePlan, /O Mainframe está contaminado pela fenda/);
  assert.match(act1, /A fenda dimensional fica perto o bastante para interferir nas leituras/);
  assert.match(act1, /KEY SCENE 4B — A FENDA RESPIRA/);
  assert.match(appendix, /a fenda dimensional ativa próxima ao Mainframe como ameaça principal/);
});

test("Module 2 Act I supports exploration-forward travel without mandatory combat", async () => {
  const index = await readJson(indexPath);
  const sourceRoot = resolve(dirname(indexPath), index.sourceRoot);
  const act1 = await readFile(
    resolve(sourceRoot, index.adventurePlanSources.find((source) => source.id === "act_1_mainframe").path),
    "utf8"
  );
  const appendix = await readFile(
    resolve(sourceRoot, index.adventurePlanSources.find((source) => source.id === "act_1_mainframe_encounters").path),
    "utf8"
  );
  const modulePlan = await readFile(
    resolve(sourceRoot, index.adventurePlanSources.find((source) => source.id === "module2_plan").path),
    "utf8"
  );

  assert.equal(index.clocks.includes("mainframe_approach_exploration"), true);
  assert.match(modulePlan, /A chegada ao Mainframe é jogo de exploração/);
  assert.match(act1, /EX-MAINFRAME — Aproximação ao Sinal Memória/);
  assert.match(appendix, /Procedimento de Exploração até o Mainframe/);
  assert.match(appendix, /Combate é consequência possível, não estrutura padrão/);
});
