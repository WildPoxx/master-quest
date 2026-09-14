/**
 * 1.0.1 — ergonomia da janela de Details, a partir do primeiro teste de mesa com beta.
 *
 * Tres achados de 2026-08-18, dois de beta testers e um de Mario:
 *
 * 1. *"aumente essa parte da Descricao para usar melhor o espaco"* — a Descricao abria com
 *    doze linhas e barra de rolagem enquanto a coluna da direita exibia seis secoes vazias.
 *    Mario acrescentou a metade que faltava do pedido: a caixa cresce ATE um teto e entao
 *    rola por dentro, em vez de empurrar o resto da janela para baixo.
 *
 * 2. *"podia ficar um pouco maior o tamanho da letra desses menus"* — as abas do Quest Log
 *    em 12px.
 *
 * 3. *"o espaco da imagem esta ruim (...) qualquer imagem que colocamos fica cortada"* —
 *    e a medicao no CSS mostrou algo pior que uma proporcao ruim: NAO HAVIA proporcao.
 *    `.mq-quest-image` tinha `height: 150px` fixo, entao a forma da caixa variava com a
 *    largura da janela (2,7:1 numa coluna de 400px, 3,7:1 numa de 560px) e o corte de
 *    `background-size: cover` mudava junto. Decisao de Mario: 3:2 com teto de 300px, e as
 *    DUAS caixas de imagem do modulo unificadas na mesma proporcao.
 *
 * Guardioes de CSS: nao provam desenho na tela — so o Foundry vivo prova —, mas impedem
 * que qualquer das regras volte sem que alguem tenha de desfazer um teste de proposito.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { normalizeQuest } from "../src/quest/quest-schema.js";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";

const css = async () => readFile(resolve("styles/masterquest.css"), "utf8");

/** O corpo da regra de um seletor exato, para nao casar com seletor vizinho. */
function ruleFor(source, selector) {
  const at = source.indexOf(`${selector} {`);
  if (at === -1) return "";
  return source.slice(at, source.indexOf("}", at));
}

/* --- 1. a Descricao ------------------------------------------------------------------ */

test("a Descricao abre com 20 linhas, e nao com 12", async () => {
  const source = await css();
  const rule = ruleFor(source, ".masterquest .mq-description > .mq-readonly-html");
  assert.match(rule, /min-height:\s*20em/);
});

test("descricao longa rola DENTRO da caixa — teto declarado e overflow no eixo vertical", async () => {
  const source = await css();
  const rule = ruleFor(source, ".masterquest .mq-description > .mq-readonly-html");
  assert.match(rule, /max-height:\s*\d+em/, "sem teto, o overflow nao tem contra o que medir");
  assert.match(rule, /overflow-y:\s*auto/, "a barra interna e o pedido explicito de Mario");
});

/* --- 2. as abas ---------------------------------------------------------------------- */

test("a aba usa o tamanho de texto de corpo, nao o pequeno", async () => {
  const source = await css();
  const rule = ruleFor(source, ".masterquest .mq-tab");
  assert.match(rule, /font-size:\s*var\(--mq-text-md\)/);
  assert.doesNotMatch(rule, /font-size:\s*var\(--mq-text-sm\)/);
});

test("o contador da aba acompanha o rotulo, um degrau abaixo", async () => {
  const source = await css();
  assert.match(ruleFor(source, ".masterquest .mq-tab-count"), /font-size:\s*var\(--mq-text-sm\)/);
});

/* --- 3. as duas caixas de imagem ------------------------------------------------------ */

test("a caixa de imagem da quest tem PROPORCAO, e nao altura fixa", async () => {
  const source = await css();
  const rule = ruleFor(source, ".mq-quest-image");
  assert.match(rule, /aspect-ratio:\s*3\s*\/\s*2/);
  assert.doesNotMatch(
    rule,
    /(^|[^-])height:\s*150px/,
    "altura fixa faz a proporcao variar com a largura da janela — foi a causa do corte"
  );
});

test("a proporcao tem teto, para a imagem nao comer a coluna da Descricao", async () => {
  const source = await css();
  assert.match(ruleFor(source, ".mq-quest-image"), /max-height:\s*300px/);
});

test("a caixa VAZIA tem a mesma forma da cheia — senao o layout pula ao escolher a arte", async () => {
  const source = await css();
  const rule = ruleFor(source, ".mq-quest-image-empty");
  assert.doesNotMatch(
    rule,
    /(^|[^-])height:\s*\d+px/,
    "90px contra 150px era o que fazia tudo saltar quando a imagem entrava"
  );
});

test("a segunda caixa de imagem do modulo esta na MESMA proporcao", async () => {
  const source = await css();
  const rule = ruleFor(source, ".masterquest .mq-splash");
  assert.match(rule, /aspect-ratio:\s*3\s*\/\s*2/, "duas proporcoes cortavam a mesma arte de dois jeitos");
  assert.doesNotMatch(rule, /aspect-ratio:\s*2\s*\/\s*1/);
});

/* --- 4. a Complicacao que quebrava letra a letra -------------------------------------- */

test("o gatilho NAO fica mais dentro da fileira do nome", async () => {
  const quest = normalizeQuest({
    name: "Q",
    complications: [{
      id: "c1",
      name: "A inimizade dos Chacais de Golamra",
      trigger: "o primeiro conflito com os Chacais de Golamra"
    }]
  });
  // 1.1.0: a Complicacao desceu para a Manage. O defeito que este teste guarda e o mesmo.
  const html = renderQuestDetails(
    buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab: "management" })
  );

  const row = html.slice(html.indexOf('class="mq-knot-row"'), html.indexOf("</div>", html.indexOf('class="mq-knot-row"')));
  assert.equal(
    row.includes("mq-complication-trigger"),
    false,
    "dentro da fileira ele disputava largura com o nome — foi o que esmagou o nome"
  );
  assert.ok(html.includes("mq-complication-trigger"), "o gatilho continua na tela, em linha propria");
  assert.ok(html.includes("o primeiro conflito com os Chacais de Golamra"), "a frase inteira, nao meia");
});

test("o gatilho e bloco de texto, e nao um chip inline", async () => {
  const quest = normalizeQuest({
    name: "Q",
    complications: [{ id: "c1", name: "N", trigger: "quando a lua virar" }]
  });
  const html = renderQuestDetails(
    buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab: "management" })
  );
  assert.match(html, /<p class="mq-complication-trigger"/);
});

test("o campo lateral do Dilema e do Desfecho passa a CEDER espaco", async () => {
  const source = await css();
  const rule = ruleFor(source, ".masterquest .mq-knot-ref");
  assert.doesNotMatch(rule, /flex:\s*0\s+0\s+auto/, "0 0 auto era a recusa a encolher que causou o defeito");
  assert.match(rule, /flex:\s*0\s+1\s+auto/);
  assert.match(rule, /min-width:\s*0/);
});

test("o nome tem piso de largura — nunca mais uma letra por linha", async () => {
  const source = await css();
  assert.match(ruleFor(source, ".masterquest .mq-knot-name"), /min-width:\s*\d+ch/);
});
