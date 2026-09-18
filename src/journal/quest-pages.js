/**
 * 1.6.0 — As Paginas de Jogador na entrada-ancora da quest.
 *
 * Minuta ratificada por Mario em 2026-09-18 (com emenda de posse). O fato que
 * sustenta tudo: a quest E um JournalEntry sem paginas — o card mora nas flags — e a
 * permissao concedida pelo dialogo de Permissions governa, de uma vez, o Quest Log do
 * jogador e a entrada na sidebar. O momento em que o Mestre concede acesso e o momento
 * em que a entrada aparece para alguem, e ela nao pode aparecer vazia.
 *
 * O kit: cinco paginas de texto com donos claros. Player-Safe (copia deliberada do
 * handout, nunca @UUID para o fasciculo), Diario da Quest (a UNICA pagina escrita
 * por codigo: o espaco de transposicao dos logs, espelho player-safe do card),
 * Registro de Eventos (sintese por sessao, Mestre/IA), Anotacoes Pessoais (dos
 * jogadores) e Resumo da Quest (nasce oculto de todos; so o encerramento o revela). Nenhuma pagina nasce vazia; nenhuma e criada na importacao — o
 * gatilho e a concessao de permissao, e a criacao e idempotente.
 *
 * Posse (emenda de 2026-09-18): o dialogo segue oferecendo os niveis do Foundry e o
 * kit reage — Observer e o padrao, e da OWNER por pagina nas Anotacoes Pessoais;
 * Owner total da entrada e opcao do Mestre, e ai os jogadores fazem o que quiserem
 * com TODAS as paginas. Nos dois modos vale a unica rede de seguranca: excluir a
 * ENTRADA (que e excluir a quest) e vetado a quem nao e GM. Pagina se apaga;
 * quest, nao.
 */

import { MODULE_ID } from "../constants.js";

export const OWNERSHIP = Object.freeze({ INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 });

/** Marcadores do bloco gerado da pagina Fatos Estabelecidos. O que o Mestre escrever
 * FORA deles e preservado em toda atualizacao. */
export const FACTS_START = "<!-- mq:facts:start -->";
export const FACTS_END = "<!-- mq:facts:end -->";

const FACTS_EMPTY = "<p><em>Nenhuma descoberta foi registrada ainda.</em></p>";

/**
 * O kit, na ordem do mock de Mario (2026-09-18). `key` vai para a flag da pagina e e
 * o que torna a criacao idempotente mesmo que a pagina seja renomeada depois.
 */
export const QUEST_PAGE_KIT = Object.freeze([
  {
    key: "player-safe",
    name: "Player-Safe",
    sort: 100000,
    birth: "<p><em>O Mestre publicará aqui o material player-safe desta quest, quando houver.</em></p>"
  },
  {
    // 1.6.1 — nomenclatura final de Mario (homologacao viva de 2026-09-18): a pagina
    // sincronizada pelo modulo e o "espaco de transposicao dos logs" e chama-se
    // Diario da Quest. A key "facts" fica: e interna e ja identifica paginas adotadas.
    key: "facts",
    name: "Diário da Quest",
    sort: 150000,
    birth: `<p><em>Espaço de transposição dos logs do MasterQuest.</em></p>${FACTS_START}${FACTS_EMPTY}${FACTS_END}`
  },
  {
    // 1.6.1 — a sintese por sessao (Mestre/IA) chama-se Registro de Eventos.
    key: "diary",
    name: "Registro de Eventos",
    sort: 175000,
    birth: "<p>A síntese do que aconteceu, sessão a sessão.</p><p><em>Aguardando a primeira sessão.</em></p>"
  },
  {
    key: "personal",
    name: "Anotações Pessoais",
    sort: 200000,
    birth: "<p><em>Use esse espaço para anotações pessoais.</em></p>"
  },
  {
    // 1.6.1 — "o unico que vai ficar sem aparecer nunca pra ninguem" (Mario,
    // 2026-09-18): nasce com permissao explicita None na PAGINA, por cima da heranca,
    // e so o encerramento o revela. O Mestre ve sempre.
    key: "summary",
    name: "Resumo da Quest",
    sort: 300000,
    ownership: { default: OWNERSHIP.NONE },
    birth: "<p><em>Este registro será escrito quando a quest for encerrada — a história completa, para ler no futuro.</em></p>"
  }
]);

