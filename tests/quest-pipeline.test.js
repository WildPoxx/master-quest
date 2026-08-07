import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { MODULE_ID, FQL_MODULE_ID } from "../src/constants.js";
import { QUEST_STATUS, normalizeQuest } from "../src/quest/quest-schema.js";
import { QUEST_FLAG, readAllQuests } from "../src/quest/quest-store.js";
import { draftToQuest, mergeDraftIntoQuest } from "../src/quest/quest-from-draft.js";
import { buildQuestSnapshot, downloadQuestSnapshot } from "../src/quest/quest-snapshot.js";
import { saveMasterQuestDraftToJournal } from "../src/foundry/master-quest-journal-storage.js";

const DRAFT = {
  id: "mq-teste01",
  title: "Teste01",
  playerSafeSummary: "A cidade parou de enterrar seus mortos.",
  gmSummary: "O coveiro vende os corpos.",
  objectives: [
    { id: "obj-1", title: "Descobrir quem paga o coveiro.", visibility: "player" },
    { id: "obj-2", title: "Encontrar o comprador.", visibility: "gm" }
  ],
  rewards: [{ id: "rw-1", title: "Acesso ao necrotério.", visibility: "player" }],
  scenes: [{ id: "sc-1", title: "O velório sem caixão." }],
  threats: [{ id: "th-1", label: "A guilda dos embalsamadores." }],
  clues: [],
  gmSecrets: [{ id: "sec-1", label: "O comprador é o próprio prefeito." }],
  clocks: []
};

function makeEntry({ id, name = "Entry", flags = {} }) {
  const entry = {
    id,
    name,
    ownership: { default: 0 },
    flags,
    pages: [],
    getFlag(scope, key) {
      if (scope !== MODULE_ID && scope !== "core") {
        throw new Error(`Flag scope "${scope}" is not valid or not currently active`);
      }
      return entry.flags?.[scope]?.[key] ?? null;
    },
    async setFlag(scope, key, value) {
      entry.flags[scope] = { ...(entry.flags[scope] ?? {}), [key]: value };
      return entry;
    },
    async update(data) {
      if (data.name !== undefined) entry.name = data.name;
      return entry;
    },
    async deleteEmbeddedDocuments() {},
    async createEmbeddedDocuments() {}
  };
  return entry;
}

function makeGame(entries) {
  return {
    journal: entries,
    user: { isGM: true, name: "GM" },
    world: { id: "conan-legacy", title: "Conan Legacy" },
    system: { id: "swade", version: "6.0.4" },
    version: "14.365"
  };
}

test("an authoring draft becomes a quest the Quest Log can read", () => {
  const quest = draftToQuest(DRAFT);

  assert.equal(quest.name, "Teste01");
  // Authored, not yet handed to the table: the GM-only tab.
  assert.equal(quest.status, QUEST_STATUS.inactive);
  assert.equal(quest.source, "master-quest-authoring");
  assert.equal(quest.objectives.length, 2);
  assert.equal(quest.objectives[0].name, "Descobrir quem paga o coveiro.");
  assert.equal(quest.objectives[0].hidden, false);
  assert.equal(quest.objectives[1].hidden, true, "objetivo de GM não pode vazar para os jogadores");
  assert.equal(quest.rewards.length, 1);
  assert.ok(quest.description.includes("parou de enterrar"));
  assert.ok(quest.gmnotes.includes("O coveiro vende os corpos."));
  assert.ok(quest.gmnotes.includes("prefeito"), "segredos do Mestre entram nas notas de GM");
});

test("re-saving a draft never undoes what the table already did", () => {
  const current = draftToQuest(DRAFT);
  current.status = QUEST_STATUS.active;
  current.objectives[0].completed = true;
  current.giverName = "Vareno, o coveiro";
  current.playernotes = "<p>anotações da mesa</p>";

  const merged = mergeDraftIntoQuest(current, { ...DRAFT, playerSafeSummary: "Texto revisado." });

  assert.equal(merged.status, QUEST_STATUS.active, "a quest em andamento não pode voltar a rascunho");
  assert.equal(merged.objectives[0].completed, true, "objetivo concluído não pode ser desmarcado");
  assert.equal(merged.objectives[1].completed, false);
  assert.equal(merged.giverName, "Vareno, o coveiro");
  assert.equal(merged.playernotes, "<p>anotações da mesa</p>");
  assert.ok(merged.description.includes("Texto revisado."), "o texto autoral é atualizado");
});

