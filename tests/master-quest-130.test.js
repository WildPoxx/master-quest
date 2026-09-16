import test from "node:test";
import assert from "node:assert/strict";

import { QUEST_TYPE, normalizeOrder, normalizeQuest } from "../src/quest/quest-schema.js";
import { AUTHORED_BY_BLUEPRINT } from "../src/quest/merge-quest.js";
import {
  applyBlueprintImport,
  mergeBlueprintIntoQuestWithOrphans,
  planBlueprintImport,
  validateBlueprint
} from "../src/quest/quest-blueprint.js";
import {
  buildQuestDetailsViewModel,
  buildQuestLogViewModel,
  buildQuestRow,
  stagesOf
} from "../src/quest/quest-view-model.js";
import { renderQuestLog } from "../src/ui/quest-log.js";
import { renderQuestDetails, renderStagePanels } from "../src/ui/quest-details.js";

/* =====================================================================================
 * 1.3.0 — SEQUENCIA, a terceira relacao de quest (Mario, 2026-09-11)
 *
 * Ate a 1.2.1, ser subquest era so ter pai (`isSubquest: Boolean(quest.parent)`). Na Quest 0
 * de Mistborn, um arco fatiado em tres etapas lia, no log do jogador, como tres quests a
 * mais. A pergunta que separa as duas coisas:
 *
 *     tirada do pai, esta entrada ainda faz sentido como historia?
 *     sim -> subquest        nao -> sequencia
 * ===================================================================================== */

const OPEN = { default: 2 };      // jogador ve
const CLOSED = { default: 0 };    // jogador nao ve

function quest(id, data = {}) {
  const { ownership = OPEN, ...rest } = data;
  return { ...normalizeQuest({ name: id, status: "active", ...rest }), id, entry: { ownership } };
}

/** O formato da Quest 0: pilar, tres etapas, duas pontas soltas e um relogio. */
function questZero({ q2 = {}, q3 = {}, q4 = {} } = {}) {
  return [
    quest("P", { name: "A Carga Não Reclamada", type: "main", priority: 100,
      subquests: ["Q4", "Q2", "CK1", "Q3", "SD1", "SD2"] }),
    // Entram fora de ordem de proposito: a ordem tem de vir de `order`, nunca da lista.
    quest("Q4", { name: "O Que Se Faz a Respeito", type: "sequence", order: 3, parent: "P",
      status: "inactive", ownership: CLOSED, ...q4 }),
    quest("Q2", { name: "O Roubo no Portão Nove", type: "sequence", order: 1, parent: "P",
      status: "completed", ...q2 }),
    quest("Q3", { name: "Quem Matou Ostrend Vayle", type: "sequence", order: 2, parent: "P",
      status: "active", ...q3 }),
    quest("SD1", { name: "A Conta dos Brandt", type: "side", parent: "P", priority: 50 }),
    quest("SD2", { name: "O Fio da Tenente", type: "side", parent: "P", priority: 40 }),
    quest("CK1", { name: "Deram Pela Falta", type: "clock", parent: "P", ownership: CLOSED })
  ];
}

const allRowIds = (model) => Object.values(model.quests).flat().flatMap((row) => [row.id, ...row.stages.map((s) => s.id)]);

/* ---------------------------------------------------------------- schema ------------ */

test("1.3.0: `sequence` e um tipo, e `order` e inteiro autorado", () => {
  assert.equal(QUEST_TYPE.sequence, "sequence");

  const normalized = normalizeQuest({ type: "sequence", order: 2 });
  assert.equal(normalized.type, "sequence");
  assert.equal(normalized.order, 2);

  // Blueprint escrito a mao traz "2" tanto quanto 2; o resto nao e posicao.
  assert.equal(normalizeOrder("2"), 2);
  assert.equal(normalizeOrder(" 3 "), 3);
  for (const junk of [undefined, null, "", "x", 1.5, true, [], {}]) {
    assert.equal(normalizeOrder(junk), 0, `${JSON.stringify(junk)} nao e posicao`);
  }

  // Quest antiga, sem o campo: nasce com 0, e nada mais muda nela.
  assert.equal(normalizeQuest({ name: "Velha" }).order, 0);
});

