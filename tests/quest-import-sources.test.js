import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../src/constants.js";
import { QUEST_FLAG } from "../src/quest/quest-store.js";
import { QUEST_STATUS } from "../src/quest/quest-schema.js";
import { draftToQuest } from "../src/quest/quest-from-draft.js";
import {
  listPromotableFolders,
  planJournalPromotion,
  promoteJournalFolder,
  questFromJournalEntry,
  PROMOTION_KIND
} from "../src/quest/quest-import-journal.js";
import { detectPayloadKind, planFileImport, applyFileImport, PAYLOAD_KIND } from "../src/quest/quest-import-file.js";
import { resolveFilePicker, hasFilePicker, pickFilePath } from "../src/foundry/file-picker.js";
import { renderQuestImage } from "../src/ui/quest-details.js";

function makeEntry({ id, name, folder = null, flags = {}, pages = [] }) {
  const entry = {
    id,
    name,
    folder,
    flags,
    pages,
    ownership: { default: 0 },
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

const DRAFT = {
  id: "mq-teste01",
  title: "Teste01",
  playerSafeSummary: "Resumo seguro.",
  objectives: [{ id: "o1", title: "Primeiro objetivo.", visibility: "player" }],
  rewards: [],
  scenes: [],
  threats: [],
  clues: [],
  gmSecrets: [],
  clocks: []
};

// Reproduz o mundo real: Teste01 e Teste 02 sem flag de quest, Teste 03 com.
function makeDraftsWorld() {
  const folder = { id: "fd", name: "MasterQuest Drafts", type: "JournalEntry" };
  const entries = [
    makeEntry({
      id: "d1",
      name: "MasterQuest - Teste01",
      folder,
      flags: { [MODULE_ID]: { masterQuestDraft: DRAFT, masterQuestStorage: {} } }
    }),
    makeEntry({
      id: "d2",
      name: "MasterQuest - Teste 02",
      folder,
      flags: { [MODULE_ID]: { masterQuestDraft: { ...DRAFT, id: "mq-teste02", title: "Teste 02" }, masterQuestStorage: {} } }
    }),
    makeEntry({
      id: "d3",
      name: "MasterQuest - Teste 03",
      folder,
      flags: { [MODULE_ID]: { masterQuestDraft: DRAFT, [QUEST_FLAG]: draftToQuest(DRAFT) } }
    })
  ];
  return { game: { journal: entries, folders: [folder], user: { isGM: true } }, entries, folder };
}

test("as pastas do mundo sao listadas com quantas entradas sao promoviveis", () => {
  const { game } = makeDraftsWorld();
  const folders = listPromotableFolders({ game });

  const drafts = folders.find((folder) => folder.name === "MasterQuest Drafts");
  assert.equal(drafts.total, 3);
  assert.equal(drafts.promotable, 2, "so Teste01 e Teste 02 podem ser promovidos");
  assert.equal(drafts.alreadyQuests, 1);
});

test("promover a pasta de rascunhos recupera as quests orfas sem tocar na que ja existe", async () => {
  const { game, entries } = makeDraftsWorld();
  const plan = planJournalPromotion({ folderId: "fd", game });

  assert.equal(plan.promote, 2);
  assert.equal(plan.skip, 1);
  assert.equal(plan.entries.find((e) => e.name.includes("Teste 03")).kind, PROMOTION_KIND.alreadyQuest);
  assert.equal(plan.entries.find((e) => e.name.includes("Teste01")).kind, PROMOTION_KIND.fromDraft);

  const questAntes = entries[2].flags[MODULE_ID][QUEST_FLAG];
  const result = await promoteJournalFolder({ folderId: "fd", game });

  assert.equal(result.promoted, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 0);
  assert.equal(entries[0].flags[MODULE_ID][QUEST_FLAG].name, "Teste01");
  assert.equal(entries[0].flags[MODULE_ID][QUEST_FLAG].status, QUEST_STATUS.available);
  assert.equal(entries[0].flags[MODULE_ID][QUEST_FLAG].objectives.length, 1);
  assert.equal(entries[1].flags[MODULE_ID][QUEST_FLAG].name, "Teste 02");
  assert.equal(entries[2].flags[MODULE_ID][QUEST_FLAG], questAntes, "a quest que ja existia nao e reescrita");
});

test("um Journal comum vira quest com a primeira pagina como descricao", () => {
  const entry = makeEntry({
    id: "j1",
    name: "Karavazyan - A Cidade sobre Rodas",
    pages: [
      { name: "Visão geral", text: { content: "<p>A cidade anda.</p>" } },
      { name: "Segredos", text: { content: "<p>O terceiro círculo.</p>" } }
    ]
  });

  const quest = questFromJournalEntry(entry);
  assert.equal(quest.name, "Karavazyan - A Cidade sobre Rodas");
  assert.equal(quest.status, QUEST_STATUS.available);
  assert.equal(quest.description, "<p>A cidade anda.</p>");
  assert.ok(quest.gmnotes.includes("Segredos"), "as demais páginas ficam registradas nas notas de GM");
  assert.equal(quest.source, "journal-promotion");
});

test("o detector reconhece blueprint, export de pasta e JournalEntry solto", () => {
  assert.equal(detectPayloadKind({ quests: [{ designId: "MQ-1", name: "x" }] }), PAYLOAD_KIND.blueprint);
  assert.equal(detectPayloadKind({ folders: [], items: [{ name: "a", pages: [] }] }), PAYLOAD_KIND.journalExport);
  assert.equal(detectPayloadKind([{ name: "a", pages: [] }]), PAYLOAD_KIND.journalExport);
  assert.equal(detectPayloadKind({ name: "Uma quest", pages: [] }), PAYLOAD_KIND.journalEntry);
  assert.equal(detectPayloadKind(42), PAYLOAD_KIND.unknown);
  assert.equal(detectPayloadKind({ coisa: true }), PAYLOAD_KIND.unknown);
});

test("importar um export de pasta do Foundry cria Journals ja com a flag de quest", async () => {
  const journal = [];
  const folders = [];
  const game = { journal, folders, user: { isGM: true } };
  const JournalEntry = {
    async create(payload) {
      const entry = makeEntry({ id: `j${journal.length + 1}`, name: payload.name, flags: payload.flags, pages: payload.pages });
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

  const payload = {
    folders: [{ name: "Aventura Importada" }],
    items: [
      { name: "Cena 1", pages: [{ name: "Texto", text: { content: "<p>Começa assim.</p>" } }] },
      { name: "Cena 2", pages: [{ name: "Texto", text: { content: "<p>E segue.</p>" } }] }
    ]
  };

  const plan = planFileImport({ payload, game });
  assert.equal(plan.kind, PAYLOAD_KIND.journalExport);
  assert.equal(plan.create, 2);
  assert.equal(plan.folderName, "Aventura Importada");

  const result = await applyFileImport({ payload, game, JournalEntry, Folder });
  assert.equal(result.created, 2);
  assert.equal(journal.length, 2);
  assert.equal(journal[0].flags[MODULE_ID][QUEST_FLAG].name, "Cena 1");
  assert.equal(journal[0].flags[MODULE_ID][QUEST_FLAG].description, "<p>Começa assim.</p>");
});

test("arquivo irreconhecivel e recusado sem escrever nada", async () => {
  const journal = [];
  const game = { journal, folders: [], user: { isGM: true } };
  const result = await applyFileImport({ payload: { qualquer: "coisa" }, game });

  assert.equal(result.status, "invalid");
  assert.equal(journal.length, 0);
  assert.equal(result.plan.issues[0].code, "unrecognised-payload");
});

test("dry-run de arquivo nao escreve", async () => {
  const journal = [];
  const game = { journal, folders: [], user: { isGM: true } };
  const payload = { items: [{ name: "Cena", pages: [] }] };
  const result = await applyFileImport({ payload, game, dryRun: true });

  assert.equal(result.status, "dry-run");
  assert.equal(journal.length, 0);
});

test("o seletor de arquivos e resolvido em qualquer namespace, e degrada quando nao existe", async () => {
  assert.equal(resolveFilePicker({}), null);
  assert.equal(hasFilePicker({}), false);

  const legacy = function LegacyPicker() {};
  assert.equal(resolveFilePicker({ FilePicker: legacy }), legacy);

  const v13 = function V13Picker() {};
  assert.equal(resolveFilePicker({ foundry: { applications: { apps: { FilePicker: v13 } } } }), v13);

  // Sem picker, a promessa resolve null em vez de lançar — o campo de texto continua valendo.
  assert.equal(await pickFilePath({ scope: {} }), null);
});

test("a imagem da quest aparece para quem edita, mesmo sem imagem definida", () => {
  const comImagem = renderQuestImage({ splash: "worlds/x/img.webp", splashPos: "center", canEdit: true });
  assert.ok(comImagem.includes("worlds/x/img.webp"));
  assert.ok(comImagem.includes("data-action=\"pick-image\""));
  assert.ok(comImagem.includes("Trocar imagem"));

  const vazioEditavel = renderQuestImage({ splash: "", splashPos: "center", canEdit: true });
  assert.ok(vazioEditavel.includes("Escolher imagem"));
  assert.ok(vazioEditavel.includes("Sem imagem"));

  // Jogador sem imagem definida não vê moldura vazia nenhuma.
  assert.equal(renderQuestImage({ splash: "", splashPos: "center", canEdit: false }), "");
});

test("a imagem da quest escapa caminho malicioso", () => {
  const html = renderQuestImage({ splash: "javascript:alert(1)", splashPos: "center", canEdit: true });
  assert.equal(html.includes("javascript:alert(1)"), false);
});

// --- 0.11.0: status de destino e controles de janela -----------------------

test("quests promovidas nascem em Disponiveis por padrao", async () => {
  const { game, entries } = makeDraftsWorld();
  await promoteJournalFolder({ folderId: "fd", game });

  assert.equal(entries[0].flags[MODULE_ID][QUEST_FLAG].status, QUEST_STATUS.available);
  assert.equal(entries[1].flags[MODULE_ID][QUEST_FLAG].status, QUEST_STATUS.available);
});

test("o status de destino e escolha do GM", async () => {
  const { game, entries } = makeDraftsWorld();
  await promoteJournalFolder({ folderId: "fd", game, status: QUEST_STATUS.inactive });

  assert.equal(entries[0].flags[MODULE_ID][QUEST_FLAG].status, QUEST_STATUS.inactive);

  const outro = makeDraftsWorld();
  await promoteJournalFolder({ folderId: "fd", game: outro.game, status: "lixo" });
  assert.equal(
    outro.entries[0].flags[MODULE_ID][QUEST_FLAG].status,
    QUEST_STATUS.available,
    "status invalido cai no padrao em vez de gravar lixo"
  );
});

test("importar export de Journal respeita o status escolhido", async () => {
  const journal = [];
  const game = { journal, folders: [], user: { isGM: true } };
  const JournalEntry = {
    async create(payload) {
      const entry = makeEntry({ id: `j${journal.length + 1}`, name: payload.name, flags: payload.flags });
      journal.push(entry);
      return entry;
    }
  };
  const Folder = { async create(data) { return { id: "f1", ...data }; } };
  const payload = { items: [{ name: "Cena", pages: [{ text: { content: "<p>x</p>" } }] }] };

  await applyFileImport({ payload, game, JournalEntry, Folder, status: QUEST_STATUS.inactive });
  assert.equal(journal[0].flags[MODULE_ID][QUEST_FLAG].status, QUEST_STATUS.inactive);
});

test("os controles Destacar/Anexar do core sao filtrados conforme a configuracao", async () => {
  const { filterHeaderControls, shouldHideDetachControls } = await import("../src/foundry/window-controls.js");
  const controls = [
    { action: "detach", label: "Detach" },
    { action: "attach", label: "Attach" },
    { action: "close", label: "Fechar" }
  ];

  // Sem settings registradas, o padrao e ocultar.
  assert.equal(shouldHideDetachControls({ game: {} }), true);
  assert.deepEqual(filterHeaderControls(controls, { game: {} }).map((c) => c.action), ["close"]);

  const ligado = { settings: { get: () => false } };
  assert.equal(shouldHideDetachControls({ game: ligado }), false);
  assert.equal(filterHeaderControls(controls, { game: ligado }).length, 3);

  // Setting ainda nao registrada lanca; nao pode derrubar a janela.
  const quebrado = { settings: { get: () => { throw new Error("not registered"); } } };
  assert.deepEqual(filterHeaderControls(controls, { game: quebrado }).map((c) => c.action), ["close"]);
  assert.deepEqual(filterHeaderControls(undefined, { game: {} }), []);
});
