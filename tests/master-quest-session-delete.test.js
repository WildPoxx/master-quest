/**
 * Apagar uma sessao — a lixeira obedece ao selo (Mario, 2026-08-07).
 *
 * Ate a 0.25.0 havia "New session" e nenhum jeito de remover a sessao aberta por engano.
 * A regra, nas palavras de Mario: "um icone de lixo que funciona para deletar, mas ela
 * apenas fica ativa quando esta destravado".
 *
 * Os testes travam a REGRA, nao o desenho: o selo governa a existencia do gesto, e apagar
 * a sessao nunca leva junto o Log (DEC-032, cronica de campanha) nem o documento de
 * Journal do jogador (DEC-038, nenhum caminho do modulo apaga conteudo).
 */

import test from "node:test";
import assert from "node:assert/strict";

import { MODULE_ID } from "../src/constants.js";
import { normalizeQuest } from "../src/quest/quest-schema.js";
import { toggleWrapUp } from "../src/quest/quest-wrapup.js";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { createMasterQuestDetailsClass, renderQuestDetails } from "../src/ui/quest-details.js";

/* --- cenario minimo ------------------------------------------------------------------ */

const SESSIONS = [
  { number: 1, date: "2026-08-01", title: "A torre" },
  { number: 2, date: "2026-08-05", title: "O poco", pageUuid: "JournalEntry.abc.JournalEntryPage.def" },
  { number: 3, date: "2026-08-07", title: "", sealed: true }
];

function questWith(overrides = {}) {
  return normalizeQuest({
    id: "q1",
    name: "Ecos da Torre",
    sessions: SESSIONS,
    log: [
      { id: "l1", target: "Pista do selo", targetType: "clue", change: "found", session: 1 },
      { id: "l2", target: "Bolsa", targetType: "reward", change: "granted", session: 2 },
      { id: "l3", target: "Porta", targetType: "objective", change: "completed", session: 2 }
    ],
    ...overrides
  });
}

function gmMarkup(quest = questWith()) {
  return renderQuestDetails(buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true }));
}

/** Recorta a linha da sessao pedida, para nao confundir a lixeira de uma com a de outra. */
function sessionRow(html, number) {
  const rows = html.split("<li ").filter((chunk) => chunk.includes("mq-session-row"));
  return rows.find((chunk) => chunk.includes(`data-session-number="${number}"`)) ?? "";
}

/* --- a regra: o selo governa a lixeira ----------------------------------------------- */

test("sessao desselada mostra a lixeira", () => {
  const row = sessionRow(gmMarkup(), 1);
  assert.ok(row.includes(`data-action="session-delete"`), "a sessao 1 esta desselada e deve poder ser apagada");
  assert.ok(row.includes(`data-session-number="1"`));
});

test("sessao SELADA nao mostra a lixeira — desselar e a confirmacao", () => {
  const row = sessionRow(gmMarkup(), 3);
  assert.ok(row.includes("is-sealed"), "cenario errado: a sessao 3 deveria estar selada");
  assert.equal(
    row.includes(`data-action="session-delete"`),
    false,
    "sessao selada nao pode expor o gesto de apagar"
  );
});

test("a sessao unica aberta por engano tambem pode ser apagada", () => {
  // A lista so se desenha a partir de duas sessoes; sem a lixeira na tira da corrente, o
  // caso que originou o pedido de Mario (abri uma sessao sem querer) ficaria sem saida.
  const html = gmMarkup(questWith({ sessions: [{ number: 1, date: "2026-08-07", title: "" }], log: [] }));
  assert.ok(html.includes(`data-action="session-delete"`));
});

test("o jogador nunca ve a lixeira de sessao", () => {
  const quest = questWith();
  const player = renderQuestDetails(buildQuestDetailsViewModel(quest, { isGM: false, canEdit: false }));
  assert.equal(player.includes(`data-action="session-delete"`), false);
});

/* --- o encontro das duas decisoes do mesmo dia (Mario, 2026-08-07) ------------------- */

test("depois do Wrap Up nao ha lixeira nenhuma — e reabrir o caderno nao a devolve", () => {
  // Duas decisoes tomadas no mesmo dia por caminhos separados se encontram aqui:
  // DEC-043 (o Wrap Up sela todas as sessoes) e a lixeira (so aparece em sessao
  // desselada). Mario foi informado da consequencia e a confirmou: quest encerrada tem
  // sessao indeletavel. Reabrir o caderno continua sempre possivel — exigencia expressa
  // dele —, mas reabrir NAO desselar (DEC-043), entao a lixeira segue ausente.
  const aberta = questWith({ sessions: SESSIONS.map((s) => ({ ...s, sealed: false })) });
  assert.ok(gmMarkup(aberta).includes(`data-action="session-delete"`), "antes do Wrap Up ha lixeira");

  const fechada = normalizeQuest(toggleWrapUp(aberta));
  assert.equal(fechada.wrappedUp, true);
  assert.equal(
    gmMarkup(fechada).includes(`data-action="session-delete"`),
    false,
    "caderno fechado: nenhuma sessao pode ser apagada"
  );

  const reaberta = normalizeQuest(toggleWrapUp(fechada));
  assert.equal(reaberta.wrappedUp, false, "reabrir o caderno tem de continuar sempre possivel");
  assert.equal(
    gmMarkup(reaberta).includes(`data-action="session-delete"`),
    false,
    "reabrir nao desselar (DEC-043), entao a lixeira segue ausente ate o Mestre destravar"
  );

  // E o caminho de volta existe, sessao a sessao — que e o que a DEC-039 exige.
  const destravada = normalizeQuest({
    ...reaberta,
    sessions: reaberta.sessions.map((s) => (s.number === 2 ? { ...s, sealed: false } : s))
  });
  const row = sessionRow(gmMarkup(destravada), 2);
  assert.ok(row.includes(`data-action="session-delete"`), "destravar uma sessao devolve a lixeira dela");
});

