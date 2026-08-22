import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readContinuityReportState } from "../src/continuity/read-continuity-report.js";
import { renderHub } from "../src/ui/master-quest-hub.js";
import { renderFeedReport } from "../src/ui/feed-report.js";

const read = (p) => readFile(resolve(p), "utf8");
const feedSource = () => read("src/ui/feed-report.js");
const hubSource = () => read("src/ui/master-quest-hub.js");

const GM = { isGM: true, questCount: 6, activeCount: 3, fqlPending: 0, fqlTotal: 0 };

/* =====================================================================================
 * 1.2.0 — O Feed Report: ligar a maquina que ja existia e estava DESLIGADA
 *
 * `readContinuityReportState` e `aggregateContinuityState` estavam no repositorio,
 * testados, e sem nenhum chamador na interface. Esta versao e o fio — mais o rearranjo
 * do Hub que Mario pediu duas vezes (21 e 22/08) e que ficou parado porque eu tratei um
 * pedido de duas metades como se a trava sobre uma delas travasse as duas.
 * ===================================================================================== */

test("1.2.0: o Snapshot sai do quadrante e vira gesto de canto", async () => {
  const html = renderHub(GM);

  // O gesto continua existindo — muda de lugar, nao de existencia. E o `data-action`
  // permanece `snapshot`, porque o ouvinte de clique e o mesmo: renomear seria trocar
  // duas pecas para nao ganhar nada.
  assert.match(html, /class="mq-bulk mq-hub-aside"[^>]*data-action="snapshot"/,
    "o Snapshot tem de existir como botao de canto");
  assert.doesNotMatch(html, /class="mq-hub-card" data-action="snapshot"/,
    "o Snapshot NAO pode mais ocupar um dos quatro quadrantes");
});

test("1.2.0: o quadrante que vagou e do Feed Report, e ele abre coisa de verdade", async () => {
  const html = renderHub(GM);
  assert.match(html, /class="mq-hub-card" data-action="feed-report"/);
  assert.match(html, /Feed report/);

  // A trava que impede um cartao-porta-falsa: o Hub tem de CHAMAR a tela. Sem esta
  // asercao, o cartao poderia ser publicado abrindo coisa nenhuma — que foi exatamente
  // o motivo de eu ter recusado publica-lo sozinho.
  const source = await hubSource();
  assert.match(source, /data-action='feed-report'/);
  assert.match(source, /openFeedReport/, "o cartao tem de chamar a tela");
});

test("1.2.0: jogador nao ve nem o Snapshot nem o Feed Report", async () => {
  const html = renderHub({ ...GM, isGM: false });
  assert.doesNotMatch(html, /data-action="snapshot"/);
  assert.doesNotMatch(html, /data-action="feed-report"/);
});

/**
 * DEC-004: o Feed MOSTRA, nunca grava.
 *
 * Esta e a asercao mais importante do arquivo, e ela e escrita sobre o TEXTO do modulo de
 * proposito. Um teste de comportamento provaria que a tela nao gravou naquele caminho;
 * este prova que nao existe caminho — nenhuma funcao de escrita foi sequer importada.
 */
test("1.2.0: o Feed Report nao tem como escrever (DEC-004)", async () => {
  const source = await feedSource();
  for (const proibida of ["saveQuest", "createQuest", "deleteQuest", "setQuestStatus", "createEmbeddedDocuments", "setFlag", "update("]) {
    assert.ok(!source.includes(proibida), `o Feed Report nao pode conhecer ${proibida}`);
  }
  assert.match(source, /readAllQuests/, "ele le o estado vivo");
  assert.match(source, /aggregateContinuityState/, "e cruza com os relatorios");
});

test("1.2.0: a tela mostra os tres blocos, e bloco vazio CONTINUA na tela", () => {
  const html = renderFeedReport({
    reports: [{ questTitle: "A Chave de Rastro" }],
    state: {
      reportCount: 1,
      questCount: 6,
      facts: [{ title: "A Chave de Rastro", text: "Nikko foi interrogado", sourcePath: "s03.md" }],
      openThreads: [],
      uncertainties: [{ title: "O Achado do SWIX", reported: "completed", current: "active" }],
      quests: []
    }
  });

  assert.match(html, /What is established/);
  assert.match(html, /What is still hanging/);
  assert.match(html, /What the module is unsure about/);

  // Bloco vazio nao some. Bloco AUSENTE parece "nao apurado"; bloco vazio e rotulado diz
  // "apurado, e nao ha nada" — e a diferenca entre uma previa honesta e uma tranquilizadora.
  assert.match(html, /Nothing found/, "o bloco vazio tem de aparecer dizendo que esta vazio");

  // Procedencia colada ao item: sem ela o Feed vira palpite com ar de rigor.
  assert.match(html, /mq-feed-source/);
  assert.match(html, /s03\.md/);

  // A incerteza mostra AS DUAS versoes e para. Nunca propoe correcao.
  assert.match(html, /report: completed/);
  assert.match(html, /world: active/);
});

test("1.2.0: sem relatorio carregado a tela convida, nao inventa", () => {
  const html = renderFeedReport({});
  assert.match(html, /Choose one or more continuity reports/);
  assert.doesNotMatch(html, /What is established/, "sem fonte, nenhum bloco e desenhado");
});

test("1.2.0: arquivo ilegivel aparece NOMEADO, nunca em silencio", () => {
  const html = renderFeedReport({ rejected: [{ name: "sessao-07.md", error: "não parece um relatório" }] });
  assert.match(html, /Not read/);
  assert.match(html, /sessao-07\.md/);
});

/**
 * O defeito que so apareceu ao rodar contra os DEZ relatorios reais do Lost Frontier.
 *
 * O relatorio do FQL diz "aqui nao ha nada" com uma frase, e a frase vem como BULLET. A
 * guarda que existia exigia que a linha nao fosse bullet, entao nunca disparava: o bloco de
 * pontas soltas vinha inflado com dezenas de linhas dizendo que nao ha pontas soltas.
 * Ausencia com aparencia de conteudo, no mecanismo feito para o Mestre confiar no que le.
 */
test("1.2.0: marcador de vazio NAO vira item, mesmo vindo como bullet", () => {
  const relatorio = [
    "# Relatório de Continuidade — Sessão 03",
    "_Gerado em: 09/06/2026_",
    "",
    "## 10. Pontas Soltas",
    "- Nenhuma ponta solta selecionada.",
    "- _Nenhum alerta registrado neste fechamento._",
    "- Descobrir quem intermediou o contrato de Nikko.",
    ""
  ].join("\n");

  const parsed = readContinuityReportState(relatorio, { sourcePath: "s03.md" });
  const textos = (parsed.looseEnds ?? []).map((item) => item.text);

  assert.ok(!textos.some((t) => /nenhum/i.test(t)), `marcador de vazio passou: ${JSON.stringify(textos)}`);
  assert.ok(textos.includes("Descobrir quem intermediou o contrato de Nikko."),
    "a ponta solta de verdade tem de sobreviver ao filtro");
});

test("1.2.0: o filtro de vazio nao come a lista inteira", () => {
  const relatorio = [
    "# Relatório de Continuidade — Sessão 04",
    "## 10. Pontas Soltas",
    "- Interrogar o intermediário.",
    "- Recuperar a Chave.",
    ""
  ].join("\n");

  const parsed = readContinuityReportState(relatorio, { sourcePath: "s04.md" });
  assert.equal((parsed.looseEnds ?? []).length, 2);
});
