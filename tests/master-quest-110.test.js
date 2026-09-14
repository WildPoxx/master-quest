/**
 * 1.1.0 — o rearranjo das abas: Overview e Manage.
 *
 * Origem: layout desenhado por Mario em 2026-08-19/20, avaliado nos dois pareceres de
 * design de 20/08 e ensaiado na bancada HTML da mesma data antes de existir codigo.
 *
 * O criterio que governa tudo aqui e uma frase dele:
 *   **Overview = o que pode ser mostrado aos jogadores. Manage = o que fica atras da
 *   cortina.**
 *
 * Ate a 1.0.1 a aba Details carregava SEIS colecoes mais o controle de sessao, e a mesma
 * imagem da quest era desenhada DUAS vezes na janela. Esta versao separa.
 *
 * Estes testes sao guardioes de marcacao, de CSS e de regra de modelo. Nenhum deles prova
 * que a tela ficou boa — so o Foundry vivo prova. O que eles impedem e que qualquer uma
 * destas decisoes volte atras sem que alguem tenha de desfazer um teste de proposito.
 *
 * SPEC-02: rodados contra os fontes da 1.0.1, TODOS reprovam.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizeQuest } from "../src/quest/quest-schema.js";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";

const css = async () => readFile(resolve("styles/masterquest.css"), "utf8");
const detailsSource = async () => readFile(resolve("src/ui/quest-details.js"), "utf8");

/** O corpo da regra de um seletor exato, para nao casar com seletor vizinho. */
function ruleFor(source, selector) {
  const at = source.indexOf(`${selector} {`);
  if (at === -1) return "";
  return source.slice(at, source.indexOf("}", at));
}

/**
 * Uma quest com material em todas as seis colecoes, TUDO VISIVEL ao jogador.
 *
 * `hidden: false` em cada item nao e enfeite: pela DEC-006/DEC-031 todo item NASCE OCULTO.
 * Sem isso, os testes de visibilidade passariam por vacuidade — o jogador nao veria nada,
 * a marcacao viria vazia e a asercao "o jogador nao recebe alca" seria verdadeira sem
 * provar coisa alguma. Um teste que passa por lista vazia nao guarda nada.
 */
function fullQuest() {
  return normalizeQuest({
    name: "A Sombra de um Sonho de Crianca",
    description: "<p>x</p>",
    objectives: [{ id: "o1", name: "Confirmar o papel de Narzim", hidden: false }],
    clues: [{ id: "c1", name: "Rumores de negocios com Khar'Volun", hidden: false }],
    rewards: [{ id: "r1", type: "abstract", name: "Acordo com Al'Farrad", hidden: false }],
    dilemmas: [{ id: "d1", name: "Deixar Ygerr viver, ou acabar com o sofrimento", hidden: false }],
    complications: [{ id: "k1", name: "A inimizade dos Chacais", trigger: "o primeiro conflito", hidden: false }],
    outcomes: [{ id: "f1", name: "Ygerr vivo inicia a Era do Abismo", hidden: false }]
  });
}

const asGM = (extra = {}) => buildQuestDetailsViewModel(fullQuest(), { isGM: true, canEdit: true, ...extra });

/* --- 1. as abas: rotulo, ordem e bloco ----------------------------------------------- */

test("a primeira aba passa a chamar-se Overview — e o id continua `details`", () => {
  const model = asGM();
  const first = model.tabs[0];
  assert.equal(first.label, "Overview", "Details prometia detalhe; a aba e o resumo da quest");
  assert.equal(
    first.id,
    "details",
    "o id e o que o modulo guarda como aba corrente: renomea-lo invalidaria a aba de quem ja usa"
  );
});

test("a aba do Log passa a chamar-se Logs, com o id intacto", () => {
  const log = asGM().tabs.find((tab) => tab.id === "log");
  assert.ok(log, "a aba continua existindo para o Mestre");
  assert.equal(log.label, "Logs");
});

test("a ordem nova poe o bloco do JOGO inteiro na frente do bloco do REGISTRO", () => {
  const ids = asGM().tabs.map((tab) => tab.id);
  assert.deepEqual(ids, ["details", "management", "gmnotes", "gmcomments", "playernotes", "log"]);
});

