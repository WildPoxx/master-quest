/**
 * 1.0 — o catalogo de nove skins, o estado oculto e o valor que se conserta no banco.
 *
 * Decisoes de Mario em 2026-08-18: as nove skins; a correcao do estado oculto na mesma
 * versao; e a numeracao 1.0 em vez de 0.31.0.
 *
 * O que estes testes NAO provam: que a tela fique bonita. Cor e textura so o olho aprova,
 * e a homologacao em Foundry vivo continua sendo passo separado.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  INTERFACE_SKINS,
  healStoredInterfaceSkin,
  normalizeInterfaceSkin
} from "../src/foundry/skin-settings.js";

const tokens = async () => readFile(resolve("styles/mq-tokens.css"), "utf8");
const components = async () => readFile(resolve("styles/masterquest.css"), "utf8");

const NOVE = [
  "pergaminho",
  "fantasia-medieval",
  "horror",
  "steampunk",
  "cosmic",
  "sci-fi",
  "supers",
  "investigacao-moderna",
  "olf"
];

/* --- 1. o catalogo existe dos dois lados ---------------------------------------------- */

test("as nove skins do codigo sao exatamente as nove declaradas no CSS", async () => {
  // O erro que este teste evita: acrescentar a skin na lista do menu e esquecer os tokens,
  // ou o contrario. O Mestre escolheria um nome e a janela nao mudaria.
  const css = await tokens();
  const declaradas = [...css.matchAll(/data-mq-skin="([a-z-]+)"/g)].map((m) => m[1]);

  for (const skin of NOVE) {
    assert.ok(declaradas.includes(skin), `a skin ${skin} esta no menu e nao tem tokens no CSS`);
  }
  assert.deepEqual([...new Set(declaradas)].sort(), [...NOVE].sort());
  assert.deepEqual(Object.values(INTERFACE_SKINS).sort(), [...NOVE].sort());
});

test("cada skin traz o conjunto COMPLETO de tokens de cor — nenhuma herda por descuido", async () => {
  const css = await tokens();
  const essenciais = ["--mq-surface-0", "--mq-surface-1", "--mq-text", "--mq-accent", "--mq-danger"];

  for (const skin of NOVE.filter((s) => s !== "pergaminho")) {
    const at = css.indexOf(`data-mq-skin="${skin}"`);
    const bloco = css.slice(at, css.indexOf("}", at));
    for (const token of essenciais) {
      assert.ok(bloco.includes(token), `${skin} nao declara ${token}`);
    }
  }
});

/* --- 2. grafismo e fonte por skin ------------------------------------------------------ */