test("1.3.0: `order` e do blueprint, como `type` e `priority`", () => {
  assert.ok(AUTHORED_BY_BLUEPRINT.quest.includes("order"));

  const { quest: merged } = mergeBlueprintIntoQuestWithOrphans(null, {
    designId: "X-Q2", name: "Etapa", type: "sequence", order: 2, objectives: [{ name: "a" }]
  });
  assert.equal(merged.order, 2, "a ordem escrita no blueprint tem de chegar a quest");
  assert.equal(merged.type, "sequence");
});

/* ---------------------------------------------------------------- linha do log ------ */

test("1.3.0: etapa nao e subquest — e um filho que NAO e etapa continua sendo", () => {
  const [parent, q4, q2, , sd1] = questZero();
  const index = new Map(questZero().map((q) => [q.id, q]));

  const stage = buildQuestRow(q2, { index });
  assert.equal(stage.isChild, true);
  assert.equal(stage.isSequence, true);
  assert.equal(stage.isSubquest, false);

  // Nao-regressao: o filho comum le exatamente como antes.
  const side = buildQuestRow(sd1, { index });
  assert.equal(side.isChild, true);
  assert.equal(side.isSequence, false);
  assert.equal(side.isSubquest, true);
  assert.equal(side.parentName, "A Carga Não Reclamada");

  const root = buildQuestRow(parent, { index });
  assert.equal(root.isChild, false);
  assert.equal(root.isSubquest, false);
  // O badge de ramificacao conta subquest de verdade: 6 filhos, 3 sao etapas.
  assert.equal(root.subquestCount, 3);
  void q4;
});

test("1.3.0: no log, o arco e UMA linha — as etapas entram dentro dela, em ordem", () => {
  const model = buildQuestLogViewModel(questZero(), { isGM: true, activeTab: "active" });
  const active = model.quests.active;

  assert.deepEqual(active.map((row) => row.id), ["P", "SD1", "SD2", "CK1"],
    "nenhuma etapa pode ser linha de topo quando o pai esta na lista");
  assert.equal(model.counts.active, 4, "a aba conta o trabalho, nao cada fatia dele");
  assert.equal(model.counts.completed, 0, "a etapa concluida nao infla a aba de concluidas");

  const pilar = active[0];
  assert.deepEqual(pilar.stages.map((s) => s.id), ["Q2", "Q3", "Q4"], "ordem vem de `order`");
  assert.deepEqual(pilar.stages.map((s) => s.position), [1, 2, 3]);
  assert.deepEqual(pilar.currentStage, { id: "Q3", name: "Quem Matou Ostrend Vayle", position: 2 });
  assert.equal(pilar.stageTotal, 3);
  assert.ok(pilar.stages[1].statusActions.length, "o Mestre avanca a etapa direto do log");

  const html = renderQuestLog(model);
  assert.match(html, /Etapa 2 de 3 · Quem Matou Ostrend Vayle/);
  assert.match(html, /class="mq-stage-list"/);
  const list = html.match(/<ol class="mq-stage-list"[\s\S]*?<\/ol>/)?.[0] ?? "";
  assert.match(list, /O Roubo no Portão Nove/);
  assert.doesNotMatch(html.replace(list, ""), /O Roubo no Portão Nove/,
    "a etapa so existe dentro da linha do pai — nunca como linha, nunca como 'Subquest de'");
});

test("1.3.0: o jogador ve a trilha que ja pode ver, e nao o tamanho dela", () => {
  const model = buildQuestLogViewModel(questZero(), { isGM: false, activeTab: "active" });
  const pilar = model.quests.active.find((row) => row.id === "P");

  assert.deepEqual(pilar.stages.map((s) => s.id), ["Q2", "Q3"], "etapa oculta nao vaza");
  assert.equal(pilar.stageTotal, null, "'de 3' contaria etapa que ele ainda nao pode ver");
  assert.ok(pilar.stages.every((s) => s.statusActions.length === 0));

  const html = renderQuestLog(model);
  assert.match(html, /Etapa 2 · Quem Matou Ostrend Vayle/);
  assert.doesNotMatch(html, /O Que Se Faz a Respeito/);
  assert.doesNotMatch(html, /Deram Pela Falta/, "o relogio continua do Mestre");
});

