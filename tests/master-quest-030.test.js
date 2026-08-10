/**
 * 0.30 — o painel mostra o que esta na pagina, e o caderno passa a ser da MESA.
 *
 * Teste de mesa da 0.29.0 (Mario, 2026-08-10), tres pedidos e dois defeitos achados no
 * export do mundo:
 *
 * 1. *"seria interessante que essas coisas aparecessem no texto do painel de visualizacao
 *    do Player Notes"* — o painel passa a exibir as linhas empurradas, lidas da pagina.
 * 2. *"lembrar de tirar aquele residuo de baixo"* — o campo antigo so aparece com texto,
 *    rotulado, e com gesto de limpar.
 * 3. *"tem que ser deles, nao apenas observavel por eles"* — pagina `default: OWNER`.
 *
 * DEFEITOS provados pelo export de 2026-08-10 e travados aqui:
 * - o carimbo invisivel de idempotencia NAO sobrevive ao Foundry (a pagina tinha cinco
 *   paragrafos escritos pelo modulo e zero carimbos, com duas linhas repetidas);
 * - `playerUserIds` filtrava por `active`, que significa CONECTADO — caderno criado com a
 *   mesa offline nascia sem dono jogador nenhum.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  LEGACY_PAGE_NAME,
  OWNERSHIP,
  appendToSessionPage,
  applyPageOwnership,
  ensureSessionPage,
  pagesNeedingOwnership,
  paragraphsOf,
  summarizePageContent
} from "../src/journal/player-notes.js";
import { appendUnderSection } from "../src/notes/session-sections.js";
import { normalizeQuest } from "../src/quest/quest-schema.js";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { playerUserIds, renderQuestDetails } from "../src/ui/quest-details.js";

/* --- 1. o sumario que o painel exibe -------------------------------------------------- */

test("o sumario devolve as primeiras linhas e conta as que ficaram de fora", () => {
  const html = "<p>uma</p><p>duas</p><p>tres</p><p>quatro</p><p>cinco</p>";
  const { lines, more } = summarizePageContent(html, { limit: 4 });

  assert.deepEqual(lines, ["uma", "duas", "tres", "quatro"]);
  assert.equal(more, 1);
});

test("o sumario preserva enfase e descarta o resto — o painel nao imita o documento", () => {
  const html = `<p><strong>Note</strong>: achado</p><p><a href="x">link</a> e <img src="y"> imagem</p>`;
  const { lines } = summarizePageContent(html, { limit: 4 });

  assert.equal(lines[0], "<strong>Note</strong>: achado");
  assert.equal(lines[1].includes("<a "), false, "link vira texto: o painel nao e o documento");
  assert.equal(lines[1].includes("<img"), false);
});

test("paragrafo vazio nao conta como linha", () => {
  assert.deepEqual(paragraphsOf("<p></p><p>  </p><p>real</p>"), ["real"]);
  assert.equal(summarizePageContent("<p></p><p></p>").lines.length, 0);
});

/* --- 2. a linha repetida morre nos dois lados ----------------------------------------- */

test("a pagina recusa a linha identica, sem depender de carimbo invisivel", async () => {
  // O carimbo `<!--mq:id-->` da 0.29 nao sobrevive ao Foundry: no export do mundo de
  // Mario a pagina tinha cinco paragrafos do modulo e nenhum carimbo. Este teste trava a
  // defesa que sobra — comparar o texto visivel.
  const updates = [];
  const page = {
    text: { content: "<p><strong>Note teste</strong>: Novo teste — teste</p>" },
    update: async (data) => updates.push(data)
  };

  const result = await appendToSessionPage({
    page,
    lines: [{ id: "outro-id-qualquer", html: "<strong>Note teste</strong>: Novo teste — teste" }]
  });

  assert.equal(result.status, "nothing-to-append");
  assert.equal(result.skipped, 1);
  assert.equal(updates.length, 0, "nada foi gravado");
});

test("a pagina aceita linha diferente, e duas linhas novas de uma vez", async () => {
  const updates = [];
  const page = { text: { content: "<p>ja estava</p>" }, update: async (data) => updates.push(data) };

  const result = await appendToSessionPage({
    page,
    lines: [{ id: "a", html: "primeira" }, { id: "b", html: "segunda" }]
  });

  assert.equal(result.appended, 2);
  assert.ok(updates[0].text.content.startsWith("<p>ja estava</p>"), "o que estava permanece");
  assert.ok(updates[0].text.content.includes("<p>primeira</p>"));
  assert.equal(updates[0].text.content.includes("<!--mq:"), false, "carimbo invisivel nao volta");
});