test("cada skin tem grafismo proprio, e nenhum vem de arquivo externo", async () => {
  // DEC-018: tudo procedural. Um asset de terceiro traz licenca junto, e licenca nao se
  // resolve depois de publicado.
  // A verificacao olha SO os valores de --mq-grain. A primeira versao varria o arquivo
  // inteiro e reprovou a fonte Cinzel — que e arquivo local legitimo, embarcado sob OFL
  // (regra 4 da DEC-018). Teste que reprova o que a norma autoriza atrapalha em vez de
  // guardar.
  const css = await tokens();
  const texturas = [...css.matchAll(/--mq-grain:\s*([\s\S]*?);/g)].map((m) => m[1]);

  assert.equal(texturas.length, NOVE.length, "uma textura por skin");
  for (const textura of texturas) {
    // Julgado pelo que a textura NAO pode conter, e nao por analise de `url()`. Tentar
    // extrair o alvo do `url()` nao funciona aqui: o SVG embutido contem `url(%23n)` no
    // proprio corpo, e o parenteses interno fecha a captura no lugar errado. O criterio
    // que interessa e mais simples de verificar e mais dificil de burlar: textura
    // procedural nao aponta para arquivo de imagem nem sai para a rede.
    assert.match(textura, /data:image|gradient\(/, "textura tem de ser SVG embutido ou gradiente");
    assert.doesNotMatch(textura, /\.(png|jpe?g|gif|webp|avif)\b/i, "nenhum arquivo de imagem");
    // A unica URL tolerada e o namespace do SVG, que nao baixa nada.
    assert.doesNotMatch(textura, /https?:\/\/(?!www\.w3\.org\/)/i, "nada vindo da rede");
  }
});

test("a fonte de titulo passa a ser valor de SKIN, seguindo a regra serifada / sem serifa", async () => {
  // Regra fixada por Mario em 2026-08-18, para valer como regra do sistema.
  const css = await tokens();
  const fonteDe = (skin) => {
    const at = css.indexOf(`data-mq-skin="${skin}"`);
    const bloco = css.slice(at, css.indexOf("}", at));
    const m = bloco.match(/--mq-font-display:\s*([^;]+);/);
    return m ? m[1] : "";
  };

  for (const skin of ["fantasia-medieval", "horror", "steampunk", "cosmic"]) {
    assert.match(fonteDe(skin), /serif/, `${skin} deve ser serifada`);
    assert.doesNotMatch(fonteDe(skin), /sans-serif/, `${skin} nao pode cair em sans-serif`);
  }
  for (const skin of ["sci-fi", "investigacao-moderna", "supers", "olf"]) {
    assert.match(fonteDe(skin), /sans-serif/, `${skin} deve ser sem serifa`);
  }
});

/* --- 3. o estado oculto ---------------------------------------------------------------- */

test("o oculto deixa de se marcar so por luminosidade", async () => {
  // Medido nas nove em 2026-08-18: com opacity .55 o texto secundario oculto reprova o
  // contraste minimo em NOVE de nove. E mais opacidade nao resolve — a 4,5:1 seria preciso
  // .92 a .97, ou seja, praticamente nao esmaecido.
  const css = await components();
  const ocultos = [...css.matchAll(/\.is-hidden[^{]*\{[^}]*opacity:\s*([\d.]+)/g)].map((m) => Number(m[1]));

  assert.ok(ocultos.length > 0, "o estado oculto tem de existir");
  for (const valor of ocultos) {
    assert.ok(valor >= 0.85, `opacidade ${valor} deixa o texto oculto ilegivel na mesa`);
  }
});

test("o oculto tem marca NAO luminosa, e ela nao se confunde com o filete de spoiler", async () => {
  // Dois eixos diferentes (DEC-031/DEC-035) precisam de marcas diferentes: tracejada para
  // oculto, solida para spoiler. Iguais, o Mestre le um pelo outro.
  const css = await components();
  const at = css.indexOf(".masterquest .mq-objective.is-hidden,\n.masterquest .mq-reward.is-hidden,");
  const bloco = css.slice(at, css.indexOf("}", at));

  assert.match(bloco, /border-left:\s*3px dashed/);
  assert.match(bloco, /var\(--mq-border-strong\)/, "sem token novo");
  assert.doesNotMatch(bloco, /--mq-danger/, "danger e do spoiler, nao do oculto");
});

/* --- 4. o valor invalido nao fica no banco --------------------------------------------- */

test("skin desconhecida e reescrita no mundo, e nao so corrigida na tela", () => {
  const gravados = [];
  const game = {
    user: { isGM: true },
    settings: {
      get: () => "skin-que-nao-existe-mais",
      set: (...args) => gravados.push(args)
    }
  };

  const result = healStoredInterfaceSkin({ game });

  assert.equal(result.status, "healed");
  assert.equal(result.skin, INTERFACE_SKINS.parchment);
  assert.deepEqual(gravados, [["master-quest", "interfaceSkin", INTERFACE_SKINS.parchment]]);
});

test("valor valido nao gera escrita — e o jogador nunca escreve", () => {
  const gravados = [];
  const base = (isGM, value) => ({
    user: { isGM },
    settings: { get: () => value, set: (...args) => gravados.push(args) }
  });

  assert.equal(healStoredInterfaceSkin({ game: base(true, "horror") }).status, "ok");
  assert.equal(healStoredInterfaceSkin({ game: base(false, "lixo") }).status, "not-gm");
  assert.deepEqual(gravados, [], "escrever a toa e escrever no mundo de alguem");
});

test("normalizar aceita as nove e recusa o resto", () => {
  for (const skin of NOVE) assert.equal(normalizeInterfaceSkin(skin), skin);
  for (const lixo of ["", null, undefined, "cosmere", 42]) {
    assert.equal(normalizeInterfaceSkin(lixo), INTERFACE_SKINS.parchment);
  }
});