test("cada aba declara a que bloco pertence, e sao tres e tres", () => {
  const tabs = asGM().tabs;
  assert.deepEqual(
    tabs.map((tab) => tab.block),
    ["play", "play", "play", "record", "record", "record"]
  );
});

/* --- 2. a Manage e do Mestre, e nao de quem so tem posse ------------------------------ */

test("jogador com posse da quest NAO recebe a aba Manage", () => {
  // canEdit e `isGM || canUserModify(...)`: ate a 1.0.1 este jogador entrava na Manage.
  // Com Dilemas, Desfechos e Complicacoes la dentro, isso seria a cortina aberta.
  const model = buildQuestDetailsViewModel(fullQuest(), { isGM: false, canEdit: true });
  assert.equal(model.tabs.some((tab) => tab.id === "management"), false);
});

test("o filete separador nasce entre os dois blocos, e nasce uma vez so", () => {
  const html = renderQuestDetails(asGM());
  const count = html.split("mq-tab-separator").length - 1;
  assert.equal(count, 1, "um filete, na virada de jogo para registro");
});

/* --- 3. o que desceu para a Manage --------------------------------------------------- */

test("a Overview NAO mostra mais Dilemas, Complicacoes nem Desfechos", () => {
  const html = renderQuestDetails(asGM({ activeTab: "details" }));
  assert.equal(html.includes("mq-dilemma"), false, "dilema e maquinaria do Mestre");
  assert.equal(html.includes("mq-complication"), false);
  assert.equal(html.includes("mq-outcome"), false);
});

test("a Overview mantem as tres colecoes que o jogador pode ver", () => {
  const html = renderQuestDetails(asGM({ activeTab: "details" }));
  assert.ok(html.includes("mq-objective"), "objetivo e marco do jogador");
  assert.ok(html.includes("mq-clue"), "pista e o que leva ao objetivo");
  assert.ok(html.includes("mq-reward"), "recompensa e o que muda ao chegar");
});

test("a Manage recebe as tres secoes que sairam da Overview", () => {
  const html = renderQuestDetails(asGM({ activeTab: "management" }));
  assert.ok(html.includes("mq-dilemma"));
  assert.ok(html.includes("mq-complication"));
  assert.ok(html.includes("mq-outcome"));
});

test("o controle de sessao sai da aba do jogador e passa a viver na Manage", () => {
  const overview = renderQuestDetails(asGM({ activeTab: "details" }));
  const manage = renderQuestDetails(asGM({ activeTab: "management" }));
  assert.equal(overview.includes("mq-session"), false, "sessao e instrumento puro do Mestre");
  assert.ok(manage.includes("mq-session"));
  assert.ok(manage.includes("Quest Sessions"));
});

/* --- 4. a imagem desenhada duas vezes ------------------------------------------------ */

test("o campo de splash art sai da Manage — a mesma imagem nao se edita em dois lugares", () => {
  const html = renderQuestDetails(asGM({ activeTab: "management" }));
  assert.equal(
    html.includes('data-field="splash"'),
    false,
    "era a duplicacao apontada no diagnostico de 19/08: a MESMA arte, dois lugares"
  );
});

test("a Overview continua sendo onde a arte se escolhe", () => {
  const html = renderQuestDetails(asGM({ activeTab: "details" }));
  assert.ok(html.includes("mq-quest-image"));
});

/* --- 5. o rodape da Manage ------------------------------------------------------------ */

test("o rodape da Manage reune permissoes, encerramento e snapshot", () => {
  const html = renderQuestDetails(asGM({ activeTab: "management" }));
  assert.ok(html.includes('data-action="configure-ownership"'), "permissoes, que vinham da secao Settings");
  assert.ok(html.includes('data-action="toggle-wrapup"'), "encerramento, que vinha do rodape da Details");
  assert.ok(html.includes('data-action="snapshot-quest"'));
});

/* --- 6. a reordenacao por arrasto nas SEIS colecoes ----------------------------------- */