/**
 * Acha a pagina do kit numa lista de paginas. Flag primeiro (sobrevive a renome);
 * nome exato depois; Player-Safe tambem casa por prefixo, porque o titulo real leva o
 * tema da quest ("Player-Safe — Esfera e Quest").
 *
 * @param {Array<object>} pages Paginas como {name, flags}.
 * @param {object} spec Um item de QUEST_PAGE_KIT.
 * @returns {object|null}
 */
export function findKitPage(pages, spec) {
  const list = Array.isArray(pages) ? pages : [];
  const byFlag = list.find((page) => page?.flags?.[MODULE_ID]?.page === spec.key);
  if (byFlag) return byFlag;
  const byName = list.find((page) => page?.name === spec.name);
  if (byName) return byName;
  if (spec.key === "player-safe") {
    return list.find((page) => typeof page?.name === "string" && page.name.startsWith("Player-Safe")) ?? null;
  }
  return null;
}

/**
 * Quem e o publico da quest, lido da ownership da ENTRADA: usuarios nao-GM com nivel
 * explicito >= OBSERVER, mais a mesa inteira quando o default alcanca OBSERVER.
 *
 * @param {object} ownership O campo ownership da entrada.
 * @param {Array<object>} users `game.users` como {id, isGM}.
 * @returns {{userIds: string[], defaultGranted: boolean}}
 */
export function grantedAudience(ownership = {}, users = []) {
  const defaultGranted = Number(ownership.default) >= OWNERSHIP.OBSERVER;
  const userIds = (Array.isArray(users) ? users : [])
    .filter((user) => user && user.isGM !== true)
    .filter((user) => Number(ownership[user.id]) >= OWNERSHIP.OBSERVER)
    .map((user) => user.id);
  return { userIds, defaultGranted };
}

/**
 * A posse da pagina Anotacoes Pessoais (emenda de 2026-09-18): o publico vira OWNER
 * DA PAGINA, aditivamente — ninguem e rebaixado, e o resto herda da entrada.
 *
 * @param {object} current Ownership atual da pagina.
 * @param {{userIds: string[], defaultGranted: boolean}} audience De `grantedAudience`.
 * @returns {object} Ownership nova da pagina.
 */
export function personalPageOwnership(current = {}, { userIds = [], defaultGranted = false } = {}) {
  const next = { ...current };
  if (defaultGranted && Number(next.default ?? OWNERSHIP.INHERIT) < OWNERSHIP.OWNER) {
    next.default = OWNERSHIP.OWNER;
  }
  for (const id of userIds) {
    if (Number(next[id] ?? OWNERSHIP.NONE) < OWNERSHIP.OWNER) next[id] = OWNERSHIP.OWNER;
  }
  return next;
}

/**
 * A unica rede de seguranca da posse: entrada que carrega quest so o Mestre exclui.
 * Pagina se apaga (direito de Owner); a quest, nao.
 *
 * @param {object} entry O JournalEntry.
 * @param {{isGM: boolean}} actor Quem tenta.
 * @returns {boolean} true quando a exclusao deve ser vetada.
 */
export function shouldBlockEntryDeletion(entry, { isGM = false } = {}) {
  return Boolean(entry?.flags?.[MODULE_ID]?.quest) && isGM !== true;
}

/**
 * O espelho player-safe do card — o bloco gerado da pagina Fatos Estabelecidos.
 * O filtro e o da minuta, secao 2: objetivos nao ocultos com estado; clues found+known;
 * rewards granted+known; outcomes occurred+known. Dilemas e complications NUNCA.
 * O card segue a fonte de verdade; isto e espelho, nao segunda fonte.
 *
 * @param {object} quest A quest normalizada.
 * @returns {string} HTML do bloco (sem os marcadores).
 */
