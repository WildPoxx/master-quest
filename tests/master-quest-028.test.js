/**
 * 0.28 — a moldura de secao do push, e as acoes do Log que pararam de se esconder.
 *
 * Teste de mesa da 0.27.0 (Mario, 2026-08-07), dois achados:
 *
 * 1. *"depois que novos elementos do log sao colocados, nao temos mais a opcao de enviar
 *    aquela parte do log para as notas do GM ou notas do player (...) isso fica restrito
 *    so logo depois da criacao."* — os botoes SEMPRE estiveram em toda linha; viviam a 35%
 *    de opacidade e so acendiam no hover. Correcao de CSS, travada em
 *    `master-quest-css.test.js` pela regra de tokens; aqui trava-se o que e estrutural:
 *    toda linha renderiza os tres gestos, sempre.
 *
 * 2. *"ela nao ta com abertura de cabecalho de H4 (...) ja deveria entrar assim, da mesma
 *    forma que ta no log."* — o push escrevia um paragrafo solto com a sessao em italico.
 *    Passa a escrever na secao da sessao, no formato que Mario deixou no mundo a mao.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { normalizeQuest } from "../src/quest/quest-schema.js";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";
import { appendUnderSection, sectionHeading } from "../src/notes/session-sections.js";

const S4 = { number: 4, date: "2026-09-07", title: "outro teste" };

/* --- 1. os tres gestos existem em toda linha ----------------------------------------- */

test("toda linha do Log oferece os tres gestos: GM Notes, Player Notes e apagar", () => {
  const quest = normalizeQuest({
    name: "Q",
    sessions: [S4],
    log: [
      { id: "velha", target: "Porta", targetType: "objective", change: "completed", session: 4 },
      { id: "nova", target: "Bolsa", targetType: "reward", change: "granted", session: 4 }
    ]
  });
  const html = renderQuestDetails(buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab: "log" }));

  for (const id of ["velha", "nova"]) {
    for (const action of ["log-push-gm", "log-push-player", "log-delete"]) {
      assert.ok(
        html.includes(`data-action="${action}" data-item-id="${id}"`),
        `a linha ${id} precisa oferecer ${action} — nao so a mais recente`
      );
    }
  }
});

test("o jogador nao ve gesto nenhum na linha do Log", () => {
  const quest = normalizeQuest({
    name: "Q",
    sessions: [S4],
    log: [{ id: "x", target: "Porta", targetType: "objective", change: "completed", session: 4 }]
  });
  const html = renderQuestDetails(buildQuestDetailsViewModel(quest, { isGM: false, canEdit: false, activeTab: "log" }));
  assert.equal(html.includes("log-push-gm"), false);
  assert.equal(html.includes("log-delete"), false);
});

/* --- 2. a moldura de secao ------------------------------------------------------------ */

test("o cabecalho segue a forma que Mario fixou: Session N: subtitulo", () => {
  assert.equal(sectionHeading(S4), "Session 4: outro teste");
  assert.equal(sectionHeading({ number: 4, title: "" }), "Session 4");
  assert.equal(sectionHeading(null), "Before session records");
});

test("secao nova nasce com h4 e regua, no fim do campo", () => {
  const html = appendUnderSection("", { session: S4, line: "<strong>Note Manual</strong>: Entrada" });
  assert.equal(html, "<h4>Session 4: outro teste</h4><hr><p><strong>Note Manual</strong>: Entrada</p>");
});

test("a segunda linha da MESMA sessao entra na secao que ja existe, sem novo cabecalho", () => {
  let html = appendUnderSection("", { session: S4, line: "primeira" });
  html = appendUnderSection(html, { session: S4, line: "segunda" });

  assert.equal(html.match(/<h4/g).length, 1, "nao pode nascer um segundo cabecalho igual");
  assert.ok(html.indexOf("<p>primeira</p>") < html.indexOf("<p>segunda</p>"), "ordem de chegada preservada");
});

test("sessao diferente ganha secao propria, depois da anterior", () => {
  let html = appendUnderSection("", { session: { number: 1, title: "Sombras" }, line: "a" });
  html = appendUnderSection(html, { session: S4, line: "b" });

  assert.ok(html.indexOf("Session 1: Sombras") < html.indexOf("Session 4: outro teste"));
  assert.equal(html.match(/<h4/g).length, 2);
});

test("linha nova de uma sessao ANTIGA volta para a secao dela, e nao para o fim do campo", () => {
  // O caso que separa "acrescentar na secao" de "acrescentar no fim": o Mestre empurra,
  // dias depois, uma linha da sessao 1. Ela pertence ao bloco da sessao 1.
  let html = appendUnderSection("", { session: { number: 1, title: "Sombras" }, line: "a" });
  html = appendUnderSection(html, { session: S4, line: "b" });
  html = appendUnderSection(html, { session: { number: 1, title: "Sombras" }, line: "c" });

  assert.ok(html.indexOf("<p>c</p>") < html.indexOf("Session 4"), "a linha da sessao 1 fica no bloco da sessao 1");
  assert.equal(html.match(/<h4/g).length, 2, "nenhuma secao duplicada");
});

test("reconhece o cabecalho mesmo depois de o ProseMirror devolver com atributos", () => {
  // Depois de o Mestre editar o campo a mao, o <h4> volta com class/style. Casar pela
  // marcacao exata duplicaria a secao a cada push seguinte.
  const editado = `<h4 class="mq-x" style="color:red">Session 4: outro teste</h4><hr><p>ja estava</p>`;
  const html = appendUnderSection(editado, { session: S4, line: "nova" });

  assert.equal(html.match(/<h4/g).length, 1);
  assert.ok(html.includes("<p>ja estava</p>"), "o que o Mestre escreveu permanece");
  assert.ok(html.indexOf("<p>ja estava</p>") < html.indexOf("<p>nova</p>"));
});

test("nada do que o Mestre escreveu antes e reescrito", () => {
  const antes = "<p>prosa livre do Mestre</p>";
  const html = appendUnderSection(antes, { session: S4, line: "x" });
  assert.ok(html.startsWith(antes), "o campo cresce; nunca se reescreve");
});

test("subtitulo com marcacao nao injeta HTML no cabecalho", () => {
  const html = appendUnderSection("", { session: { number: 2, title: '<img src=x onerror="alert(1)">' }, line: "x" });
  assert.equal(html.includes("<img"), false);
  assert.ok(html.includes("&lt;img"));
});

test("linha sem sessao cai no bloco inicial, com o mesmo nome que o Log usa", () => {
  const html = appendUnderSection("", { session: null, line: "x" });
  assert.ok(html.includes("<h4>Before session records</h4>"));
});