test("as seis colecoes ganham alca de arrasto para o Mestre", () => {
  const html =
    renderQuestDetails(asGM({ activeTab: "details" })) +
    renderQuestDetails(asGM({ activeTab: "management" }));

  for (const cls of ["mq-objective", "mq-reward", "mq-clue", "mq-dilemma", "mq-complication", "mq-outcome"]) {
    const at = html.indexOf(`<li class="${cls}`) >= 0 ? html.indexOf(`<li class="${cls}`) : html.indexOf(cls);
    const item = html.slice(at, at + 900);
    assert.ok(item.includes("mq-handle"), `${cls} sem alca de arrasto`);
    assert.ok(item.includes('draggable="true"'), `${cls} nao e arrastavel`);
  }
});

test("jogador NAO arrasta — nem as duas colecoes que ja arrastavam na 1.0.1", () => {
  const model = buildQuestDetailsViewModel(fullQuest(), { isGM: false, canEdit: true });
  const html = renderQuestDetails(model);
  assert.equal(html.includes("mq-handle"), false, "a alca e do Mestre; ate a 1.0.1 bastava canEdit");
  assert.equal(html.includes('draggable="true"'), false);
});

test("o arrasto e ligado nas seis colecoes, e so para o Mestre", async () => {
  const source = await detailsSource();
  const block = source.slice(source.indexOf("activateReordering(root)"), source.indexOf("async close("));
  for (const key of ["objectives", "rewards", "clues", "dilemmas", "complications", "outcomes"]) {
    assert.ok(block.includes(`"${key}"`), `${key} fora do laco de reordenacao`);
  }
  assert.match(block, /isGM\s*!==\s*true\)\s*return/, "sem o portao, jogador com posse reordenava");
});

/* --- 7. item novo nasce no topo ------------------------------------------------------- */

test("item novo entra NO TOPO de cada uma das seis listas", async () => {
  const source = await detailsSource();
  // Guardiao de codigo: o spread do rascunho tem de vir DEPOIS do item novo.
  const pairs = [
    ["objectives", "normalizeObjective"],
    ["rewards", "normalizeReward"],
    ["clues", "normalizeClue"],
    ["dilemmas", "normalizeDilemma"],
    ["complications", "normalizeComplication"],
    ["outcomes", "normalizeOutcome"]
  ];
  for (const [key, factory] of pairs) {
    const at = source.indexOf(`${key}: [`);
    assert.ok(at > 0, `nao achei a insercao de ${key}`);
    // Janela fixa em vez de procurar o `]` de fechamento: quatro das seis escrevem
    // `...(draft.x ?? [])`, e o colchete vazio de dentro confundiria a busca.
    const insertion = source.slice(at, at + 220);
    const born = insertion.indexOf(factory);
    const spread = insertion.indexOf("...");
    assert.ok(born >= 0 && spread >= 0, `nao reconheci a insercao de ${key}`);
    assert.ok(
      born < spread,
      `${key}: item novo ainda esta sendo anexado ao FIM — era a queixa de mesa de Mario`
    );
  }
});

/* --- 8. o sistema nunca ordena sozinho ------------------------------------------------ */

test("nenhuma das seis listas recebe ordenacao automatica na renderizacao", async () => {
  const source = await detailsSource();
  for (const key of ["objectives", "rewards", "clues", "dilemmas", "complications", "outcomes"]) {
    assert.doesNotMatch(
      source,
      new RegExp(`model\\.${key}[^;]{0,80}\\.sort\\(`),
      `${key} ordenado pelo sistema desfaz em silencio o trabalho do Mestre`
    );
  }
});

/* --- 9. o empilhamento mede a JANELA, nao o navegador --------------------------------- */

test("a janela e declarada como container — sem isso o empilhamento nunca dispara", async () => {
  const source = await css();
  const rule = ruleFor(source, ".masterquest .window-content");
  assert.match(rule, /container-type:\s*inline-size/);
  assert.match(rule, /container-name:\s*mqwin/);
});

