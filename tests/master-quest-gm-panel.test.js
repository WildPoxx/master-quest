import assert from "node:assert/strict";
import test from "node:test";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";
import { enrichQuestHtml } from "../src/foundry/enrich.js";

const QUEST = {
  id: "q1",
  name: "Echoes of the Tower",
  status: "active",
  description: "<p>Arrival.</p>",
  gmnotes: "<h2>Function</h2><p>See @UUID[JournalEntry.abc]{Fascicle}</p>",
  playernotes: "<p>What the table knows.</p>",
  objectives: [],
  rewards: []
};

test("GM Panel is the second tab, right after Details", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true });

  assert.deepEqual(
    model.tabs.map((tab) => tab.id),
    ["details", "gmnotes", "playernotes", "management"]
  );
  assert.equal(model.tabs[1].label, "GM Panel");
});

test("players never get the GM Panel tab", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: false, canEdit: false });

  assert.equal(model.tabs.some((tab) => tab.id === "gmnotes"), false);
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
