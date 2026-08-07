/**
 * 0.25 — o que esta versao decidiu, travado em teste.
 *
 * Cada bloco aqui corresponde a um item relatado por Mario no teste de mesa da 0.23.0
 * (2026-08-06) ou a uma decisao registrada (DEC-038, Journal-first). Os testes travam a
 * REGRA, nao a implementacao: quem mudar o desenho tera de mudar a decisao junto.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { normalizeQuest, normalizeSession } from "../src/quest/quest-schema.js";
import { TABLE_OWNED } from "../src/quest/merge-quest.js";
import { summarizeOrphans } from "../src/quest/quest-blueprint.js";
import { countOrphans, orphanReport } from "../src/ui/import-adventure.js";
import {
  LEGACY_PAGE_NAME,
  MASTERQUEST_FOLDER,
  PLAYER_NOTES_FOLDER,
  appendToSessionPage,
  planPlayerNotes,
  playerNotesEntryName,
  sessionPageName
} from "../src/journal/player-notes.js";
import { captureScrollMarks, describeLogLine, restoreScrollMarks } from "../src/ui/quest-details.js";

/* --- scroll preservado entre renders ------------------------------------------------ */

test("a posicao de rolagem sobrevive a troca de conteudo da janela", () => {
  // O pior atrito de mesa da 0.23: cada clique refazia o DOM inteiro e o navegador
  // zerava o scroll, jogando o Mestre de volta ao topo da coluna.
  const inner = { scrollTop: 120 };
  const content = {
    scrollTop: 340,
    querySelectorAll: (selector) => (selector === ".mq-details-body" ? [inner] : [])
  };

  const marks = captureScrollMarks(content);
  assert.equal(marks.root, 340);
  assert.deepEqual(marks.parts, [[".mq-details-body:0", 120]]);

  content.scrollTop = 0;
  inner.scrollTop = 0;
  restoreScrollMarks(content, marks);

  assert.equal(content.scrollTop, 340);
  assert.equal(inner.scrollTop, 120);
});

test("captureScrollMarks aguenta um container sem superficies internas", () => {
  assert.deepEqual(captureScrollMarks(null), { root: 0, parts: [] });
});

/* --- a global depreciada saiu da frente --------------------------------------------- */

test("o download prefere foundry.utils.saveDataToFile a global depreciada", () => {
  // A global sai na v15 e o core ja registrava o aviso no console de Mario.
  for (const file of ["../src/quest/quest-snapshot.js", "../src/reports/quest-wrapup-report.js"]) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    const namespaced = source.indexOf("globalThis.foundry?.utils?.saveDataToFile");
    const global = source.indexOf("globalThis.saveDataToFile");
    assert.ok(namespaced > -1, `${file} deve tentar a forma namespaced`);
    assert.ok(namespaced < global, `${file}: a namespaced vem antes da global`);
  }
});

/* --- sessoes: selo e ponteiro de pagina --------------------------------------------- */

test("a sessao carrega selo e ponteiro de pagina, ambos opcionais", () => {
  const plain = normalizeSession({ number: 3 });
  assert.equal(plain.sealed, false);
  assert.equal(plain.pageUuid, null);

  const full = normalizeSession({ number: 3, sealed: true, pageUuid: "JournalEntry.a.JournalEntryPage.b" });
  assert.equal(full.sealed, true);
  assert.equal(full.pageUuid, "JournalEntry.a.JournalEntryPage.b");
});

test("o ponteiro do caderno e da mesa, nunca da fonte", () => {
  // Blueprint atravessa mundos; uuid de documento nao. Se a fonte pudesse escrever aqui,
  // uma reimportacao apontaria a nota para o nada.
  assert.ok(TABLE_OWNED.quest.includes("playerNotesUuid"));
});

test("playerNotesUuid nasce nulo e sobrevive normalizado", () => {
  assert.equal(normalizeQuest({}).playerNotesUuid, null);
  assert.equal(normalizeQuest({ playerNotesUuid: "JournalEntry.x" }).playerNotesUuid, "JournalEntry.x");
});

/* --- DEC-038: o caderno mora no Journal --------------------------------------------- */

test("a previa da criacao diz onde a nota nasce e com que paginas", () => {
  const quest = normalizeQuest({
    name: "A Sombra de um Sonho de Criança",
    playernotes: "<p>Teste</p>",
    sessions: [{ number: 1, date: "2026-08-06" }, { number: 2, date: "2026-08-14", title: "A joia perdida" }]
  });

  const plan = planPlayerNotes({ quest, game: { journal: [] } });

  assert.equal(plan.status, "create");
  assert.equal(plan.entryName, playerNotesEntryName(quest));
  assert.equal(plan.folderPath, `${MASTERQUEST_FOLDER} / ${PLAYER_NOTES_FOLDER}`);
  // A prosa que ja existia no campo vira a primeira pagina — nada se perde.
  assert.equal(plan.pages[0].name, LEGACY_PAGE_NAME);
  assert.deepEqual(plan.pages.slice(1).map((page) => page.name), [
    "Session 1 — 2026-08-06",
    "Session 2 — 2026-08-14 — A joia perdida"
  ]);
});

test("o nome da pagina e gerado, nao digitado", () => {
  // No teste manual de Mario as paginas foram escritas a mao e sairam "Sesseão 01".
  assert.equal(sessionPageName({ number: 5, date: "2026-08-14", title: "Um novo dilema" }),
    "Session 5 — 2026-08-14 — Um novo dilema");
  assert.equal(sessionPageName({ number: 1 }), "Session 1");
});