test("1.3.0: sem etapa em andamento, a disponivel e a corrente; sem nenhuma, nenhuma", () => {
  const avail = buildQuestLogViewModel(questZero({ q3: { status: "available" } }), { isGM: true });
  assert.equal(avail.quests.active[0].currentStage.id, "Q3");

  const none = buildQuestLogViewModel(questZero({ q3: { status: "completed" } }), { isGM: true });
  assert.equal(none.quests.active[0].currentStage, null, "o modulo nao adivinha etapa");
  assert.doesNotMatch(renderQuestLog(none), /mq-stage-current/);
});

test("1.3.0: etapa cujo pai nao aparece vira linha comum — conteudo nunca some (P5)", () => {
  // Pai oculto para o jogador, etapa visivel.
  const hiddenParent = questZero().map((q) => (q.id === "P" ? { ...q, entry: { ownership: CLOSED } } : q));
  const player = buildQuestLogViewModel(hiddenParent, { isGM: false });
  const q3 = player.quests.active.find((row) => row.id === "Q3");
  assert.ok(q3, "a etapa tem de voltar a ser linha quando o pai nao esta na lista");
  assert.equal(q3.isSequence, true);
  assert.match(renderQuestLog(player), /Etapa de A Carga Não Reclamada/);

  // Pai ausente do mundo.
  const orphan = [quest("Q9", { type: "sequence", parent: "sumiu", order: 1 })];
  const gm = buildQuestLogViewModel(orphan, { isGM: true });
  assert.deepEqual(gm.quests.active.map((row) => row.id), ["Q9"]);
});

test("1.3.0: etapa de etapa nao some nem aparece duas vezes", () => {
  const chain = [
    quest("A", { type: "main" }),
    quest("B", { type: "sequence", parent: "A", order: 1 }),
    quest("C", { type: "sequence", parent: "B", order: 1 })
  ];
  const model = buildQuestLogViewModel(chain, { isGM: true });
  const ids = allRowIds(model).sort();
  assert.deepEqual(ids, ["A", "B", "C"], "cada quest exatamente uma vez, em linha ou em etapa");
});

test("1.3.0: empate de `order` cai na ordem gravada do pai, e so entao no nome", () => {
  const parent = quest("P", { subquests: ["Z", "M", "A"] });
  const kids = ["A", "M", "Z"].map((id) => quest(id, { type: "sequence", parent: "P" }));
  assert.deepEqual(stagesOf(parent, kids).map((q) => q.id), ["Z", "M", "A"]);

  const loose = ["b", "a"].map((id) => quest(id, { name: id, type: "sequence", parent: "P" }));
  assert.deepEqual(stagesOf(quest("P"), loose).map((q) => q.id), ["a", "b"]);
});

/* ---------------------------------------------------------------- detalhes ---------- */

test("1.3.0: na Details do pai, etapas e subquests saem em colecoes separadas", () => {
  const all = questZero({
    q2: { objectives: [{ name: "Entrar no pátio", completed: true, hidden: false }] },
    q3: { objectives: [
      { name: "Examinar o corpo", hidden: false },
      { name: "Descobrir quem avisou a polícia", hidden: true }
    ] }
  });
  const parent = all[0];

  const gm = buildQuestDetailsViewModel(parent, { isGM: true, canEdit: true, allQuests: all });
  assert.deepEqual(gm.sequences.map((s) => s.id), ["Q2", "Q3", "Q4"]);
  assert.deepEqual(gm.subquests.map((s) => s.id).sort(), ["CK1", "SD1", "SD2"]);
  assert.equal(gm.currentSequence.id, "Q3");
  assert.equal(gm.sequences[1].objectives.length, 2);

  const player = buildQuestDetailsViewModel(parent, { isGM: false, allQuests: all });
  assert.deepEqual(player.sequences.map((s) => s.id), ["Q2", "Q3"]);
  assert.deepEqual(player.sequences[1].objectives.map((o) => o.name), ["Examinar o corpo"],
    "objetivo oculto da etapa nao vaza pela tela do pai");

  const html = renderQuestDetails(player);
  assert.match(html, /<section class="mq-stages">/);
  assert.match(html, /Quem Matou Ostrend Vayle/);
  assert.doesNotMatch(html, /Descobrir quem avisou/);
  assert.doesNotMatch(html, /data-action="cycle-objective"[^>]*>[\s\S]*Examinar o corpo/,
    "na tela do pai os objetivos da etapa sao so leitura");
});

