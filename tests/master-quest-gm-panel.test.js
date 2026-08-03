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

test("reading the panel shows enriched HTML; editing shows the author's source", () => {
  const base = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "gmnotes" });

  // Reading: the enriched string produced in _prepareContext is what reaches the screen,
  // and the box is not editable — otherwise the generated anchors would be saved back.
  const reading = renderQuestDetails({
    ...base,
    enriched: { gmnotes: '<h2>Function</h2><p>See <a class="content-link">Fascicle</a></p>' }
  });
  assert.match(reading, /content-link/);
  assert.match(reading, /mq-panel-doc/);
  assert.equal(/mq-notes-editor/.test(reading), false);
  assert.match(reading, /data-action="edit-notes"/);

  // Editing: raw source with the @UUID intact, and no enriched anchor anywhere.
  const editing = renderQuestDetails({
    ...base,
    editingField: "gmnotes",
    enriched: { gmnotes: '<a class="content-link">Fascicle</a>' }
  });
  assert.match(editing, /mq-notes-editor/);
  assert.match(editing, /@UUID\[JournalEntry\.abc\]/);
  assert.equal(/content-link/.test(editing), false);
  assert.match(editing, /data-action="finish-notes"/);
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
