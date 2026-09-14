/**
 * 0.27 — o que o teste de mesa da 0.26.0 (Mario, 2026-08-07) corrigiu na area de sessao.
 *
 * O relato: *"eu boto o nome e tal, e ele fica ainda como se estivesse no botao. Ele so
 * vai ser aparentemente gravado quando eu clico de novo na mais uma sessao."* O snapshot
 * daquele momento provou que as duas sessoes JA estavam gravadas — o defeito era a lista
 * so se desenhar a partir de duas, escondendo o registro da primeira.
 *
 * Quatro decisoes de Mario travadas aqui: lista sempre visivel; ordem crescente; gesto de
 * confirmacao na tira de entrada; e a sessao aparecendo no Log desde que e aberta.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeQuest } from "../src/quest/quest-schema.js";
import { sessionOpenedEntry } from "../src/quest/quest-log-diff.js";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";

// 1.1.0: a area de sessao saiu da aba do jogador e passou a viver na Manage — sessao e
// instrumento puro do Mestre, e o criterio novo poe isso atras da cortina. O padrao deste
// ajudante acompanha a mudanca; os testes de conteudo continuam os mesmos.
function gm(quest, activeTab = "management") {
  return renderQuestDetails(
    buildQuestDetailsViewModel(normalizeQuest(quest), { isGM: true, canEdit: true, activeTab })
  );
}

const DUAS = [
  { number: 1, date: "2026-08-10", title: "Sombras de Pesadelos" },
  { number: 2, date: "2026-08-15", title: "A terceira roda" }
];

/* --- a lista aparece desde a primeira sessao ----------------------------------------- */

test("uma sessao so ja aparece na lista de registros", () => {
  // O defeito de mesa em uma linha: com uma sessao, so a tira se desenhava, e a tira
  // parece formulario. O Mestre concluia que nada tinha sido gravado.
  const html = gm({ name: "Q", sessions: [{ number: 1, date: "2026-08-10", title: "Sombras de Pesadelos" }] });
  assert.ok(html.includes("mq-session-list"), "a lista tem de existir com uma sessao");
  assert.ok(html.includes("Sombras de Pesadelos"));
});

test("sem sessao nenhuma nao se desenha lista vazia", () => {
  const html = gm({ name: "Q", sessions: [] });
  assert.equal(html.includes("mq-session-list"), false);
  assert.ok(html.includes("No session opened yet."));
});

test("os registros vem em ordem crescente: a sessao 1 antes da 2", () => {
  const html = gm({ name: "Q", sessions: DUAS });
  const lista = html.slice(html.indexOf("mq-session-list"));
  assert.ok(
    lista.indexOf("Sombras de Pesadelos") < lista.indexOf("A terceira roda"),
    "o caderno se le na ordem em que se jogou"
  );
});

/* --- a tira de entrada tem confirmacao, e ela nao esconde rascunho ------------------- */

test("a tira da sessao corrente oferece o gesto de confirmar", () => {
  const html = gm({ name: "Q", sessions: DUAS });
  assert.ok(html.includes(`data-action="session-confirm"`));
});

test("o jogador nao ve nem a confirmacao nem a lista", () => {
  const quest = normalizeQuest({ name: "Q", sessions: DUAS });
  const player = renderQuestDetails(buildQuestDetailsViewModel(quest, { isGM: false, canEdit: false }));
  assert.equal(player.includes(`data-action="session-confirm"`), false);
  assert.equal(player.includes("mq-session-list"), false);
});

/* --- a sessao aparece no Log desde que e aberta -------------------------------------- */

test("a linha de abertura carimba a PROPRIA sessao, nao a anterior", () => {
  // Se herdasse a sessao corrente no momento do commit, a linha da sessao 2 cairia no
  // grupo da sessao 1 — exatamente onde ninguem a procuraria.
  const linha = sessionOpenedEntry({ number: 2, date: "2026-08-15", title: "A terceira roda" }, 1000);
  assert.equal(linha.session, 2);
  assert.equal(linha.targetType, "session");
  assert.equal(linha.target, "A terceira roda");
  assert.equal(linha.change, "session opened — 2026-08-15 — A terceira roda");
  assert.equal(linha.origin, "auto", "o Mestre pode editar e apagar, como qualquer linha (DEC-032)");
  assert.equal(linha.reason, "", "a razao nasce vazia, como toda linha automatica");
});

test("sessao sem subtitulo ainda produz linha legivel", () => {
  const linha = sessionOpenedEntry({ number: 3, date: "2026-08-20", title: "" }, 1000);
  assert.equal(linha.target, "Session 3");
  assert.equal(linha.change, "session opened — 2026-08-20");
});

test("o Log mostra o grupo de uma sessao mesmo sem nada registrado nela", () => {
  // Mario abriu duas sessoes e a aba Log dizia "Nothing logged yet" — o caderno parecia
  // nao ter recebido nada. O cabecalho passa a existir desde a abertura.
  const html = gm({ name: "Q", sessions: DUAS, log: [] }, "log");
  const log = html.slice(html.indexOf("mq-log-body"));
  assert.ok(log.includes("Session 1"), "a sessao 1 tem cabecalho proprio no Log");
  assert.ok(log.includes("Session 2"));
  assert.ok(log.includes("Nothing recorded in this session yet."));
});

test("no Log, os grupos tambem vem em ordem crescente", () => {
  const html = gm({ name: "Q", sessions: DUAS, log: [] }, "log");
  const log = html.slice(html.indexOf("mq-log-body"));
  assert.ok(log.indexOf("Session 1") < log.indexOf("Session 2"));
});

test("linha antiga sem carimbo de sessao continua tendo o grupo inicial, e ele vem primeiro", () => {
  const html = gm({
    name: "Q",
    sessions: DUAS,
    log: [{ id: "velha", target: "Porta", targetType: "objective", change: "completed", session: null }]
  }, "log");
  const log = html.slice(html.indexOf("mq-log-body"));
  assert.ok(log.includes("Before session records"));
  assert.ok(
    log.indexOf("Before session records") < log.indexOf("Session 1"),
    "o que antecede a sessao 1 se le antes dela"
  );
});

test("carimbo apontando para sessao que nao existe mais nao some do Log", () => {
  // Apagar sessao leva as linhas dela (0.26), mas snapshot antigo ou edicao manual podem
  // deixar carimbo orfao. Ele ganha grupo proprio, depois das sessoes vivas — some do
  // Log seria perder registro, e o Log e cronica (DEC-032).
  const html = gm({
    name: "Q",
    sessions: DUAS,
    log: [{ id: "orfa", target: "Bolsa", targetType: "reward", change: "granted", session: 9 }]
  }, "log");
  const log = html.slice(html.indexOf("mq-log-body"));
  assert.ok(log.includes("Session 9"));
  assert.ok(log.includes("Bolsa"));
});