test("saving a draft registers the quest in the log, not only in the Journal", async () => {
  const created = [];
  const JournalEntry = {
    async create(payload) {
      created.push(payload);
      return { id: "j1", ...payload };
    }
  };

  const result = await saveMasterQuestDraftToJournal(DRAFT, {
    game: makeGame([]),
    journal: [],
    JournalEntry,
    Folder: { async create(data) { return { id: "f1", ...data }; } },
    now: "2026-07-27T00:00:00.000Z"
  });

  assert.equal(result.status, "created");
  const flags = created[0].flags[MODULE_ID];
  assert.ok(flags[QUEST_FLAG], "o flag de quest precisa ser gravado junto com o draft");
  assert.equal(flags[QUEST_FLAG].name, "Teste01");
  assert.equal(flags[QUEST_FLAG].status, QUEST_STATUS.inactive);
  assert.ok(flags.masterQuestDraft, "o draft de autoria continua gravado");
});

test("a quest saved by the authoring console is visible to readAllQuests", async () => {
  const created = [];
  await saveMasterQuestDraftToJournal(DRAFT, {
    game: makeGame([]),
    journal: [],
    JournalEntry: { async create(payload) { created.push(payload); return { id: "j1", ...payload }; } },
    Folder: { async create(data) { return { id: "f1", ...data }; } },
    now: "2026-07-27T00:00:00.000Z"
  });

  const entry = makeEntry({ id: "j1", name: created[0].name, flags: created[0].flags });
  const quests = readAllQuests({ game: makeGame([entry]) });

  assert.equal(quests.length, 1, "o Quest Log precisa enxergar a quest recém-criada");
  assert.equal(quests[0].name, "Teste01");
});

test("the snapshot reports quest state without touching any document", () => {
  const quest = draftToQuest(DRAFT);
  quest.status = QUEST_STATUS.active;
  quest.objectives[0].completed = true;

  const entry = makeEntry({
    id: "j1",
    name: "MasterQuest - Teste01",
    flags: { [MODULE_ID]: { [QUEST_FLAG]: quest } }
  });
  const legacy = makeEntry({
    id: "j2",
    name: "Quest antiga",
    flags: { [FQL_MODULE_ID]: { json: { name: "Antiga", status: "active", tasks: [{ completed: true }] } } }
  });

  const before = JSON.stringify([entry.flags, legacy.flags]);
  const snapshot = buildQuestSnapshot({ game: makeGame([entry, legacy]), capturedAt: "2026-07-27T00:00:00.000Z" });

  assert.equal(snapshot.summary.questCount, 1);
  assert.equal(snapshot.summary.statusCounts.active, 1);
  assert.equal(snapshot.summary.objectiveCount, 2);
  assert.equal(snapshot.summary.completedObjectiveCount, 1);
  assert.equal(snapshot.summary.legacyFqlQuestCount, 1, "quests de FQL entram como legado");
  assert.equal(snapshot.quests[0].name, "Teste01");
  assert.equal(snapshot.source.worldId, "conan-legacy");
  assert.equal(snapshot.safety.changedFoundryDocuments, false);
  assert.equal(JSON.stringify([entry.flags, legacy.flags]), before, "o snapshot é somente leitura");
});

test("the snapshot reads FQL data even though its scope is inactive", () => {
  // getFlag on this stub throws for the FQL scope, exactly as Foundry v14 does.
  const legacy = makeEntry({
    id: "j2",
    name: "Quest antiga",
    flags: { [FQL_MODULE_ID]: { json: { name: "Antiga", status: "active" } } }
  });

  const snapshot = buildQuestSnapshot({ game: makeGame([legacy]), capturedAt: "2026-07-27T00:00:00.000Z" });
  assert.equal(snapshot.summary.legacyFqlQuestCount, 1);
  assert.equal(snapshot.legacyFqlQuests[0].alreadyImported, false);
});

test("downloading a snapshot falls back gracefully with no browser target", () => {
  const result = downloadQuestSnapshot({
    game: makeGame([]),
    capturedAt: "2026-07-27T00:00:00.000Z",
    document: null,
    saveDataToFile: null
  });

  assert.equal(result.status, "no-download-target");
  assert.ok(result.filename.startsWith("masterquest-snapshot-conan-legacy-"));
  assert.ok(result.filename.endsWith(".json"));
  assert.equal(result.snapshot.schemaVersion, 2);
});