test("1.3.0: a propria etapa se apresenta como etapa do arco", () => {
  const all = questZero();
  const q3 = all.find((q) => q.id === "Q3");

  const gm = buildQuestDetailsViewModel(q3, { isGM: true, canEdit: true, allQuests: all });
  assert.equal(gm.isSequence, true);
  assert.equal(gm.isSubquest, false);
  assert.equal(gm.stagePosition, 2);
  assert.equal(gm.stageTotal, 3);
  assert.match(renderQuestDetails(gm), /Stage 2 of A Carga Não Reclamada/);
  assert.doesNotMatch(renderQuestDetails(gm), /Subquest of/);

  const player = buildQuestDetailsViewModel(q3, { isGM: false, allQuests: all });
  assert.equal(player.stageTotal, null);

  // Nao-regressao do filho comum.
  const sd1 = buildQuestDetailsViewModel(all.find((q) => q.id === "SD1"), { isGM: true, allQuests: all });
  assert.equal(sd1.isSubquest, true);
  assert.equal(sd1.stagePosition, null);
  assert.match(renderQuestDetails(sd1), /Subquest of A Carga Não Reclamada/);
});

test("1.3.0: a Manage lista as etapas primeiro, com posicao e desvinculo", () => {
  const all = questZero();
  const model = buildQuestDetailsViewModel(all[0], { isGM: true, canEdit: true, allQuests: all, activeTab: "management" });
  const html = renderQuestDetails(model);

  const roubo = html.indexOf("O Roubo no Portão Nove");
  const brandt = html.indexOf("A Conta dos Brandt");
  assert.ok(roubo > 0 && brandt > roubo, "etapas antes das subquests");
  assert.match(html, /data-action="unlink-subquest" data-quest-id="Q3"[\s\S]*?title="Unlink stage"/);
  assert.doesNotMatch(html, /No subquests\./);
});

/* ---------------------------------------------------------------- importador -------- */

test("1.3.0: sequencia sem pai recebe aviso; sequencia com pai nao gera aviso novo", () => {
  const issues = validateBlueprint({ quests: [
    { designId: "A", name: "A", type: "main", objectives: [{ name: "x" }] },
    { designId: "B", name: "B", type: "sequence", parent: "A", order: 1, objectives: [{ name: "x" }] },
    { designId: "C", name: "C", type: "sequence", objectives: [{ name: "x" }] }
  ] });
  assert.deepEqual(issues.map((i) => [i.code, i.designId]), [["sequence-without-parent", "C"]]);
});

function makeWorld() {
  const journal = [];
  let counter = 0;
  const makeEntry = (id, name, flags) => {
    const entry = {
      id, name, flags, ownership: { default: 0 },
      async update(data) {
        if (data.name !== undefined) entry.name = data.name;
        for (const [scope, payload] of Object.entries(data.flags ?? {})) {
          entry.flags[scope] = { ...(entry.flags[scope] ?? {}), ...payload };
        }
        return entry;
      }
    };
    return entry;
  };
  return {
    journal,
    game: { journal, folders: [], user: { isGM: true } },
    JournalEntry: {
      async create(payload) {
        counter += 1;
        const entry = makeEntry(`j${counter}`, payload.name, payload.flags ?? {});
        journal.push(entry);
        return entry;
      }
    },
    Folder: { async create(data) { return { id: "f1", ...data }; } }
  };
}

const flagOf = (entry) => entry.flags["master-quest"].quest;

