import assert from "node:assert/strict";
import test from "node:test";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";
import { enrichQuestHtml } from "../src/foundry/enrich.js";
import { normalizeQuest } from "../src/quest/quest-schema.js";
import { readQuest } from "../src/quest/quest-store.js";
import { buildQuestSnapshot, makeSnapshotFilename } from "../src/quest/quest-snapshot.js";

const QUEST = {
  id: "q1",
  name: "Echoes of the Tower",
  status: "active",
  description: "<p>Arrival.</p>",
  gmnotes: "<h2>Function</h2><p>See @UUID[JournalEntry.abc]{Fascicle}</p>",
  gmcomments: "<p>Rascunho de mesa.</p>",
  playernotes: "<p>What the table knows.</p>",
  objectives: [],
  rewards: []
};

test("GM Panel is the second tab, right after Details", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true });

  assert.deepEqual(
    model.tabs.map((tab) => tab.id),
    ["details", "gmnotes", "gmcomments", "playernotes", "management"]
  );
  assert.equal(model.tabs[1].label, "GM Panel");
  assert.equal(model.tabs[2].label, "GM Notes");
});

test("players never get the GM Panel tab", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: false, canEdit: false });

  assert.equal(model.tabs.some((tab) => tab.id === "gmnotes"), false);
  assert.equal(model.tabs.some((tab) => tab.id === "gmcomments"), false);
  assert.deepEqual(model.tabs.map((tab) => tab.id), ["details", "playernotes"]);
});

test("o painel entrega fonte e exibicao ao elemento nativo, nao a um toggle proprio", () => {
  // Ate a 0.17.0 esta janela alternava leitura e edicao com um botao proprio (DEC-025), o que
  // custou a perda de dados da DEC-026. A 0.18.0 delega ao <prose-mirror> (DEC-027).
  const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "gmnotes" });
  const html = renderQuestDetails({
    ...model,
    enriched: { gmnotes: '<h2>Function</h2><p>See <a class="content-link">Fascicle</a></p>' }
  });

  assert.match(html, /<prose-mirror[^>]*toggled="true"/);
  assert.match(html, /content-link/, "fechado, o Mestre le o link vivo");
  assert.match(html, /mq-panel-doc/, "tipografia de fasciculo preservada");

  const value = html.match(/<prose-mirror[\s\S]*?value="([\s\S]*?)"/)?.[1] ?? "";
  assert.match(value, /@UUID\[JournalEntry\.abc\]/, "aberto, o Mestre edita a fonte");
});

test("enrichment sanitizes first and degrades to plain content without an enricher", async () => {
  // No Foundry in the test runner: the enricher is absent, so we must still get safe HTML
  // back rather than an exception.
  const out = await enrichQuestHtml('<p onclick="steal()">Hi</p><script>bad()</script>');

  // Two sanitizer paths reach this point: with a DOM the dangerous nodes and attributes are
  // stripped; without one everything is escaped into inert text. Assert the property that
  // must hold either way — nothing executable survives as live markup — rather than the
  // exact string, which legitimately differs between the two.
  assert.equal(/<script/i.test(out), false, "no live <script> tag");
  assert.equal(/<[^>]*\sonclick/i.test(out), false, "no live event-handler attribute");
  assert.match(out, /Hi/, "the actual content survives");
});

test("quest da 0.18.0 sobe do disco intacta: a 0.19.0 nao move dado nenhum", () => {
  // DEC-028: o campo NOVO e o de mesa, entao o painel continua exatamente onde sempre
  // esteve. Nenhuma migracao, nenhum dado em transito, e voltar para a 0.18.x nao custa
  // nada — foi por isso que a nomenclatura da DEC-028 venceu a que eu tinha proposto.
  const entry = { id: "q9", flags: { "master-quest": { quest: { name: "X", gmnotes: "<h2>Fasciculo</h2>" } } } };
  const quest = readQuest(entry);

  assert.equal(quest.gmnotes, "<h2>Fasciculo</h2>", "o painel nao se mexeu");
  assert.equal(quest.gmcomments, "", "as notas de mesa nascem vazias");
});

test("a importacao nunca escreve nas notas de mesa", () => {
  // O nucleo da DEC-028: reimportar blueprint sobrescreve o painel, que e fonte, e tem de
  // passar longe do que o Mestre anotou na mesa. Como nenhum importador conhece o campo,
  // a garantia e estrutural — e este teste existe para que continue sendo.
  const written = normalizeQuest({ name: "X", gmnotes: "<p>fasciculo reimportado</p>" });

  assert.equal(written.gmnotes, "<p>fasciculo reimportado</p>");
  assert.equal(written.gmcomments, "", "importador nao tem o que dizer sobre gmcomments");
});

test("o snapshot da janela recorta a quest e a arvore abaixo dela", () => {
  const journal = [
    entryFor("raiz", { name: "Raiz", subquests: ["filha"] }),
    entryFor("filha", { name: "Filha", parent: "raiz", subquests: ["neta"] }),
    entryFor("neta", { name: "Neta", parent: "filha" }),
    entryFor("estranha", { name: "Estranha" })
  ];

  const all = buildQuestSnapshot({ game: { journal }, capturedAt: "2026-08-04T00:00:00.000Z" });
  assert.equal(all.summary.questCount, 4);
  assert.equal(all.scope.mode, "all-quests");

  const scoped = buildQuestSnapshot({ game: { journal }, capturedAt: "2026-08-04T00:00:00.000Z", questId: "raiz" });
  assert.deepEqual(scoped.quests.map((q) => q.id).sort(), ["filha", "neta", "raiz"]);
  assert.equal(scoped.scope.rootQuestName, "Raiz");
  assert.match(makeSnapshotFilename(scoped), /-raiz-/, "o nome da quest entra no arquivo");
});

test("um ciclo na arvore de subquests nao trava o snapshot", () => {
  // A arvore e desenhada a mao; nada no Foundry impede que uma reorganizacao feche um ciclo.
  const journal = [
    entryFor("a", { name: "A", subquests: ["b"] }),
    entryFor("b", { name: "B", subquests: ["a"] })
  ];

  const scoped = buildQuestSnapshot({ game: { journal }, capturedAt: "2026-08-04T00:00:00.000Z", questId: "a" });
  assert.deepEqual(scoped.quests.map((q) => q.id).sort(), ["a", "b"]);
});

test("os botoes de snapshot existem para o Mestre e nao para o jogador", () => {
  const gm = renderQuestDetails({
    ...buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true }),
    enriched: {}
  });
  assert.equal((gm.match(/data-action='snapshot-quest'|data-action="snapshot-quest"/g) ?? []).length, 2);

  const player = renderQuestDetails({
    ...buildQuestDetailsViewModel(QUEST, { isGM: false, canEdit: false }),
    enriched: {}
  });
  assert.equal(/snapshot-quest/.test(player), false, "snapshot carrega objetivo oculto e recompensa travada");
});

function entryFor(id, quest) {
  return { id, name: quest.name, flags: { "master-quest": { quest } } };
}
