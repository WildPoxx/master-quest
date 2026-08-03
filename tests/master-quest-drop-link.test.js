import assert from "node:assert/strict";
import test from "node:test";
import { buildUuidLink, describeDrop, readDropPayload } from "../src/foundry/drop-link.js";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";

/**
 * 0.17.0 — arrastar documento do Foundry para o GM Panel vira `@UUID[...]{Nome}`.
 *
 * O que se testa aqui e a parte que existe sem navegador: o que o payload significa e que
 * string ele vira. A colocacao no cursor depende de DOM e e verificada em mesa.
 */

test("payload moderno traz uuid direto", () => {
  const out = readDropPayload(JSON.stringify({ type: "Actor", uuid: "Actor.RTi2BXQ2dHaM1tfQ" }));
  assert.deepEqual(out, { uuid: "Actor.RTi2BXQ2dHaM1tfQ", type: "Actor" });
});

test("payload de compendio e montado a partir de pack e id", () => {
  const out = readDropPayload(JSON.stringify({ type: "Actor", pack: "world.npcs", id: "abc123" }));
  assert.equal(out.uuid, "Compendium.world.npcs.abc123");
});

test("payload antigo sem uuid e reconstruido de type e id", () => {
  const out = readDropPayload(JSON.stringify({ type: "JournalEntry", id: "dHJIPhcx5fpZyu8M" }));
  assert.equal(out.uuid, "JournalEntry.dHJIPhcx5fpZyu8M");
});

test("arrastar texto solto ou lixo nao vira link", () => {
  // Cada um destes chega como text/plain igual a um documento; nenhum pode gerar escrita.
  for (const raw of ["", null, undefined, "Hadrik Punho-de-Ferro", "{nao e json", "[]", "42"]) {
    assert.equal(readDropPayload(raw), null, `payload recusado: ${JSON.stringify(raw)}`);
  }
});

test("o link gravado e a FONTE, com rotulo colado nos colchetes", () => {
  // O espaco entre ] e { quebra o enricher silenciosamente — foi assim que um link ficou
  // inerte no painel restaurado em 2026-08-03. A montagem nunca pode produzir esse espaco.
  assert.equal(
    buildUuidLink("Actor.RTi2BXQ2dHaM1tfQ", "Hadrik Punho-de-Ferro"),
    "@UUID[Actor.RTi2BXQ2dHaM1tfQ]{Hadrik Punho-de-Ferro}"
  );
  assert.equal(/\]\s+\{/.test(buildUuidLink("Actor.x", "Nome")), false);
});

test("sem nome, o link vale mesmo assim; sem uuid, nao existe link", () => {
  assert.equal(buildUuidLink("Actor.x", null), "@UUID[Actor.x]");
  assert.equal(buildUuidLink("Actor.x", "   "), "@UUID[Actor.x]");
  assert.equal(buildUuidLink("", "Nome"), "");
  assert.equal(buildUuidLink(null, "Nome"), "");
});

test("chaves no nome do documento nao quebram o parser", () => {
  assert.equal(buildUuidLink("Actor.x", "Ashiq {o louco}"), "@UUID[Actor.x]{Ashiq o louco}");
});

test("documento ilegivel degrada para link sem rotulo, sem lancar", async () => {
  const out = await describeDrop(
    { uuid: "Actor.sumiu" },
    { fromUuid: async () => { throw new Error("sem permissao"); } }
  );

  assert.deepEqual(out, { uuid: "Actor.sumiu", name: null });
  assert.equal(buildUuidLink(out.uuid, out.name), "@UUID[Actor.sumiu]");
});

test("o nome vem do documento no momento do drop, nao do payload", async () => {
  const out = await describeDrop(
    { uuid: "Actor.x", type: "Actor" },
    { fromUuid: async () => ({ name: "Sabotei" }) }
  );

  assert.equal(out.name, "Sabotei");
});

test("as duas zonas do painel aceitam drop: lendo e editando", () => {
  const quest = {
    id: "q1", name: "Echoes", status: "active",
    description: "<p>x</p>", gmnotes: "<p>y</p>", playernotes: "", objectives: [], rewards: []
  };
  const model = buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab: "gmnotes" });

  const lendo = renderQuestDetails({ ...model, enriched: {} });
  assert.match(lendo, /data-drop-field="gmnotes"/, "modo leitura aceita drop");

  const editando = renderQuestDetails({ ...model, editingField: "gmnotes", enriched: {} });
  assert.match(editando, /data-drop-field="gmnotes"/, "modo edicao aceita drop");

  // A zona de drop nao pode virar porta dos fundos para o defeito da 0.16.0 (DEC-026):
  // nenhum botao pode carregar data-field nem data-drop-field.
  for (const html of [lendo, editando]) {
    const botoes = html.match(/<button[\s\S]*?>/g) ?? [];
    assert.deepEqual(botoes.filter((t) => /\sdata-(drop-)?field\s*=/.test(t)), []);
  }
});

test("quem nao pode editar nao recebe zona de drop", () => {
  const quest = {
    id: "q1", name: "Echoes", status: "active",
    description: "<p>x</p>", gmnotes: "<p>y</p>", playernotes: "<p>z</p>", objectives: [], rewards: []
  };
  const model = buildQuestDetailsViewModel(quest, { isGM: false, canEdit: false, activeTab: "playernotes" });

  assert.equal(/data-drop-field/.test(renderQuestDetails({ ...model, enriched: {} })), false);
});