test("1.3.0: reimportar mantem pai, etapas e ordem, e a recompensa nao duplica", async () => {
  const blueprint = {
    blueprintId: "t", folderName: "T",
    quests: [
      { designId: "T-P", name: "Pilar", type: "main", objectives: [{ name: "o" }],
        rewards: [{ name: "Reputação", type: "abstract" }, { name: "Dívida", type: "abstract" }] },
      { designId: "T-Q2", name: "Etapa 1", type: "sequence", order: 1, parent: "T-P", objectives: [{ name: "o" }],
        rewards: [{ name: "Recurso", type: "abstract" }] },
      { designId: "T-SD1", name: "Ponta", type: "side", parent: "T-P", objectives: [{ name: "o" }] }
    ]
  };
  const world = makeWorld();

  await applyBlueprintImport({ blueprint, ...world });
  // O Mestre concede uma recompensa na mesa, entre as duas importacoes.
  flagOf(world.journal[0]).rewards[0].granted = true;
  const plan = planBlueprintImport({ blueprint, game: world.game });
  assert.equal(plan.issues.length, 0, "nenhum aviso novo para blueprint bem formado");
  await applyBlueprintImport({ blueprint, ...world });

  assert.equal(world.journal.length, 3, "designId reencontra; nada se cria de novo");
  const [p, q2, sd1] = world.journal.map(flagOf);
  assert.equal(p.rewards.length, 2, "recompensas 2 -> 2 depois de reimportar");
  assert.equal(p.rewards[0].granted, true, "o estado de mesa da recompensa sobrevive");
  assert.equal(q2.rewards.length, 1);
  assert.deepEqual(p.subquests, [world.journal[1].id, world.journal[2].id]);
  assert.equal(q2.parent, world.journal[0].id);
  assert.equal(sd1.parent, world.journal[0].id);
  assert.equal(q2.type, "sequence");
  assert.equal(q2.order, 1);
});

test("1.3.0: mundo que importou ANTES da correcao nao duplica uma ultima vez", () => {
  // Gravado pela 1.2.1: ids sorteados, e um deles ja concedido na mesa.
  const recorded = normalizeQuest({
    designId: "T-P", name: "Pilar",
    rewards: [
      { id: "aB3xZ9", name: "Reputação", granted: true },
      { id: "q7Lm2P", name: "Dívida" }
    ]
  });
  const spec = { designId: "T-P", name: "Pilar", rewards: [{ name: "Reputação" }, { name: "Dívida" }, { name: "Nova" }] };
  const { quest: merged, orphans } = mergeBlueprintIntoQuestWithOrphans(recorded, spec);

  assert.deepEqual(merged.rewards.map((r) => r.id), ["aB3xZ9", "q7Lm2P", "t-p-rw-nova"]);
  assert.equal(merged.rewards[0].granted, true);
  assert.equal(orphans.rewards.length, 0);
});

test("1.3.0: id escrito no blueprint manda, e nomes repetidos nao disputam id", () => {
  const { quest: merged } = mergeBlueprintIntoQuestWithOrphans(null, {
    designId: "T-P", name: "Pilar",
    rewards: [{ id: "meu-id", name: "A" }, { name: "Pista" }, { name: "Pista" }]
  });
  assert.deepEqual(merged.rewards.map((r) => r.id), ["meu-id", "t-p-rw-pista", "t-p-rw-pista-2"]);

  // O contorno da Quest 0 gera exatamente o id que o modulo agora gera: os dois convivem.
  const again = mergeBlueprintIntoQuestWithOrphans(merged, {
    designId: "T-P", name: "Pilar",
    rewards: [{ id: "meu-id", name: "A" }, { id: "t-p-rw-pista", name: "Pista" }, { name: "Pista" }]
  }).quest;
  assert.equal(again.rewards.length, 3);
});

/* =====================================================================================
 * 1.3.1 — AS ETAPAS DENTRO DO GM PANEL (Mario, 2026-09-16)
 *
 * O pedido, nas palavras dele: ter no painel do Mestre "uma subdivisao nas partes da quest,
 * indicando sequencias", clicavel. Forma escolhida: lista que abre e fecha, uma por vez.
 *
 * O que estes testes guardam nao e o visual — e a linha que nao pode ser cruzada: a tela
 * LE o painel de cada etapa e nunca o grava no painel do pai. Painel gravado envelheceria
 * a cada edicao da etapa, e a reimportacao do blueprint (DEC-028) passaria por cima dele.
 * ===================================================================================== */