/* --- o efeito: some a sessao, fica todo o resto -------------------------------------- */

function makeHarness(quest) {
  const stored = { quest: normalizeQuest(quest) };
  const entry = {
    id: "q1",
    name: stored.quest.name,
    flags: { [MODULE_ID]: { quest: stored.quest } },
    getFlag: (moduleId, key) => entry.flags?.[moduleId]?.[key] ?? null,
    canUserModify: () => true,
    testUserPermission: () => true,
    async update(data) {
      for (const [moduleId, payload] of Object.entries(data.flags ?? {})) {
        entry.flags[moduleId] = { ...(entry.flags[moduleId] ?? {}), ...payload };
      }
      return entry;
    }
  };

  const game = {
    user: { isGM: true, id: "user-1" },
    journal: { contents: [entry], get: (id) => (id === entry.id ? entry : null) },
    folders: { contents: [] },
    settings: { get: () => "", set: async () => {} }
  };

  const notices = [];
  const Base = class {
    constructor() {}
    async render() {}
  };
  const Details = createMasterQuestDetailsClass(Base);
  const app = new Details({ questId: "q1", game, ui: { notifications: { info: (m) => notices.push(m) } } });

  return { app, game, notices, current: () => entry.flags[MODULE_ID].quest };
}

test("apagar a sessao 2 leva as linhas de Log dela — e so as dela", async (t) => {
  const previous = globalThis.game;
  const harness = makeHarness(questWith());
  globalThis.game = harness.game;
  t.after(() => {
    globalThis.game = previous;
  });

  const result = await harness.app.deleteSession({ number: 2 });
  const quest = harness.current();

  assert.equal(result.status, "deleted");
  assert.deepEqual(
    quest.sessions.map((s) => s.number),
    [1, 3],
    "a sessao 2 sai e as outras ficam intactas"
  );

  // Escolha de Mario (2026-08-07): apagar apaga, sem historico de exclusao — mesmo
  // criterio do Clear log na DEC-039. Quem segura a mao do Mestre e o selo, antes.
  assert.equal(result.deletedEntries, 2);
  assert.deepEqual(quest.log.map((entry) => entry.id), ["l1"], "so a linha da sessao 1 sobrevive");

  // DEC-038: nenhum caminho do modulo apaga documento de conteudo. O ponteiro some junto
  // com a sessao; a pagina do jogador continua existindo no mundo.
  assert.equal(result.keptPage, true);
  assert.ok(
    harness.notices.some((message) => message.includes("2 log entries deleted") && message.includes("kept")),
    "o aviso precisa dizer quanto se foi e o que sobreviveu"
  );
});

test("nenhuma linha orfa sobra para ser adotada pela proxima sessao de mesmo numero", async (t) => {
  // "New session" numera por maior + 1. Apagar a sessao do topo e criar outra reusa o
  // numero; se as linhas velhas tivessem ficado, a sessao nova as adotaria como suas.
  const previous = globalThis.game;
  const harness = makeHarness(
    questWith({
      sessions: [
        { number: 1, date: "2026-08-01", title: "A torre" },
        { number: 2, date: "2026-08-05", title: "O poco" }
      ]
    })
  );
  globalThis.game = harness.game;
  t.after(() => {
    globalThis.game = previous;
  });

  await harness.app.deleteSession({ number: 2 });
  assert.equal(
    harness.current().log.filter((entry) => entry.session === 2).length,
    0,
    "nao pode restar carimbo apontando para uma sessao que nao existe mais"
  );
});

test("apagar sessao nao escreve linha nova no Log", async (t) => {
  // Todo commit passa pelo diff da DEC-032. Sessao e estrutura do caderno, nao ficcao:
  // abrir e fechar sessao nao e acontecimento da campanha, e nao pode virar linha.
  const previous = globalThis.game;
  const harness = makeHarness(questWith());
  globalThis.game = harness.game;
  t.after(() => {
    globalThis.game = previous;
  });

  await harness.app.deleteSession({ number: 1 });
  const quest = harness.current();
  assert.equal(quest.log.length, 2, "sai a linha da sessao 1 e nada e inventado no lugar");
  assert.deepEqual(quest.log.map((entry) => entry.id), ["l2", "l3"]);
});

test("apagar a sessao de maior numero faz a corrente recuar sozinha", async (t) => {
  const previous = globalThis.game;
  const harness = makeHarness(questWith({ sessions: SESSIONS.map((s) => ({ ...s, sealed: false })) }));
  globalThis.game = harness.game;
  t.after(() => {
    globalThis.game = previous;
  });

  await harness.app.deleteSession({ number: 3 });
  const model = buildQuestDetailsViewModel(harness.current(), { isGM: true, canEdit: true });
  assert.equal(model.session.number, 2, "currentSession e a de maior numero; a 2 volta a ser a corrente");
});

test("o metodo recusa apagar sessao selada mesmo se for chamado direto", async (t) => {
  // Segunda trava: o botao nao existe em sessao selada, mas a regra nao pode depender
  // apenas de a interface ter se comportado.
  const previous = globalThis.game;
  const harness = makeHarness(questWith());
  globalThis.game = harness.game;
  t.after(() => {
    globalThis.game = previous;
  });

  const result = await harness.app.deleteSession({ number: 3 });
  assert.equal(result.status, "sealed");
  assert.deepEqual(harness.current().sessions.map((s) => s.number), [1, 2, 3]);
});