test("o campo de notas recusa a linha identica DENTRO da mesma secao", () => {
  const S = { number: 3, date: "2026-08-10", title: "A caminho da Torre" };
  let html = appendUnderSection("", { session: S, line: "<strong>Note</strong>: teste" });
  const again = appendUnderSection(html, { session: S, line: "<strong>Note</strong>: teste" });

  assert.equal(again, html, "clicar duas vezes nao escreve duas vezes");
  assert.equal(again.match(/Note<\/strong>/g).length, 1);
});

test("a mesma frase em SESSAO diferente entra — sao dois fatos, nao um repetido", () => {
  let html = appendUnderSection("", { session: { number: 1, title: "A" }, line: "a porta se abre" });
  html = appendUnderSection(html, { session: { number: 5, title: "B" }, line: "a porta se abre" });

  assert.equal(html.match(/a porta se abre/g).length, 2);
});

/* --- 3. o caderno e da mesa ----------------------------------------------------------- */

test("a pagina nasce com TODOS os jogadores como donos, e nao so os conectados", async () => {
  // Emenda a DEC-042 (Mario, 2026-08-10). O desenho anterior dependia de uma lista de
  // usuarios; com a mesa offline a lista saia vazia e a pagina nascia sem dono jogador.
  const created = [];
  const entry = {
    pages: [],
    createEmbeddedDocuments: async (_type, [data]) => {
      created.push(data);
      return [{ id: "p1", ...data }];
    }
  };

  await ensureSessionPage({ entry, session: { number: 1, date: "", title: "" }, owners: [] });

  assert.equal(created[0].ownership.default, OWNERSHIP.OWNER, "sem isso o jogador nao escreve");
});

test("a pagina de migracao usa o nome que a PREVIA promete, e nao 'Session 0'", async () => {
  const created = [];
  const entry = {
    pages: [],
    createEmbeddedDocuments: async (_type, [data]) => {
      created.push(data);
      return [{ id: "p0", ...data }];
    }
  };

  await ensureSessionPage({
    entry,
    session: { number: 0, date: "", title: "" },
    name: LEGACY_PAGE_NAME,
    content: "<p>prosa antiga</p>"
  });

  assert.equal(created[0].name, LEGACY_PAGE_NAME, "previa que promete um nome e cria outro deixa de ser previa");
});

test("o conserto de permissao toca so as paginas fora do desenho, e nao apaga nada", async () => {
  const updates = [];
  const mk = (id, def) => ({
    _id: id,
    ownership: { default: def, alguem: OWNERSHIP.OWNER },
    text: { content: "<p>conteudo</p>" },
    update: async (data) => updates.push({ id, data })
  });
  const entry = { pages: [mk("velha", OWNERSHIP.OBSERVER), mk("nova", OWNERSHIP.OWNER)] };

  assert.equal(pagesNeedingOwnership(entry), 1, "a previa precisa saber o numero antes de escrever");

  const result = await applyPageOwnership({ entry });

  assert.equal(result.fixed, 1);
  assert.deepEqual(updates.map((u) => u.id), ["velha"]);
  assert.equal(updates[0].data.ownership.default, OWNERSHIP.OWNER);
  assert.equal(updates[0].data.ownership.alguem, OWNERSHIP.OWNER, "dono nomeado nao se perde");
  assert.equal("text" in updates[0].data, false, "permissao muda; conteudo nao se toca");
});

test("jogador OFFLINE continua sendo jogador; o Mestre e a conta sem funcao ficam de fora", () => {
  const game = {
    users: [
      { id: "gm", isGM: true, role: 4, active: true },
      { id: "online", isGM: false, role: 1, active: true },
      { id: "offline", isGM: false, role: 1, active: false },
      { id: "sem-funcao", isGM: false, role: 0, active: true }
    ]
  };

  assert.deepEqual(playerUserIds(game), ["online", "offline"]);
});

/* --- 4. o painel ---------------------------------------------------------------------- */