function arcoComPaineis() {
  const mundo = questZero({
    q2: { gmnotes: "<h2>Portao Nove</h2><p>O vigia sai as 23h. Se insistirem, Tobbin aparece.</p>" },
    q3: { gmnotes: "<p>O corpo tem a fivela da Casa do Porto no bolso.</p>" }
  });
  mundo[0].gmnotes = "<h2>O arco</h2><p>Vayle morre no fim da etapa 1, aconteca o que acontecer.</p>";
  return mundo;
}

const vmDoArco = (isGM = true, canEdit = true) => {
  const mundo = arcoComPaineis();
  const model = buildQuestDetailsViewModel(mundo[0], { isGM, canEdit, allQuests: mundo });
  // O enriquecimento e passo do Foundry; fora dele, o HTML cru serve de equivalente.
  for (const stage of model.sequences) stage.enrichedGmnotes = stage.gmnotes;
  return model;
};

test("1.3.1: o painel de cada etapa chega ao view model, e so para o Mestre", () => {
  const mestre = vmDoArco(true);
  const jogador = buildQuestDetailsViewModel(arcoComPaineis()[0], {
    isGM: false, canEdit: false, allQuests: arcoComPaineis()
  });

  assert.match(mestre.sequences[0].gmnotes, /Portao Nove/);
  assert.equal(mestre.sequences[2].gmnotes, "", "etapa sem painel vem vazia, nao indefinida");
  for (const stage of jogador.sequences) {
    assert.equal(stage.gmnotes, "", "o painel e do Mestre; o jogador nao recebe nem o texto");
  }
});

test("1.3.1: a lista nasce FECHADA, e abrir e um gesto do Mestre", () => {
  const html = renderStagePanels(vmDoArco(true));

  assert.match(html, /mq-stage-panel-list/);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 3, "tres etapas, tres cabecalhos fechados");
  assert.equal((html.match(/mq-stage-panel-body" hidden/g) ?? []).length, 3, "corpo fechado some tambem para leitor de tela");
  assert.doesNotMatch(html, /aria-expanded="true"/);
});

test("1.3.1: o corpo traz objetivos, o painel da etapa e a porta para a ficha dela", () => {
  const html = renderStagePanels(vmDoArco(true));

  assert.match(html, /O Roubo no Portão Nove/);
  assert.match(html, /Portao Nove<\/h2>/, "o painel da etapa aparece dentro do corpo");
  assert.match(html, /data-action="open-quest" data-quest-id="Q2"/);
  assert.match(html, /This stage has no GM Panel yet\./, "etapa sem painel diz que nao tem, e nao finge");
});

test("1.3.1: jogador nao ve a lista, e arco sem etapa nao desenha secao vazia", () => {
  assert.equal(renderStagePanels(vmDoArco(false, false)), "");
  assert.equal(renderStagePanels({ isGM: true, sequences: [] }), "");
  assert.equal(renderStagePanels({ isGM: true }), "");
});

test("1.3.1: o painel da etapa NAO entra no campo que se grava (DEC-028, DEC-031)", () => {
  const model = vmDoArco(true, true);
  model.enriched = { description: "", playernotes: "", gmnotes: model.gmnotes, gmcomments: "" };
  // So a aba ATIVA se desenha; a linha que este teste guarda mora na aba do painel.
  model.activeTab = "gmnotes";
  const html = renderQuestDetails(model);

  // O campo editavel do arco e o `value` do prose-mirror. O texto da etapa nao pode estar
  // la dentro: se estiver, a proxima gravacao do painel do pai leva junto o texto do filho.
  const campos = [...html.matchAll(/<prose-mirror[^>]*value="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(campos.length > 0, "o arco tem campo editavel");
  for (const valor of campos) {
    assert.doesNotMatch(valor, /Portao Nove/, "o painel da etapa vazou para o campo gravavel do pai");
  }
  // E, ainda assim, a lista esta na tela.
  assert.match(html, /mq-stage-panel-list/);
});
