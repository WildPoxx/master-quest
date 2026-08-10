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

/** O texto puro de um trecho de HTML, normalizado para comparacao. */
function plainText(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

/**
 * A secao daquele cabecalho ja contem esta linha?
 *
 * Procura DENTRO da secao, nao no campo inteiro: a mesma frase pode legitimamente
 * aparecer em duas sessoes diferentes — "a porta se abre" na 2 e na 5 sao dois fatos.
 */
function sectionHasLine(html, heading, line) {
  const pattern = new RegExp(`<h4[^>]*>\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</h4>`, "i");
  const found = html.match(pattern);
  if (found?.index === undefined) return false;

  const start = found.index + found[0].length;
  const section = html.slice(start, sectionEnd(html, start));
  const target = plainText(line);

  return [...section.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].some(
    (match) => plainText(match[1]) === target
  );
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

  // 0.30: a MESMA linha nao entra duas vezes. Ate a 0.29 o campo nao tinha defesa nenhuma
  // — e a pagina de Journal tinha uma que nao funcionava, porque dependia de um comentario
  // HTML que o Foundry apaga. Comparar texto visivel nao depende de nada invisivel.
  // Limite honesto: linha EDITADA pelo Mestre deixa de ser identica e um push novo entra.
  if (plainText(line) && sectionHasLine(current, heading, line)) return current;

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
