import test from "node:test";
import assert from "node:assert/strict";

import { FLOW_WEIGHTS, normalizeFlowStep, normalizeQuest } from "../src/quest/quest-schema.js";
import { AUTHORED_BY_BLUEPRINT } from "../src/quest/merge-quest.js";
import { mergeBlueprintIntoQuestWithOrphans } from "../src/quest/quest-blueprint.js";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderFlowEditor, renderFlowScript, renderQuestDetails } from "../src/ui/quest-details.js";

/* =====================================================================================
 * 1.5.0 — O FLUXO (taxonomia MGS 0.5, Mario, 2026-09-17)
 *
 * O fluxo e o roteiro sugerido da quest: sequencias com funcao dramatica e peso —
 * eixo, esperada, aberta —, cada uma apontando para cenas do fasciculo. As regras que
 * estes testes guardam, na ordem do que doeria perder:
 *
 *   1. O fluxo nao tem estado e o modulo nunca deduz "onde a mesa esta".
 *   2. O fluxo e do Mestre: o jogador nao recebe nem o dado.
 *   3. A cena e ponteiro: o texto dela mora na pagina, nunca no card (as duas camadas:
 *      o fasciculo descreve, o modulo rastreia).
 *   4. Peso e sinal, nunca trava — a obrigacao vale ate a segunda pagina.
 * ===================================================================================== */

const OPEN = { default: 2 };

function quest(id, data = {}) {
  return { ...normalizeQuest({ name: id, status: "active", ...data }), id, entry: { ownership: { default: OPEN.default } } };
}

const FLUXO_Q0 = [
  { id: "fx-ks1p1", name: "KS1 · P1 — In media res", weight: "axis",
    scenes: ["@UUID[JournalEntry.PdT.JournalEntryPage.a04]{04 — KS1-P1 — A fairly easy job}"] },
  { id: "fx-plan", name: "The Plan", weight: "open",
    choice: "Permitir aos jogadores escolherem; na falta, segue sugestões",
    scenes: ["@UUID[JournalEntry.PdT.JournalEntryPage.a06]{CS1 — Atualizar Segurança}",
             "@UUID[JournalEntry.PdT.JournalEntryPage.a07]{CS2 — What Fits in a Bag?}"] },
  { id: "fx-c3", name: "Downtime", weight: "expected",
    scenes: ["@UUID[JournalEntry.PdT.JournalEntryPage.a12]{C3 — A Drink Before Dawn}"] }
];

const vmDoArco = (isGM = true, canEdit = true) => {
  const q = quest("P", { type: "main", flow: FLUXO_Q0 });
  const model = buildQuestDetailsViewModel(q, { isGM, canEdit, allQuests: [q] });
  for (const step of model.flow ?? []) step.enrichedScenes = step.scenes;
  return model;
};

/* ------------------------------------------------------------------ schema ---------- */

test("1.5.0: a sequencia normaliza com peso esperado por padrao, e cena vazia cai fora", () => {
  const step = normalizeFlowStep({ name: "The Plan", scenes: ["", "  ", "@UUID[X]{CS1}"] });

  assert.ok(step.id, "sequencia sem id ganha um");
  assert.equal(step.weight, "expected", "peso invalido ou ausente vira esperada, o meio-termo");
  assert.deepEqual(step.scenes, ["@UUID[X]{CS1}"]);
  assert.equal(normalizeFlowStep({ name: "X", weight: "axis" }).weight, "axis");
  assert.deepEqual(FLOW_WEIGHTS, ["axis", "expected", "open"]);
});

