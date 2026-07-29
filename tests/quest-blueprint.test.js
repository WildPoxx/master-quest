import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MODULE_ID } from "../src/constants.js";
import { QUEST_FLAG } from "../src/quest/quest-store.js";
import { QUEST_STATUS } from "../src/quest/quest-schema.js";
import {
  planBlueprintImport,
  applyBlueprintImport,
  mergeBlueprintIntoQuest,
  validateBlueprint
} from "../src/quest/quest-blueprint.js";

const BLUEPRINT = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../data/blueprints/ecos-da-torre.quest-blueprint.json", import.meta.url)),
    "utf8"
  )
);

function makeEntry({ id, name, flags = {} }) {
  const entry = {
    id,
    name,
    ownership: { default: 0 },
    flags,
    async update(data) {
      if (data.name !== undefined) entry.name = data.name;
      for (const [scope, payload] of Object.entries(data.flags ?? {})) {
        entry.flags[scope] = { ...(entry.flags[scope] ?? {}), ...payload };
      }
      return entry;
    }
  };
  return entry;
}

function makeWorld(entries = []) {
  const journal = [...entries];
  const folders = [];
  let counter = 0;

  const game = {
    journal,
    folders,
    user: { isGM: true },
    world: { id: "conan-legacy" },
    system: { id: "swade", version: "6.0.4" }
  };

  const JournalEntry = {
    async create(payload) {
      counter += 1;
      const entry = makeEntry({ id: `j${counter}`, name: payload.name, flags: payload.flags ?? {} });
      entry.folder = payload.folder ?? null;
      journal.push(entry);
      return entry;
    }
  };

  const Folder = {
    async create(data) {
      const folder = { id: `f${folders.length + 1}`, ...data };
      folders.push(folder);
      return folder;
    }
  };

  return { game, JournalEntry, Folder };
}

test("o blueprint de Ecos da Torre e estruturalmente valido", () => {
  const issues = validateBlueprint(BLUEPRINT);
  const errors = issues.filter((issue) => issue.severity === "error");

  assert.deepEqual(errors, [], "nenhum erro estrutural e admitido no blueprint entregue");
});

test("o blueprint transpoe a arvore do documento-fonte", () => {
  const byType = BLUEPRINT.quests.reduce((counts, quest) => {
    counts[quest.type] = (counts[quest.type] ?? 0) + 1;
    return counts;
  }, {});

  assert.deepEqual(byType, { main: 1, subquest: 5, clock: 3, side: 16 });

  const main = BLUEPRINT.quests.find((quest) => quest.designId === "MQ-ATO1-01");
  assert.equal(main.status, QUEST_STATUS.active);
  assert.equal(main.parent, null);

  const chegada = BLUEPRINT.quests.find((quest) => quest.designId === "SQ-ATO1-01");
  assert.equal(chegada.status, QUEST_STATUS.active, "Chegada a Karavazyan nasce ativa");
  assert.equal(chegada.parent, "MQ-ATO1-01");

  // Toda subquest alem da primeira, todo clock e toda side quest nascem inativos.
  const outros = BLUEPRINT.quests.filter((q) => !["MQ-ATO1-01", "SQ-ATO1-01"].includes(q.designId));
  assert.ok(outros.every((quest) => quest.status === QUEST_STATUS.inactive));

  // Clocks nao tem texto para jogador.
  const clocks = BLUEPRINT.quests.filter((quest) => quest.type === "clock");
  assert.ok(clocks.every((clock) => clock.description === ""));
  assert.ok(clocks.every((clock) => clock.objectives.every((step) => step.hidden === true)));

  const kuth = BLUEPRINT.quests.find((quest) => quest.designId === "CLOCK-ATO1-02");
  assert.equal(kuth.objectives.length, 7, "a escala do relogio vai de 0 a 6");
  assert.ok(kuth.objectives[6].name.includes("A Torre reage antes da chegada."));
});

test("tarefas ocultas do documento continuam ocultas", () => {
  const mercado = BLUEPRINT.quests.find((quest) => quest.designId === "SQ-ATO1-02");
  const oculta = mercado.objectives.find((o) => o.name.startsWith("Registrar se Narzim informa"));

  assert.equal(oculta.hidden, true);
  assert.ok(mercado.objectives.some((o) => o.name === "Encontrar Narzim ibn Haroud." && o.hidden === false));
  assert.ok(mercado.gmnotes.includes("Gatilhos de conclusão"));
  assert.equal(mercado.description.includes("Narzim pode saber"), true);
});

test("o plano de importacao antecipa criacoes e links de Journal ausentes", () => {
  const { game } = makeWorld([makeEntry({ id: "jk", name: "Karavazyan - A Cidade sobre Rodas" })]);
  const plan = planBlueprintImport({ blueprint: BLUEPRINT, game });

  assert.equal(plan.status, "ok");
  assert.equal(plan.total, 25);
  assert.equal(plan.create, 25);
  assert.equal(plan.update, 0);
  assert.equal(plan.folderName, "MasterQuest - Ato I");

  const faltando = plan.missingJournalLinks.map((link) => link.name);
  assert.ok(!faltando.includes("Karavazyan - A Cidade sobre Rodas"), "o Journal existente nao entra na lista");
  assert.ok(faltando.includes("Narzim ibn Haroud"), "o Journal ausente e reportado");
});

