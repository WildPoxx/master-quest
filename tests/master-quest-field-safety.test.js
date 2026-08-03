import assert from "node:assert/strict";
import test from "node:test";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";

/**
 * REGRESSAO 0.16.0 -> 0.16.1 (DEC-026).
 *
 * O commit-on-blur do detalhe da quest casava `[data-field]` e gravava, para elementos nao
 * editaveis, `element.value`. Um <button> satisfaz o seletor e tem `.value` == "": ao perder
 * o foco, gravava string vazia por cima do campo. Como o botao Edit do GM Panel carregava
 * `data-field="gmnotes"`, clicar em Edit apagava o painel inteiro do banco — perda silenciosa,
 * sem erro no console. Ocorreu em producao com a quest "A Sombra de um Sonho de Crianca"
 * (3.804 caracteres), restaurada do backup de 2026-08-03 14:08.
 *
 * A invariante que estes testes trancam: `data-field` marca APENAS superficies onde o usuario
 * digita. Botoes declaram seu alvo em `data-target-field`, que nenhum handler de blur le.
 */

const QUEST = {
  id: "q1",
  name: "Echoes of the Tower",
  status: "active",
  splash: "worlds/x/tower.webp",
  description: "<p>Arrival.</p>",
  gmnotes: "<h2>Function</h2><p>Fascicle.</p>",
  playernotes: "<p>What the table knows.</p>",
  objectives: [{ id: "o1", name: "Reach the tower", completed: false, failed: false, hidden: false }],
  rewards: [{ id: "r1", name: "A silver deed", type: "abstract", hidden: false, locked: false }]
};

const TABS = ["details", "gmnotes", "playernotes", "management"];

/** Todo <button ...> do HTML, como strings inteiras da tag de abertura. */
function buttonTags(html) {
  return html.match(/<button[\s\S]*?>/g) ?? [];
}

for (const tab of TABS) {
  test(`nenhum botao carrega data-field na aba ${tab}`, () => {
    const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: tab });

    for (const editing of [null, tab]) {
      const html = renderQuestDetails({ ...model, editingField: editing, enriched: {} });
      const offenders = buttonTags(html).filter((tag) => /\sdata-field\s*=/.test(tag));

      assert.deepEqual(
        offenders,
        [],
        `botao com data-field grava "" no campo ao perder o foco (aba ${tab}, editingField=${editing})`
      );
    }
  });
}

test("o botao Edit/Done aponta o alvo por data-target-field", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "gmnotes" });

  const reading = renderQuestDetails({ ...model, enriched: {} });
  assert.match(reading, /data-action="edit-notes"[\s\S]*?data-target-field="gmnotes"/);

  const editing = renderQuestDetails({ ...model, editingField: "gmnotes", enriched: {} });
  assert.match(editing, /data-action="finish-notes"[\s\S]*?data-target-field="gmnotes"/);
});

test("as superficies que o usuario digita continuam marcadas com data-field", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "details" });
  const html = renderQuestDetails({ ...model, enriched: {} });

  // Se o seletor de blur for estreitado demais um dia, estes quatro param de salvar.
  assert.match(html, /<input[^>]*data-field="name"/, "titulo editavel");
  assert.match(html, /contenteditable="true" data-field="description"/, "descricao editavel");

  // O caminho da imagem mora na aba Manage, ao lado do botao que abre o FilePicker —
  // e esse botao era o outro portador de data-field, anterior a 0.16.1.
  const manage = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "management" });
  const manageHtml = renderQuestDetails({ ...manage, enriched: {} });
  assert.match(manageHtml, /<input[^>]*data-field="splash"/, "caminho da imagem editavel");

  const panel = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "gmnotes" });
  const editor = renderQuestDetails({ ...panel, editingField: "gmnotes", enriched: {} });
  assert.match(editor, /contenteditable="true"[\s\S]*?data-field="gmnotes"/, "editor do painel salva");
});

test("o jogador sem permissao nao recebe superficie editavel alguma", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: false, canEdit: false, activeTab: "details" });
  const html = renderQuestDetails({ ...model, enriched: {} });

  assert.equal(/data-field=/.test(html), false);
  assert.equal(/contenteditable/.test(html), false);
});
