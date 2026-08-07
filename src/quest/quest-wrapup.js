/**
 * DEC-043: o gesto de encerrar o caderno, como transformacao PURA.
 *
 * Mora aqui, e nao dentro do handler de clique, pela mesma razao que `diffQuestForLog`
 * (DEC-032) mora em arquivo proprio: a regra tem um lugar so, e pode ser testada fora do
 * Foundry. O handler chama; a decisao sobre o que muda esta escrita neste arquivo.
 *
 * O que a DEC-043 decidiu (Mario, 2026-08-07), emendando a DEC-039:
 *
 *   fechar    Wrap Up sela TODAS as sessoes da quest, sem perguntar. Fechar o caderno ja
 *             e o gesto deliberado; pedir um segundo gesto seria cerimonia.
 *   reabrir   NAO desselar. Nao e decisao de Mario, e sim o que a DEC-039 obriga: ela
 *             proibiu desselar em massa ("destravar e sessao a sessao, porque o gesto de
 *             proteger foi deliberado"). Derivacao declarada e revisavel.
 *
 * O selo continua sendo o que a DEC-039 fixou: protecao contra o gesto EM MASSA (Clear log
 * total e limpeza de grupo), nunca contra a mao do Mestre. Em sessao selada, apagar linha
 * pela lixeira e editar alvo, mudanca ou razao seguem livres.
 */

/**
 * Alterna o encerramento editorial de uma quest.
 *
 * @param {object} quest A quest (ou o rascunho em edicao).
 * @returns {object} Uma quest nova. A original nao e modificada.
 */
export function toggleWrapUp(quest) {
  if (!quest) return quest;

  const closing = quest.wrappedUp !== true;
  const sessions = Array.isArray(quest.sessions) ? quest.sessions : [];

  return {
    ...quest,
    wrappedUp: closing,
    // Reabrir preserva os selos exatamente como estao — inclusive os que o Mestre pos a
    // mao antes do Wrap Up, que nunca foram deste gesto para desfazer.
    sessions: closing ? sessions.map((session) => ({ ...session, sealed: true })) : sessions
  };
}

/**
 * Quantas sessoes este gesto selaria agora. Leitura pura, para a interface poder dizer o
 * que vai acontecer antes de acontecer.
 *
 * @param {object} quest A quest.
 * @returns {number} O numero de sessoes ainda nao seladas, ou 0 ao reabrir.
 */
export function sessionsToSeal(quest) {
  if (!quest || quest.wrappedUp === true) return 0;
  const sessions = Array.isArray(quest.sessions) ? quest.sessions : [];
  return sessions.filter((session) => session?.sealed !== true).length;
}