export function buildEstablishedFacts(quest = {}) {
  const arr = (value) => (Array.isArray(value) ? value : []);
  const sections = [];

  const objectives = arr(quest.objectives).filter((o) => o && o.hidden !== true);
  if (objectives.length) {
    const items = objectives.map((o) => {
      const state = o.completed ? "concluído" : o.failed ? "falhou" : "em aberto";
      return `<li>${o.name} — <em>${state}</em></li>`;
    });
    sections.push(`<h3>Objetivos</h3><ul>${items.join("")}</ul>`);
  }

  const clues = arr(quest.clues).filter((c) => c && c.hidden !== true && c.found === true && c.known === true);
  if (clues.length) {
    sections.push(`<h3>Pistas</h3><ul>${clues.map((c) => `<li>${c.name}</li>`).join("")}</ul>`);
  }

  const rewards = arr(quest.rewards).filter((r) => r && r.hidden !== true && r.granted === true && r.known === true);
  if (rewards.length) {
    sections.push(`<h3>Recompensas</h3><ul>${rewards.map((r) => `<li>${r.name}</li>`).join("")}</ul>`);
  }

  const outcomes = arr(quest.outcomes).filter((o) => o && o.hidden !== true && o.occurred === true && o.known === true);
  if (outcomes.length) {
    sections.push(`<h3>Desfechos</h3><ul>${outcomes.map((o) => `<li>${o.name}</li>`).join("")}</ul>`);
  }

  return sections.length ? sections.join("") : FACTS_EMPTY;
}

/**
 * Poe o bloco gerado no lugar certo do conteudo da pagina, preservando o que o Mestre
 * escreveu fora dos marcadores. Sem marcadores, o bloco e acrescentado ao fim, ja
 * demarcado — a proxima atualizacao encontra o lugar.
 *
 * @param {string} content Conteudo atual da pagina.
 * @param {string} factsHtml De `buildEstablishedFacts`.
 * @returns {string} Conteudo novo.
 */
export function mergeFactsIntoContent(content, factsHtml) {
  const block = `${FACTS_START}${factsHtml}${FACTS_END}`;
  const text = typeof content === "string" ? content : "";
  const start = text.indexOf(FACTS_START);
  const end = text.indexOf(FACTS_END);
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(0, start) + block + text.slice(end + FACTS_END.length);
  }
  return text ? `${text}${block}` : block;
}

/* ================================================================== Foundry glue == */

/**
 * Cria as paginas que faltam e adota as que ja existem (ganham a flag do kit), sem
 * duplicar nem sobrescrever nada. Depois aplica a posse padrao: o publico da quest
 * vira OWNER da pagina Anotacoes Pessoais. Idempotente por construcao.
 *
 * @param {object} entry O JournalEntry da quest.
 * @param {object} [options]
 * @param {object} [options.game] O objeto game do Foundry.
 * @returns {Promise<{created: string[], adopted: string[]}>}
 */
export async function ensureQuestPagesKit(entry, { game = globalThis.game } = {}) {
  if (!entry) return { created: [], adopted: [] };
  const pages = entry.pages?.contents ?? entry.pages ?? [];
  const created = [];
  const adopted = [];
  const toCreate = [];

  for (const spec of QUEST_PAGE_KIT) {
    const existing = findKitPage(pages, spec);
    if (existing) {
      if (existing.flags?.[MODULE_ID]?.page !== spec.key && typeof existing.update === "function") {
        await existing.update({ [`flags.${MODULE_ID}.page`]: spec.key });
        adopted.push(existing.name);
      }
      continue;
    }
    toCreate.push({
      name: spec.name,
      type: "text",
      sort: spec.sort,
      title: { show: true, level: 1 },
      text: { format: 1, content: spec.birth },
      flags: { [MODULE_ID]: { page: spec.key } },
      ...(spec.ownership ? { ownership: { ...spec.ownership } } : {})
    });
    created.push(spec.name);
  }

  if (toCreate.length && typeof entry.createEmbeddedDocuments === "function") {
    await entry.createEmbeddedDocuments("JournalEntryPage", toCreate);
  }

  await applyPersonalOwnership(entry, { game });
  return { created, adopted };
}