test("o empilhamento usa @container, e nao @media", async () => {
  const source = await css();
  assert.match(source, /@container mqwin \(max-width:\s*780px\)/, "3 -> 2 colunas");
  assert.match(source, /@container mqwin \(max-width:\s*620px\)/, "empilha tudo");
  assert.doesNotMatch(
    source,
    /@media[^{]*\{[^}]*mq-overview-columns/,
    "@media mede o NAVEGADOR; a janela do Foundry e redimensionada dentro dele"
  );
});

/* --- 10. as tres cores que reprovavam na regua ---------------------------------------- */

test("os tres tokens de aba sao DERIVADOS dos tokens da skin, nunca hex", async () => {
  const source = await css();
  const rule = ruleFor(source, ".masterquest");
  for (const token of ["--mq-tab-play", "--mq-tab-record", "--mq-tab-recessed"]) {
    assert.ok(source.includes(token), `${token} nao declarado`);
  }
  const declarations = source.slice(source.indexOf("--mq-tab-play"), source.indexOf("--mq-tab-recessed") + 200);
  assert.match(declarations, /color-mix\(/, "hex aqui quebraria a DEC-018 e exigiria 27 cores novas");
  assert.doesNotMatch(declarations, /#[0-9a-fA-F]{3,8}/, "nenhum valor cru nos tokens de aba");
});

test("a aba Logs recua pelo FUNDO — o texto nunca enfraquece", async () => {
  const source = await css();
  const rule = ruleFor(source, '.masterquest .mq-tab[data-tab-target="log"]');
  assert.match(rule, /background:\s*var\(--mq-tab-recessed\)/);
  assert.match(
    rule,
    /color:\s*var\(--mq-text\)/,
    "com --mq-text-muted o contraste caia a ~3,1:1 nas quatro skins claras"
  );
});

test("o filete separador usa cor cheia, e nao alfa", async () => {
  const source = await css();
  const rule = ruleFor(source, ".masterquest .mq-tab-separator");
  assert.match(rule, /background:\s*var\(--mq-chip-outline\)/);
  assert.doesNotMatch(rule, /--mq-border-strong/, "alfa ficava em ~2,8:1 nas skins claras");
});

/* =====================================================================================
 * 1.1.1 — o que o PRIMEIRO teste em Foundry vivo pediu, e uma regressao que ele revelou
 *
 * Mario abriu a 1.1.0 no Foundry e trouxe tres pedidos e um achado:
 *   1. as tres abas do bloco de JOGO com cores distintas entre si;
 *   2. a janela de quest abrindo maior, para a coluna de Rewards caber inteira;
 *   3. a imagem da quest com tamanho FIXO — ela nao acompanha a janela;
 *   e, ao investigar o Hub que ele cobrou, apareceu a regressao do @container.
 * ===================================================================================== */

/**
 * A largura NAO e um numero de gosto: e a medicao de Mario, convertida.
 *
 * Ele mede a janela fotografando a tela e lendo o print no Canvas Size do Photoshop. A
 * janela publicada, declarada 900x720 no codigo, mede 904x728 no print dele — +4 e +8 de
 * moldura, menos de 1%. Essa diferenca minuscula e a CALIBRAGEM: prova que o monitor dele
 * esta 1:1 com o pixel de CSS, e portanto que o que ele mede pode entrar direto aqui.
 * A largura em que o "+ Reward" deixa de ser cortado mede 1108 no print (~1104 de codigo).
 *
 * O numero final, porem, nao e esse: com Signika e Font Awesome carregados no laboratorio, a
 * cabeca de Rewards pede 344px, e as cinco skins SERIFADAS (a padrao entre elas) so alcancam
 * isso a partir de 1136 de janela. Em 1104 e em 1120 o botao nao e cortado — o `flex-wrap`
 * abaixo impede — mas desce para uma segunda linha. 1160 da 363px de coluna, 19px de folga,
 * e poe a cabeca em UMA linha nas nove skins.
 */
test("1.1.1: a janela de quest abre maior — a largura e o que faltava", async () => {
  const source = await detailsSource();
  const rule = source.slice(source.indexOf("position: { width"), source.indexOf("position: { width") + 60);
  assert.match(rule, /width:\s*1160/, "medicao: e onde a cabeca de Rewards cabe em uma linha nas nove skins");
  assert.match(rule, /height:\s*800/);
});

/**
 * E a trava que torna o corte IMPOSSIVEL, e nao apenas improvavel.
 *
 * A largura maior resolve o caso que Mario viu; nao resolve a causa. A cabeca de Rewards
 * carrega quatro pecas com `white-space: nowrap`, e sem `flex-wrap` o flex encolhe a caixa
 * do botao abaixo do texto que ela nao pode quebrar — o rotulo vaza da propria borda.
 * Bastaria uma skin de fonte mais larga para o defeito voltar em 1120.
 */
test("1.1.1: a cabeca da secao dobra em vez de cortar o botao", async () => {
  const source = await css();
  // As duas regras sao de seletor AGRUPADO — a cabeca vale para as seis colecoes, e o
  // botao para .mq-new-quest, .mq-add e .mq-bulk. `ruleFor` casa `<seletor> {`, que so
  // existe no ULTIMO nome do grupo; por isso a fatia comeca no primeiro nome e vai ate a
  // chave. Assim o teste tambem guarda que Rewards continua DENTRO do grupo.
  const head = source.slice(
    source.indexOf(".masterquest .mq-log-header,"),
    source.indexOf("}", source.indexOf(".masterquest .mq-log-header,"))
  );
  assert.match(head, /\.masterquest \.mq-rewards header,/, "a cabeca de Rewards e a que carrega quatro pecas");
  assert.match(head, /flex-wrap:\s*wrap/, "sem isto o botao vaza da propria borda em janela estreita");

  const add = source.slice(
    source.indexOf(".masterquest .mq-new-quest,"),
    source.indexOf("}", source.indexOf(".masterquest .mq-new-quest,"))
  );
  assert.match(add, /\.masterquest \.mq-add,/);
  assert.match(add, /flex:\s*0\s+0\s+auto/, "o par da regra: o botao nao encolhe");
});

test("1.1.1: a imagem NAO acompanha a janela — a coluna dela tem largura fixa", async () => {
  const source = await css();
  const rule = ruleFor(source, ".masterquest .mq-overview-top");
  assert.match(
    rule,
    /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+450px/,
    "com a coluna em `1fr` a figura esticava junto com a janela, e a proporcao 3:2 deixava de valer"
  );
  assert.doesNotMatch(rule, /minmax\(0,\s*1\.25fr\)/, "a proporcao antiga era o que esticava");
});

test("1.1.1: as tres abas do bloco de jogo tem cada uma a sua cor", async () => {
  const source = await css();
  for (const [target, token] of [
    ["details", "--mq-tab-play-1"],
    ["management", "--mq-tab-play-2"],
    ["gmnotes", "--mq-tab-play-3"]
  ]) {
    const rule = ruleFor(source, `.masterquest .mq-tab[data-tab-target="${target}"]`);
    assert.match(rule, new RegExp(`background:\\s*var\\(${token}\\)`), `${target} sem cor propria`);
  }
});

test("1.1.1: as tres cores vem de tokens NAO semanticos, e derivadas — nunca hex", async () => {
  const source = await css();
  const bloco = source.slice(source.indexOf("--mq-tab-play-1"), source.indexOf("--mq-tab-play-3") + 120);
  assert.match(bloco, /--mq-accent/);
  assert.match(bloco, /--mq-highlight-bg/);
  assert.match(bloco, /--mq-metal-silver/);
  assert.doesNotMatch(bloco, /#[0-9a-fA-F]{3,8}/, "hex aqui quebraria a DEC-018");
  // Cor semantica em navegacao mente: aba vermelha diria "perigo", verde diria "cumprido".
  assert.doesNotMatch(bloco, /--mq-danger|--mq-status-completed|--mq-status-failed/);
});

test("1.1.1: REGRESSAO CORRIGIDA — o Hub sai do ponto de quebra da janela de quest", async () => {
  const source = await css();
  const bloco620 = source.slice(
    source.indexOf("@container mqwin (max-width: 620px)"),
    source.indexOf("}", source.indexOf("mq-overview-columns > section"))
  );
  assert.doesNotMatch(
    bloco620,
    /mq-hub-cards/,
    "o Hub tem 560px FIXOS: herdado neste bloco, ele empilhava em uma coluna sempre"
  );
  assert.match(
    source,
    /@container mqwin \(max-width:\s*420px\)[\s\S]{0,200}mq-hub-cards/,
    "o Hub precisa de ponto de quebra proprio, abaixo da sua largura fixa"
  );
});