test("1.5.0: quest antiga nasce com fluxo vazio e nada mais muda nela", () => {
  const antiga = normalizeQuest({ name: "Velha", status: "active" });
  assert.deepEqual(antiga.flow, []);

  const nova = normalizeQuest({ name: "Nova", flow: FLUXO_Q0 });
  assert.equal(nova.flow.length, 3);
  assert.match(nova.flow[0].scenes[0], /@UUID\[/, "a cena e ponteiro guardado como texto");
});

/* ------------------------------------------------------- blueprint e propriedade ---- */

test("1.5.0: o fluxo e do blueprint, como o gmnotes — direcao vem da fonte", () => {
  assert.ok(AUTHORED_BY_BLUEPRINT.quest.includes("flow"));
  assert.ok(AUTHORED_BY_BLUEPRINT.quest.includes("gmnotes"), "a regra e a mesma da DEC-028");
});

test("1.5.0: o merge traz o fluxo, reimportar identico e no-op, e a fonte governa", () => {
  const spec = { designId: "MGS-Q0", name: "The Unclaimed Cargo", type: "main", flow: FLUXO_Q0 };

  const { quest: gravada } = mergeBlueprintIntoQuestWithOrphans(null, spec);
  assert.equal(gravada.flow.length, 3);
  assert.equal(gravada.flow[1].weight, "open");
  assert.equal(gravada.flow[1].scenes.length, 2);

  const denovo = mergeBlueprintIntoQuestWithOrphans(gravada, spec).quest;
  assert.deepEqual(denovo.flow, gravada.flow, "reimportacao identica e um no-op no fluxo");

  // A regra da DEC-028, dita com todas as letras: o fluxo e direcao e direcao vem da
  // fonte. Reordenacao feita na mesa e sobrescrita pela reimportacao — quem quiser que
  // ela sobreviva a fonte, escreve na fonte.
  const editado = { ...gravada, flow: [...gravada.flow].reverse() };
  const depois = mergeBlueprintIntoQuestWithOrphans(editado, spec).quest;
  assert.deepEqual(depois.flow, gravada.flow, "a fonte restaura o roteiro do blueprint");
});

/* ------------------------------------------------------------------ view model ------ */

test("1.5.0: o fluxo e do Mestre — o jogador nao recebe nem o dado", () => {
  const mestre = vmDoArco(true);
  const jogador = vmDoArco(false, false);

  assert.equal(mestre.flow.length, 3);
  assert.equal(mestre.flow[0].weightLabel, "Axis");
  assert.deepEqual(jogador.flow, [], "direcao e do Mestre; ao jogador nao vai nem vazio disfarcado");
});

/* ------------------------------------------------------------------ leitor ---------- */

test("1.5.0: o Script nasce fechado, com o eixo em relevo e a regra de escolha na aberta", () => {
  const html = renderFlowScript(vmDoArco(true));

  assert.match(html, /mq-flow-list/);
  assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 3, "tres sequencias, tres cabecalhos fechados");
  assert.equal((html.match(/mq-flow-body" hidden/g) ?? []).length, 3);
  assert.match(html, /mq-flow-axis/, "o eixo carrega a classe de relevo");
  assert.match(html, /Permitir aos jogadores escolherem/, "a regra de escolha aparece na sequencia aberta");
  assert.doesNotMatch(html, /Etapa \d+ de|Stage \d+ of|current/, "nenhuma nocao de posicao corrente e inventada");
});

test("1.5.0: sem fluxo nao se desenha secao, e jogador nao ve Script nunca", () => {
  assert.equal(renderFlowScript(vmDoArco(false, false)), "");
  assert.equal(renderFlowScript({ isGM: true, flow: [] }), "");
  const semFluxo = buildQuestDetailsViewModel(quest("P", { type: "main" }), { isGM: true, canEdit: true, allQuests: [] });
  assert.equal(renderFlowScript(semFluxo), "");
});

/* ------------------------------------------------------------------ editor ---------- */

test("1.5.0: a Manage edita o fluxo com os gestos dos Desfechos", () => {
  const html = renderFlowEditor(vmDoArco(true, true));

  assert.match(html, /data-action="add-flow-seq"/);
  assert.match(html, /data-action="cycle-flow-weight"/);
  assert.match(html, /data-action="delete-flow-seq"/);
  assert.match(html, /data-action="edit-flow-seq"/, "o lapis convida para a edicao no lugar");
  assert.match(html, /data-flow-name=/);
  assert.match(html, /data-flow-scenes=/);
  assert.match(html, /draggable="true"/, "reordenar e arrastar, como nas outras colecoes");

  const leitura = renderFlowEditor(vmDoArco(true, false));
  assert.doesNotMatch(leitura, /contenteditable/, "sem permissao de edicao, o fluxo e leitura");
  assert.equal(renderFlowEditor(vmDoArco(false, false)), "", "jogador nao ve o editor");
});

/* --------------------------------------------------- a linha que nao se cruza ------- */

test("1.5.0: o Script nao vaza para o campo gravavel do painel (DEC-028, DEC-031)", () => {
  const model = vmDoArco(true, true);
  model.enriched = { description: "", playernotes: "", gmnotes: "<p>O arco.</p>", gmcomments: "" };
  model.activeTab = "gmnotes";
  const html = renderQuestDetails(model);

  assert.match(html, /mq-flow-list/, "o Script esta na tela");
  const campos = [...html.matchAll(/<prose-mirror[^>]*value="([^"]*)"/g)].map((m) => m[1]);
  assert.ok(campos.length > 0);
  for (const valor of campos) {
    assert.doesNotMatch(valor, /KS1|The Plan|Downtime/, "sequencia vazou para o campo que a gravacao leva");
  }
});