/** Da ao publico da quest a posse da pagina Anotacoes Pessoais (aditivo, nunca rebaixa). */
export async function applyPersonalOwnership(entry, { game = globalThis.game } = {}) {
  const pages = entry?.pages?.contents ?? entry?.pages ?? [];
  const spec = QUEST_PAGE_KIT.find((page) => page.key === "personal");
  const personal = findKitPage(pages, spec);
  if (!personal || typeof personal.update !== "function") return false;

  const audience = grantedAudience(entry.ownership ?? {}, game?.users?.contents ?? game?.users ?? []);
  if (!audience.defaultGranted && audience.userIds.length === 0) return false;

  const next = personalPageOwnership(personal.ownership ?? {}, audience);
  const current = personal.ownership ?? {};
  const changed = Object.keys(next).some((key) => next[key] !== current[key]);
  if (!changed) return false;

  await personal.update({ ownership: next });
  return true;
}

/**
 * Atualiza a pagina Fatos Estabelecidos a partir do card. Garante o kit antes, entao
 * funciona mesmo na primeira vez.
 *
 * @param {object} quest A quest (com `entry`).
 * @param {object} [options]
 * @param {object} [options.game] O objeto game do Foundry.
 * @returns {Promise<{status: string}>}
 */
export async function syncEstablishedFacts(quest, { game = globalThis.game } = {}) {
  const entry = quest?.entry;
  if (!entry) return { status: "missing-entry" };

  await ensureQuestPagesKit(entry, { game });
  const pages = entry.pages?.contents ?? entry.pages ?? [];
  const spec = QUEST_PAGE_KIT.find((page) => page.key === "facts");
  const facts = findKitPage(pages, spec);
  if (!facts || typeof facts.update !== "function") return { status: "missing-page" };

  const content = mergeFactsIntoContent(facts.text?.content ?? "", buildEstablishedFacts(quest));
  await facts.update({ "text.content": content });
  return { status: "updated" };
}

/**
 * Os ganchos de mundo desta feature. Chamado uma vez, no init.
 *
 * 1. Veto de exclusao: entrada com quest so o Mestre exclui — nos dois modos de posse.
 * 2. Concessao de permissao: quando a ownership de uma entrada-quest muda e passa a
 *    alcancar algum jogador, o Mestre ativo e convidado a criar o kit (so quando ha
 *    pagina faltando; nada e criado em silencio, nada duplica).
 */
export function registerQuestPagesHooks({ game = globalThis.game, HooksBus = globalThis.Hooks } = {}) {
  if (!HooksBus?.on) return;

  HooksBus.on("preDeleteJournalEntry", (entry) => {
    if (shouldBlockEntryDeletion(entry, { isGM: game?.user?.isGM === true })) {
      globalThis.ui?.notifications?.warn?.(
        "Esta entrada carrega uma quest do MasterQuest: paginas podem ser apagadas, a entrada nao. Fale com o Mestre."
      );
      return false;
    }
    return undefined;
  });

  HooksBus.on("updateJournalEntry", async (entry, changes) => {
    if (!changes || !("ownership" in changes)) return;
    if (!entry?.flags?.[MODULE_ID]?.quest) return;
    const activeGM = game?.users?.activeGM ?? null;
    if (game?.user?.isGM !== true) return;
    if (activeGM && activeGM.id !== game.user.id) return;

    const audience = grantedAudience(entry.ownership ?? {}, game?.users?.contents ?? game?.users ?? []);
    if (!audience.defaultGranted && audience.userIds.length === 0) return;

    const pages = entry.pages?.contents ?? entry.pages ?? [];
    const missing = QUEST_PAGE_KIT.filter((spec) => !findKitPage(pages, spec));
    if (!missing.length) {
      await applyPersonalOwnership(entry, { game });
      return;
    }

    const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
    const create = DialogV2?.confirm
      ? await DialogV2.confirm({
        window: { title: "Paginas do jogador" },
        content: `<p>Criar as páginas do jogador de <strong>${entry.name}</strong>? (Player-Safe, Fatos Estabelecidos, Diário, Anotações Pessoais, Resumo)</p>`,
        rejectClose: false,
        modal: true
      })
      : true;
    if (create) await ensureQuestPagesKit(entry, { game });
  });
}