test("o push para a pagina escreve HTML limpo e nao duplica linha", async () => {
  const page = {
    text: { content: "" },
    async update(data) { this.text.content = data.text.content; }
  };

  const first = await appendToSessionPage({ page, lines: [{ id: "abc", html: "<strong>Clue found</strong>: Os sonhos" }] });
  assert.equal(first.appended, 1);
  assert.match(page.text.content, /^<p><strong>Clue found<\/strong>: Os sonhos<!--mq:abc--><\/p>$/);
  // Sem `style` inline: o caminho manual (copiar do painel, colar no editor) arrastava
  // spans de scrollbar-color e colava as linhas umas nas outras.
  assert.equal(/style=/.test(page.text.content), false);

  // Segunda tentativa da MESMA linha: recusada. E o remedio para a duplicata observada
  // na Session 4 do teste de mesa.
  const again = await appendToSessionPage({ page, lines: [{ id: "abc", html: "<strong>Clue found</strong>: Os sonhos" }] });
  assert.equal(again.appended, 0);
  assert.equal(again.skipped, 1);
});

test("a linha do push diz a especie do item", () => {
  const html = describeLogLine({ targetType: "clue", change: "found", target: "Os sonhos indicam o caminho...", reason: "" });
  assert.match(html, /Clue found/);
  assert.match(html, /Os sonhos indicam o caminho/);
});

/* --- orfaos: as seis colecoes, e a noticia chegando ao Mestre ------------------------ */

test("o resumo de orfaos cobre as seis colecoes, nao so duas", () => {
  // Ate a 0.23 o importador lia apenas objectives e rewards — resto da epoca em que so
  // existiam essas duas. A DEC-035 criou outras quatro; a divergencia delas sumia.
  const summary = summarizeOrphans({
    objectives: [{ name: "Objetivo velho" }],
    rewards: [],
    dilemmas: [{ name: "Dilema que a fonte largou" }],
    clues: [{ name: "Pista orfa" }],
    complications: [],
    outcomes: [{ name: "Desfecho orfao" }]
  });

  assert.equal(summary.orphanCount, 4);
  assert.deepEqual(Object.keys(summary.orphans).sort(), ["clues", "dilemmas", "objectives", "outcomes"]);
  // Contrato antigo preservado para quem ja lia o resultado.
  assert.deepEqual(summary.orphanObjectives, ["Objetivo velho"]);
});

test("sem divergencia nao ha relatorio", () => {
  assert.equal(summarizeOrphans({ objectives: [], rewards: [] }), null);
  assert.equal(summarizeOrphans(null), null);
});

test("a UI de importacao conta e lista os orfaos do resultado", () => {
  const results = [
    { designId: "MQ-A", orphans: { clues: [{ name: "Pista orfa" }] } },
    { designId: "MQ-B", orphans: { dilemmas: [{ name: "D1" }, { name: "D2" }] } },
    { designId: "MQ-C" }
  ];

  assert.equal(countOrphans(results), 3);
  const rows = orphanReport(results);
  assert.deepEqual(rows.map((row) => row.collection), ["clues", "dilemmas"]);
  assert.deepEqual(rows[1].items, ["D1", "D2"]);
});

/* --- barra de cena: o jogador alcanca o Quest Log ----------------------------------- */

test("a barra de cena declara o Quest Log fora do bloco exclusivo do GM", () => {
  const source = readFileSync(fileURLToPath(new URL("../scripts/init.js", import.meta.url)), "utf8");

  // A guarda de GM nao pode mais barrar o registro inteiro do grupo.
  assert.equal(/if \(!game\.user\?\.isGM \|\|/.test(source), false, "a guarda de GM saiu do topo do hook");
  // As tres ferramentas de autoria vivem no bloco condicionado a isGM.
  const authoring = source.slice(source.indexOf("const authoringTools"), source.indexOf("controls.masterquest"));
  assert.match(authoring, /authoring-console/);
  assert.match(authoring, /import-adventure/);
  assert.equal(/quest-log/.test(authoring), false, "o Quest Log fica fora do bloco de autoria");
});

/* --- a UI nao fala mais portugues --------------------------------------------------- */

test("as janelas de importacao e autoria estao em ingles", () => {
  // DEC-027. A Details, o hub e o Quest Log ja tinham sido varridos na 0.21/0.23; estes
  // tres arquivos eram o que faltava (medido em 2026-08-06).
  const files = [
    "../src/ui/import-adventure.js",
    "../src/ui/authoring-console.js",
    "../src/ui/adventure-review.js"
  ];

  for (const file of files) {
    const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");
    // So o que a interface mostra: rotulos entre tags e titulos de botao.
    const markup = [...source.matchAll(/>([^<>{}\n]{4,})</g)].map(([, chunk]) => chunk);
    const titles = [...source.matchAll(/title="([^"]{4,})"/g)].map(([, chunk]) => chunk);
    const offenders = [...markup, ...titles].filter((chunk) => /[ãõçáéíóúâêôÁÉÍÓÚÃÕÇ]/.test(chunk));
    assert.deepEqual(offenders, [], `${file} ainda tem rotulo em portugues: ${offenders.join(" | ")}`);
  }
});
