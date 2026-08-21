import assert from "node:assert/strict";
import test from "node:test";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";

/**
 * Invariantes de integridade dos campos de texto da janela de quest.
 *
 * HISTORICO — vale ler antes de mexer aqui.
 * A 0.16.0 implementou a mao um botao Edit/Done sobre uma caixa contenteditable. O botao
 * carregava `data-field`, o commit-on-blur casava `[data-field]` e gravava `element.value`;
 * um <button> tem value "", entao clicar em Edit apagava o GM Panel do banco em silencio
 * (DEC-026, perda real de 3.804 caracteres). A 0.18.0 removeu o mecanismo inteiro e adotou
 * o <prose-mirror> do proprio Foundry, que ja faz ler/editar, formatacao e drop de
 * documentos (DEC-027).
 *
 * O que estes testes trancam, portanto, e a REGRA, nao a implementacao antiga:
 *   1. gravacao automatica so pode nascer de superficie de digitacao, nunca de comando;
 *   2. o que vai para o editor e a FONTE (@UUID intacto), nunca o HTML enriquecido;
 *   3. quem nao pode editar nao recebe superficie de escrita nenhuma.
 */

const QUEST = {
  id: "q1",
  name: "Echoes of the Tower",
  status: "active",
  splash: "worlds/x/tower.webp",
  description: "<p>Arrival.</p>",
  gmnotes: "<h2>Function</h2><p>See @UUID[JournalEntry.abc]{Fascicle}</p>",
  gmcomments: "<p>Rascunho de mesa.</p>",
  playernotes: "<p>What the table knows.</p>",
  objectives: [{ id: "o1", name: "Reach the tower", completed: false, failed: false, hidden: false }],
  rewards: [{ id: "r1", name: "A silver deed", type: "abstract", hidden: false, locked: false }]
};

const TABS = ["details", "gmnotes", "gmcomments", "playernotes", "management"];
const ENRICHED = {
  gmnotes: '<a class="content-link">Fascicle</a>',
  gmcomments: "<p>Rascunho de mesa.</p>",
  description: "<p>Arrival.</p>"
};

const buttonTags = (html) => html.match(/<button[\s\S]*?>/g) ?? [];

for (const tab of TABS) {
  test(`nenhum botao carrega data-field na aba ${tab}`, () => {
    const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: tab });
    const html = renderQuestDetails({ ...model, enriched: ENRICHED });

    // DEC-026: `data-field` marca so onde o usuario digita. Um botao com esse atributo volta
    // a ser porta para gravar string vazia por cima do campo.
    const offenders = buttonTags(html).filter((tag) => /\sdata-(mq-)?field\s*=/.test(tag));
    assert.deepEqual(offenders, [], `botao com data-field na aba ${tab}`);
  });
}

test("o campo rico e o elemento nativo do Foundry, em modo alternado", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "gmnotes" });
  const html = renderQuestDetails({ ...model, enriched: ENRICHED });

  assert.match(html, /<prose-mirror[^>]*data-mq-field="gmnotes"/, "usa o elemento do core");
  assert.match(html, /<prose-mirror[^>]*toggled="true"/, "ciclo ler/editar e do elemento");

  // Nada de mecanismo artesanal sobrevivendo em paralelo — foi ele que causou a perda.
  assert.equal(/contenteditable/.test(html), false, "sem caixa contenteditable propria");
  assert.equal(/data-action="edit-notes"/.test(html), false, "sem botao Edit proprio");
  assert.equal(/data-action="finish-notes"/.test(html), false, "sem botao Done proprio");
});

test("o editor recebe a FONTE; a exibicao recebe o HTML enriquecido", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "gmnotes" });
  const html = renderQuestDetails({ ...model, enriched: ENRICHED });

  // `value` guarda o que o autor escreveu: se salvassemos a ancora gerada por cima do
  // @UUID, o link morreria na proxima edicao.
  const value = html.match(/<prose-mirror[\s\S]*?value="([\s\S]*?)"/)?.[1] ?? "";
  assert.match(value, /@UUID\[JournalEntry\.abc\]/, "a fonte vai para o editor");
  assert.equal(/content-link/.test(value), false, "ancora enriquecida nao vai para o editor");

  // O conteudo interno e o que o Mestre le com o editor fechado: esse sim, enriquecido.
  const inner = html.match(/<prose-mirror[\s\S]*?>([\s\S]*?)<\/prose-mirror>/)?.[1] ?? "";
  assert.match(inner, /content-link/, "o que se le tem link vivo");
});

test("o painel mantem a tipografia de fasciculo", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "gmnotes" });
  const html = renderQuestDetails({ ...model, enriched: ENRICHED });

  // Titulos, listas e a tabela de correlacao dependem desta classe. Ao trocar o contêiner
  // de leitura pelo elemento nativo, ela quase se perdeu.
  assert.match(html, /<prose-mirror[^>]*class="[^"]*mq-panel-doc/);
});

test("as superficies simples continuam marcadas com data-field", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "details" });
  const html = renderQuestDetails({ ...model, enriched: ENRICHED });

  assert.match(html, /<input[^>]*data-field="name"/, "titulo editavel");
  assert.match(html, /<prose-mirror[^>]*data-mq-field="description"/, "descricao pelo editor nativo");

  // 1.1.0: o campo de texto do caminho da imagem saiu da Manage — era a MESMA arte
  // editavel em dois lugares, o defeito apontado no diagnostico de 19/08. A arte continua
  // trocavel, pelo seletor de arquivos do proprio Foundry, na Overview; e nele que se
  // digita caminho hoje. O contrato que este teste guarda continua valendo: toda superficie
  // que ESCREVE esta marcada e e alcancavel.
  assert.match(html, /data-action="pick-image"[^>]*data-target-field="splash"/, "a arte se troca na Overview");

  const manage = buildQuestDetailsViewModel(QUEST, { isGM: true, canEdit: true, activeTab: "management" });
  assert.doesNotMatch(
    renderQuestDetails({ ...manage, enriched: ENRICHED }),
    /<input[^>]*data-field="splash"/,
    "a segunda superficie de edicao da mesma arte foi retirada de proposito"
  );
});

test("quem nao pode editar nao recebe superficie de escrita alguma", () => {
  const model = buildQuestDetailsViewModel(QUEST, { isGM: false, canEdit: false, activeTab: "playernotes" });
  const html = renderQuestDetails({ ...model, enriched: ENRICHED });

  assert.equal(/prose-mirror/.test(html), false, "jogador nao recebe editor");
  assert.equal(/data-field=/.test(html), false);
  assert.equal(/contenteditable/.test(html), false);
});