const QUEST = {
  id: "q1",
  name: "A Sombra",
  playerNotesUuid: "JournalEntry.j1",
  sessions: [
    { number: 1, date: "2026-08-10", title: "Sonhos", pageUuid: "JournalEntry.j1.JournalEntryPage.p1" },
    { number: 2, date: "2026-08-17", title: "A 3ª Roda", pageUuid: "" }
  ]
};

/** O que `_prepareContext` entrega pronto: os desenhadores sao puros. */
function view(source, { isGM = true, canEdit = true, sessionNotes = {}, pending = 0 } = {}) {
  const model = buildQuestDetailsViewModel(normalizeQuest(source), { isGM, canEdit, activeTab: "playernotes" });
  model.notesFolder = { willMove: false };
  model.sessionNotes = sessionNotes;
  model.notesOwnershipPending = pending;
  return renderQuestDetails(model);
}

test("o painel mostra as linhas da pagina, e nao so o link", () => {
  const html = view(QUEST, {
    sessionNotes: { 1: { lines: ["<strong>Note</strong>: achamos a chave", "a porta cede"], more: 0 } }
  });

  assert.ok(html.includes("achamos a chave"), "e o pedido de Mario: ler o resumo sem abrir o documento");
  assert.ok(html.includes("a porta cede"));
  assert.ok(html.includes('data-uuid="JournalEntry.j1.JournalEntryPage.p1"'), "o link continua");
});

test("linha demais vira 'and N more', em vez de virar parede", () => {
  const html = view(QUEST, { sessionNotes: { 1: { lines: ["uma"], more: 12 } } });
  assert.ok(html.includes("and 12 more"));
});

test("sessao com pagina vazia diz que esta vazia; sessao sem pagina diz por que", () => {
  const html = view(QUEST, { sessionNotes: { 1: { lines: [], more: 0 } } });
  assert.ok(html.includes("Nothing written in this session yet"));
  assert.ok(html.includes("No page yet"), "a sessao 2 nao tem pagina");
});

test("o campo antigo so aparece com texto dentro, rotulado, e com o gesto de limpar", () => {
  const vazio = view(QUEST);
  assert.equal(vazio.includes("mq-notes-aside"), false, "caixa vazia sem funcao nao se desenha");

  const cheio = view({ ...QUEST, playernotes: "<p>rascunho antigo</p>" });
  assert.ok(cheio.includes("mq-notes-aside"));
  assert.ok(cheio.includes("rascunho antigo"), "nada do que estava escrito some da tela");
  assert.ok(cheio.includes("Old free prose"), "tem de dizer o que aquilo e");
  assert.ok(cheio.includes('data-action="player-notes-clear-legacy"'));
});

test("o jogador nao ve gesto de manutencao nenhum", () => {
  const html = view({ ...QUEST, playernotes: "<p>rascunho</p>" }, { isGM: false, canEdit: false, pending: 3 });

  assert.ok(html.includes("mq-notes-index"), "o indice e da mesa inteira");
  assert.equal(html.includes("player-notes-clear-legacy"), false);
  assert.equal(html.includes("player-notes-fix-ownership"), false);
  assert.equal(html.includes("player-notes-move"), false);
});

test("o botao de permissao so existe quando ha pagina a consertar, e diz quantas", () => {
  assert.equal(view(QUEST).includes("player-notes-fix-ownership"), false, "botao que nao faz nada ensina a ignorar botao");

  const comPendencia = view(QUEST, { pending: 4 });
  assert.ok(comPendencia.includes('data-action="player-notes-fix-ownership"'));
  assert.ok(comPendencia.includes("(4)"));
});

test("mover e criar sao gestos DIFERENTES na tela", () => {
  // A "Session 0" inesperada nasceu porque um botao fazia as duas coisas.
  const model = buildQuestDetailsViewModel(normalizeQuest(QUEST), { isGM: true, canEdit: true, activeTab: "playernotes" });
  model.notesFolder = { willMove: true, folderPath: "Módulo 01 / Player Notes' Entries" };
  model.sessionNotes = {};
  model.notesOwnershipPending = 0;
  const html = renderQuestDetails(model);

  assert.ok(html.includes('data-action="player-notes-move"'));
  assert.equal(html.includes('data-action="player-notes-create"'), false, "com caderno criado nao se oferece criar");
});