test("a importacao cria a arvore e conecta pais e subquests", async () => {
  const { game, JournalEntry, Folder } = makeWorld();
  const result = await applyBlueprintImport({ blueprint: BLUEPRINT, game, JournalEntry, Folder });

  assert.equal(result.status, "done");
  assert.equal(result.created, 25);
  assert.equal(result.failed, 0);

  const quests = game.journal.map((entry) => entry.flags[MODULE_ID][QUEST_FLAG]);
  const main = quests.find((quest) => quest.designId === "MQ-ATO1-01");
  const chegada = quests.find((quest) => quest.designId === "SQ-ATO1-01");
  const mainId = game.journal.find((e) => e.flags[MODULE_ID][QUEST_FLAG].designId === "MQ-ATO1-01").id;

  assert.equal(chegada.parent, mainId, "a subquest aponta para o id real do JournalEntry pai");
  assert.equal(main.subquests.length, 24, "a main recebe todos os filhos declarados");
  assert.ok(main.subquests.every((id) => typeof id === "string"));
});

test("reimportar nao duplica quests nem desfaz o progresso da mesa", async () => {
  const world = makeWorld();
  await applyBlueprintImport({ blueprint: BLUEPRINT, ...world });

  // A mesa joga: ativa o Mercado e conclui um objetivo.
  const mercadoEntry = world.game.journal.find(
    (entry) => entry.flags[MODULE_ID][QUEST_FLAG].designId === "SQ-ATO1-02"
  );
  const mercado = mercadoEntry.flags[MODULE_ID][QUEST_FLAG];
  mercado.status = QUEST_STATUS.active;
  mercado.objectives[0].completed = true;
  mercado.playernotes = "<p>Narzim cobrou caro.</p>";

  // O blueprint e revisado e reimportado.
  const revisado = JSON.parse(JSON.stringify(BLUEPRINT));
  const spec = revisado.quests.find((quest) => quest.designId === "SQ-ATO1-02");
  spec.description = "<p>Texto revisado do Mercado.</p>";

  const second = await applyBlueprintImport({ blueprint: revisado, ...world });

  assert.equal(second.created, 0, "nada e recriado");
  assert.equal(second.updated, 25);
  assert.equal(world.game.journal.length, 25, "o mundo continua com 25 entradas");

  const depois = mercadoEntry.flags[MODULE_ID][QUEST_FLAG];
  assert.equal(depois.status, QUEST_STATUS.active, "o status da mesa e preservado");
  assert.equal(depois.objectives[0].completed, true, "o objetivo concluido continua concluido");
  assert.equal(depois.playernotes, "<p>Narzim cobrou caro.</p>");
  assert.equal(depois.description, "<p>Texto revisado do Mercado.</p>", "o texto autoral e atualizado");
});

test("dry-run nao escreve nada", async () => {
  const world = makeWorld();
  const result = await applyBlueprintImport({ blueprint: BLUEPRINT, ...world, dryRun: true });

  assert.equal(result.status, "dry-run");
  assert.equal(world.game.journal.length, 0);
  assert.equal(result.plan.create, 25);
});

test("blueprint invalido e recusado antes de qualquer escrita", async () => {
  const world = makeWorld();
  const quebrado = {
    blueprintId: "x",
    quests: [
      { designId: "A", name: "Uma", status: "active" },
      { designId: "A", name: "Outra", status: "active" },
      { designId: "B", name: "Terceira", parent: "NAO-EXISTE" },
      { designId: "C", name: "", status: "invalido" }
    ]
  };

  const issues = validateBlueprint(quebrado);
  const codes = issues.map((issue) => issue.code);
  assert.ok(codes.includes("duplicate-design-id"));
  assert.ok(codes.includes("missing-parent"));
  assert.ok(codes.includes("missing-name"));
  assert.ok(codes.includes("invalid-status"));

  const result = await applyBlueprintImport({ blueprint: quebrado, ...world });
  assert.equal(result.status, "invalid");
  assert.equal(world.game.journal.length, 0, "nenhuma entrada e criada a partir de blueprint invalido");
});

test("a fusao casa objetivos por id estavel, nao por posicao", () => {
  const spec = {
    designId: "SQ-X",
    name: "Teste",
    objectives: [{ name: "Primeiro objetivo." }, { name: "Segundo objetivo." }]
  };
  const first = mergeBlueprintIntoQuest(null, spec);
  first.objectives[1].completed = true;

  // O blueprint muda a ordem e insere um objetivo no topo.
  const reordenado = {
    ...spec,
    objectives: [{ name: "Novo objetivo." }, { name: "Segundo objetivo." }, { name: "Primeiro objetivo." }]
  };
  const merged = mergeBlueprintIntoQuest(first, reordenado);

  const segundo = merged.objectives.find((o) => o.name === "Segundo objetivo.");
  const novo = merged.objectives.find((o) => o.name === "Novo objetivo.");
  assert.equal(segundo.completed, true, "o objetivo concluido segue concluido apesar da reordenacao");
  assert.equal(novo.completed, false);
});
