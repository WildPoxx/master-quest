/**
 * 0.30.1 — a tabela do Log deixa de expulsar os proprios botoes.
 *
 * Relatado por Mario em 2026-08-13, com um texto de mesa de verdade na coluna do meio:
 * *"quando nos escrevemos um texto muito longo, ele parece empurrar toda a celula da
 * janela para a direita (...) e agora qualquer log de entrada fica com o botao perdido."*
 *
 * A causa: `white-space: nowrap` na coluna `change`, numa tabela sem `table-layout: fixed`.
 * Sem poder quebrar, a coluna exigia a largura inteira do texto, as porcentagens viravam
 * sugestao, e a coluna das ACOES saia da janela. Como largura de coluna e da TABELA e nao
 * da linha, UMA entrada longa levava junto os botoes de todas as linhas do grupo.
 *
 * Estes testes sao guardioes de CSS: nao provam o desenho na tela — so o Foundry vivo faz
 * isso —, mas impedem que a regra volte sem que alguem tenha de mudar o teste de proposito.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const css = async () => readFile(resolve("styles/masterquest.css"), "utf8");

/** O corpo da regra de um seletor exato, para nao casar com seletor vizinho. */
function ruleFor(source, selector) {
  const at = source.indexOf(`${selector} {`);
  if (at === -1) return "";
  return source.slice(at, source.indexOf("}", at));
}

test("a tabela do Log tem largura travada — as porcentagens das colunas precisam valer", async () => {
  const source = await css();
  assert.match(ruleFor(source, ".masterquest .mq-log-table"), /table-layout:\s*fixed/);
});

test("a coluna do meio PODE quebrar linha — foi o nowrap que expulsou os botoes", async () => {
  const source = await css();
  assert.doesNotMatch(
    ruleFor(source, ".masterquest .mq-log-change"),
    /white-space:\s*nowrap/,
    "texto de mesa e prosa: proibir quebra faz a tabela crescer sem limite"
  );
});

test("os tres campos do Log quebram texto longo e RESPEITAM a quebra digitada", async () => {
  // `pre-wrap` porque o campo grava `textContent`: sem ele, o Enter do Mestre virava
  // espaco no redesenho e o texto "voltava" ao corrido.
  const source = await css();
  const rule = ruleFor(source, ".masterquest .mq-log-target-text,\n.masterquest .mq-log-change-text,\n.masterquest .mq-log-reason-text");
  assert.match(rule, /white-space:\s*pre-wrap/);
  assert.match(rule, /overflow-wrap:\s*anywhere/);
});

test("a coluna de acoes tem largura REAL, e nao 0.1%", async () => {
  // Com `table-layout: fixed`, 0.1% daria uma coluna de nada e os icones vazariam.
  const source = await css();
  const rule = ruleFor(source, ".masterquest .mq-log-row-actions");
  assert.match(rule, /width:\s*\d+px/);
  assert.doesNotMatch(rule, /width:\s*0\.1%/);
});

test("o campo do Log grava as quebras que o Mestre digitou", async () => {
  // Com o campo em foco quem quebrava era o `<br>` do navegador; ao sair, `textContent`
  // o ignorava e gravava texto corrido — a linha voltava a estourar a janela. `innerText`
  // le o texto como ele aparece.
  // Procura no arquivo inteiro, e nao numa fatia de tamanho fixo a partir do metodo: a
  // primeira versao deste teste fatiava 1600 caracteres, e o proprio comentario que
  // explica a correcao empurrou a linha para fora da fatia. O CI pegou. Teste que depende
  // do tamanho de um comentario testa a coisa errada.
  // Recorte por MARCO, nao por tamanho: a primeira versao deste teste fatiava 1600
  // caracteres a partir do metodo, e o proprio comentario que explica a correcao empurrou
  // a linha para fora da fatia — o CI pegou. Teste que depende do tamanho de um comentario
  // esta testando a coisa errada.
  //
  // E o recorte precisa ser do bloco DO LOG: outros campos de uma linha so (numero da
  // sessao, data, nome de pista) seguem lendo `textContent` de proposito, porque neles
  // quebra de linha nao existe.
  const source = await readFile(resolve("src/ui/quest-details.js"), "utf8");
  const from = source.indexOf("activateLogHandlers(root)");
  const block = source.slice(from, source.indexOf("data-action='log-delete'", from));

  assert.match(block, /const value = \(node\.innerText/);
  assert.doesNotMatch(block, /const value = node\.textContent\.trim\(\)/, "textContent perde a quebra");
});

test("falha no envio ao caderno NAO se disfarca de sucesso", async () => {
  // Ate a 0.30.0, qualquer status diferente de "appended" — caderno apagado, pagina que
  // nao nasce — era anunciado como "Already in the players' note".
  const source = await readFile(resolve("src/ui/quest-details.js"), "utf8");
  const at = source.indexOf("pushToPlayerNotesJournal(item, written)");
  const block = source.slice(at, at + 900);

  assert.match(block, /notifyWarning/, "erro tem de chegar ao Mestre como aviso, nao como confirmacao");
  assert.match(block, /nothing-to-append/, "so o caso REAL de duplicata pode dizer 'ja esta la'");
});
