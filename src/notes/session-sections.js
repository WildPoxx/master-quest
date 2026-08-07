/**
 * A moldura de secao das notas: cada sessao vira um bloco proprio, com cabecalho e regua.
 *
 * Origem: Mario deixou no mundo, a mao, o exemplo que virou especificacao — recolhido pelo
 * Quest Devs no handoff de 2026-08-07 (Pedido 3) e cobrado por ele no teste de mesa da
 * 0.27.0: *"ela nao ta com abertura de cabecalho de H4, como ta, por exemplo, na
 * organizacao do log. (...) ela ja deveria entrar assim, da mesma forma que ta no log."*
 *
 * A forma, tal como Mario a escreveu:
 *
 * ```html
 * <h4>Session 5: Um Novo Dilema</h4>
 * <hr>
 * <p>...linhas empurradas do Log...</p>
 * ```
 *
 * A sessao e o DIVISOR DE SECOES do registro, dos dois lados — GM Notes e Player Notes.
 * Nao e rotulo decorativo: e a estrutura do caderno.
 *
 * Este modulo e puro de proposito: nao toca no Foundry, nao le documento, nao grava nada.
 * So sabe pegar um HTML e devolver outro com a linha no lugar certo — e por isso se testa
 * inteiro fora do Foundry.
 */

/**
 * O cabecalho de uma sessao, no formato que Mario fixou: rotulo estrutural em ingles
 * (DEC-027), conteudo da campanha em portugues.
 *
 * @param {object|null} session A sessao, ou null para o bloco anterior a qualquer sessao.
 * @returns {string} O texto do cabecalho, sem marcacao.
 */
export function sectionHeading(session) {
  if (!session || session.number == null) return "Before session records";
  const title = String(session.title ?? "").trim();
  return title ? `Session ${session.number}: ${title}` : `Session ${session.number}`;
}

/** Escapa o que vai virar texto de cabecalho — o subtitulo e escrito pelo Mestre. */
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Onde termina a secao que comeca em `start`: no proximo `<h4>` ou no fim do texto.
 *
 * Procura por `<h4` e nao por `</h4>` porque o que delimita a proxima secao e a ABERTURA
 * dela. Tolerante a atributos (`<h4 class="...">`), que e o que o ProseMirror devolve
 * depois de o Mestre editar o campo a mao.
 */
function sectionEnd(html, start) {
  const next = html.slice(start).search(/<h4[\s>]/i);
  return next === -1 ? html.length : start + next;
}

/**
 * Acrescenta uma linha ao HTML de um campo de notas, dentro da secao da sessao dada —
 * criando a secao se ela ainda nao existir.
 *
 * Duas garantias que valem escrever, porque sao o que impede este gesto de virar
 * sincronizacao automatica (que a DEC-032 recusa) ou de destruir texto do Mestre:
 *
 * 1. **Nunca reescreve o que ja esta la.** A linha entra no fim da secao correspondente;
 *    tudo o que o Mestre escreveu antes permanece byte a byte, inclusive dentro da mesma
 *    secao.
 * 2. **Secao nova nasce no FIM do campo.** Nao ha reordenacao: o caderno cresce na ordem
 *    em que o Mestre empurrou as coisas, e nao numa ordem que o modulo julgue melhor.
 *
 * @param {string} html O conteudo atual do campo.
 * @param {object} [options]
 * @param {object|null} [options.session] A sessao dona da linha.
 * @param {string} [options.line] O HTML ja pronto da linha (sem o `<p>`).
 * @returns {string} O conteudo novo.
 */
export function appendUnderSection(html, { session = null, line = "" } = {}) {
  const current = String(html ?? "");
  const paragraph = `<p>${line}</p>`;
  const heading = sectionHeading(session);

  // Casa o cabecalho pelo TEXTO, nao pela marcacao: depois de o Mestre editar o campo no
  // ProseMirror, o `<h4>` volta com atributos e espacos que nao estavam aqui quando o
  // modulo o escreveu.
  const pattern = new RegExp(`<h4[^>]*>\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</h4>`, "i");
  const found = current.match(pattern);

  if (found?.index !== undefined) {
    const start = found.index + found[0].length;
    const end = sectionEnd(current, start);
    return `${current.slice(0, end)}${paragraph}${current.slice(end)}`;
  }

  return `${current}<h4>${esc(heading)}</h4><hr>${paragraph}`;
}