test("no scene control button is declared as the group's activeTool", () => {
  // Foundry v14 SceneControls##onChangeTool returns early when the clicked tool is already
  // the group's active tool, before the `button` branch. Naming a button as activeTool
  // makes it permanently unclickable and fires it on layer activation instead.
  const source = readFileSync(fileURLToPath(new URL("../scripts/init.js", import.meta.url)), "utf8");
  const declaration = source.slice(source.indexOf("controls.masterquest"));

  assert.equal(/^\s*activeTool:/m.test(declaration), false, "activeTool não pode ser declarado");
  // 0.17.0: entrou "Importar aventura" entre Criar quest e o hub, para a barra espelhar as
  // quatro portas do hub. Se o numero mudar de novo, e decisao — atualize aqui junto.
  // 0.25: as tres ferramentas de autoria mudaram para um bloco proprio, montado ANTES de
  // `controls.masterquest` e so quando `isGM` — por isso a contagem le o arquivo inteiro.
  assert.equal((source.match(/^\s*button:\s*true/gm) ?? []).length, 4, "as quatro ferramentas são botões");
});

test("a barra de cena espelha as portas do hub, na ordem acordada", () => {
  // Pedido de Mario (2026-08-03): a barra tinha 3 opcoes e o hub 4; faltava Importar aventura.
  // Ordem: Quest Log, Criar quest, Importar aventura, MasterQuest (hub).
  // 0.25: le o arquivo inteiro — as ferramentas de autoria saem do literal do grupo e
  // passam a ser montadas em `authoringTools`, condicionadas a `isGM`.
  const source = readFileSync(fileURLToPath(new URL("../scripts/init.js", import.meta.url)), "utf8");

  const ordem = [...source.matchAll(/name:\s*"([a-z-]+)",\s*\n\s*order:\s*(\d+)/g)]
    .map(([, name, order]) => ({ name, order: Number(order) }))
    // O proprio grupo declara name/order no mesmo formato das ferramentas; so as ferramentas
    // interessam aqui.
    .filter((tool) => tool.name !== "masterquest")
    .sort((a, b) => a.order - b.order)
    .map((tool) => tool.name);

  assert.deepEqual(ordem, ["quest-log", "authoring-console", "import-adventure", "hub"]);
  assert.match(source, /openImport\(\)/, "Import Adventure chama a API de importacao");
});

// --- 0.12.0: objetivo nasce oculto, quadrado do log usa a imagem da quest ---

test("o quadrado do log usa a imagem da quest quando nao ha quest giver", async () => {
  const { buildQuestLogViewModel } = await import("../src/quest/quest-view-model.js");
  const entry = { id: "j1", ownership: { default: 2 }, testUserPermission: () => true };

  const comImagem = normalizeQuest({ name: "Com imagem", status: QUEST_STATUS.active, splash: "worlds/x/a.webp" });
  const comGiver = normalizeQuest({
    name: "Com giver",
    status: QUEST_STATUS.active,
    giverData: { img: "worlds/x/npc.webp" }
  });
  const vazia = normalizeQuest({ name: "Sem nada", status: QUEST_STATUS.active });

  const model = buildQuestLogViewModel(
    [{ ...comImagem, entry }, { ...comGiver, entry }, { ...vazia, entry }],
    { isGM: true, activeTab: QUEST_STATUS.active }
  );
  const rows = model.quests[QUEST_STATUS.active];

  assert.equal(rows.find((r) => r.name === "Com imagem").img, "worlds/x/a.webp");
  assert.equal(rows.find((r) => r.name === "Com giver").img, "worlds/x/npc.webp", "o giver segue valendo");
  assert.equal(rows.find((r) => r.name === "Sem nada").img, "");
});

test("um objetivo criado a mao nasce oculto dos jogadores", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/ui/quest-details.js", import.meta.url)), "utf8");
  const trecho = source.slice(source.indexOf("data-action='add-objective'"), source.indexOf("data-action='cycle-objective'"));

  assert.ok(/name: "New objective", hidden: true/.test(trecho), "o objetivo novo precisa nascer oculto");
});
