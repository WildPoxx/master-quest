/**
 * MasterQuest quest schema.
 *
 * Stored on a JournalEntry as `flags["master-quest"].quest`. The quest id is the
 * JournalEntry id, so it is never duplicated inside the payload.
 *
 * The shape deliberately mirrors the concepts of Forien's Quest Log so that an FQL
 * snapshot can be imported field by field, but the names follow MasterQuest:
 * `objectives` instead of `tasks`, `id` instead of `uuidv4`.
 */

/**
 * 1 -> 2 (0.19.0, DEC-028): `gmcomments` nasce ao lado de `gmnotes`. Sem migracao: quest
 * gravada pela 0.18.0 sobe intacta e apenas ganha um campo vazio.
 */
export const QUEST_SCHEMA_VERSION = 2;

export const QUEST_STATUS = Object.freeze({
  available: "available",
  active: "active",
  completed: "completed",
  failed: "failed",
  inactive: "inactive"
});

/** Tab order of the Quest Log. `inactive` is GM-only. */
export const QUEST_STATUS_ORDER = Object.freeze([
  QUEST_STATUS.available,
  QUEST_STATUS.active,
  QUEST_STATUS.completed,
  QUEST_STATUS.failed,
  QUEST_STATUS.inactive
]);

export const QUEST_STATUS_LABEL = Object.freeze({
  inactive: "Inactive",
  available: "Available",
  active: "In Progress",
  completed: "Completed",
  failed: "Failed"
});

export const GM_ONLY_STATUS = Object.freeze([QUEST_STATUS.inactive]);

export const REWARD_TYPE = Object.freeze({
  abstract: "abstract",
  item: "item"
});

/**
 * Gradacao unica de severidade (Mario, 2026-08-06): dilemas e complicacoes compartilham
 * a escada leve/grave/severa. Vocabulario de CAMPANHA fixado pela Arquitetura de Tabelas
 * Q1 §1.6 — fica em portugues; DEC-027 nao o alcanca.
 */
export const SEVERITIES = Object.freeze(["leve", "grave", "severa"]);

export const SPLASH_POSITIONS = Object.freeze(["top", "center", "bottom"]);

/**
 * Quest kinds carried by `type`.
 *
 * `clock` is not a quest the party pursues: it is GM-side pressure whose objectives are
 * the steps of a track. Keeping it in the same store means one hierarchy, one importer
 * and one snapshot instead of a parallel system.
 */
export const QUEST_TYPE = Object.freeze({
  main: "main",
  subquest: "subquest",
  side: "side",
  personal: "personal",
  faction: "faction",
  clock: "clock"
});

/**
 * Normalize an arbitrary object into a valid quest payload. Never throws: unknown
 * input degrades to a usable empty quest, because a corrupt flag must not break the log.
 *
 * @param {object} [input] Raw flag data.
 * @returns {object} A normalized quest payload.
 */
export function normalizeQuest(input = {}) {
  const data = isRecord(input) ? input : {};

  return {
    schemaVersion: QUEST_SCHEMA_VERSION,
    name: text(data.name) || "Nova Quest",
    status: QUEST_STATUS[data.status] ? data.status : QUEST_STATUS.inactive,
    giver: data.giver === null || data.giver === undefined ? null : text(data.giver) || null,
    giverData: isRecord(data.giverData) ? { ...data.giverData } : null,
    giverName: text(data.giverName),
    image: data.image === "token" ? "token" : "actor",
    description: html(data.description),
    // DEC-028. `gmnotes` e o GM Panel: FONTE, vem do fasciculo, e reimportar blueprint o
    // sobrescreve. `gmcomments` e o GM Notes: mesa, livre, e a importacao nunca escreve
    // nele. O campo novo ser o de mesa e o que dispensa migracao — nada se move.
    gmnotes: html(data.gmnotes),
    gmcomments: html(data.gmcomments),
    playernotes: html(data.playernotes),
    splash: text(data.splash),
    splashPos: SPLASH_POSITIONS.includes(data.splashPos) ? data.splashPos : "center",
    splashAsIcon: data.splashAsIcon === true,
    location: data.location == null ? null : text(data.location) || null,
    priority: Number.isFinite(Number(data.priority)) ? Number(data.priority) : 0,
    type: data.type == null ? null : text(data.type) || null,
    parent: data.parent == null ? null : text(data.parent) || null,
    subquests: uniqueStrings(data.subquests),
    // Stable authoring id (e.g. "MQ-ATO1-01"). The JournalEntry id is assigned by Foundry
    // and differs per world; the designId is what a blueprint can be re-imported against.
    designId: text(data.designId) || null,
    // Narrative events that make this quest available or active. Descriptive: MasterQuest
    // does not fire them automatically, it shows the GM what is waiting on what.
    activationTriggers: toArray(data.activationTriggers).map(normalizeTrigger).filter((t) => t.label !== ""),
    // Journal entries this quest leans on, by name. Resolved at import time; a missing
    // target is reported, never silently dropped.
    journalLinks: toArray(data.journalLinks).map(normalizeJournalLink).filter((l) => l.name !== ""),
    objectives: toArray(data.objectives).map(normalizeObjective).filter((o) => o.name !== ""),
    rewards: toArray(data.rewards).map(normalizeReward),
    // DEC-035: Problema nao se cumpre — resolve-se, e toda saida tem preco. Complicacao
    // nao se resolve — incide. Irmas de objectives/rewards; antes disto viviam como
    // tabelas de HTML no gmnotes, frageis por construcao (ProseMirror, 2026-08-04).
    // Ordem canonica da Details (Mario, 2026-08-06): Dilemmas -> Objectives -> Clues ->
    // Rewards -> Complications -> Outcomes. O dilema vem PRIMEIRO porque define o tom da
    // quest — o subtexto moral que tudo o mais responde. Pista aponta o caminho;
    // recompensa fica com a mesa; complicacao incide; outcome registra como pode
    // terminar. Outcome NAO e recompensa: posse e registro sao categorias diferentes.
    clues: toArray(data.clues).map(normalizeClue).filter((x) => x.name !== ""),
    dilemmas: toArray(data.dilemmas ?? data.problems).map(normalizeDilemma).filter((x) => x.name !== ""),
    complications: toArray(data.complications).map(normalizeComplication).filter((x) => x.name !== ""),
    outcomes: toArray(data.outcomes).map(normalizeOutcome).filter((x) => x.name !== ""),
    // DEC-032, revista em 0.23: escrito pelo modulo a cada mudanca de FICCAO (nao de
    // gerenciamento) — e integralmente editavel pelo Mestre: linhas podem ganhar razao,
    // ser corrigidas, apagadas ou incluidas a mao. Registro de campanha, nao auditoria.
    log: toArray(data.log).map(normalizeLogEntry),
    // 0.23: sessoes de jogo registradas nesta quest. A corrente e a de maior numero.
    sessions: dedupeSessions(toArray(data.sessions).map(normalizeSession)),
    // 0.23: encerramento editorial (Wrap Up). Reversivel — flag da mesa, nada dispara.
    // Nao confundir com `status: completed`: status e a ficcao; wrappedUp e o gesto de
    // fechar o caderno e emitir o relatorio consolidado.
    wrappedUp: data.wrappedUp === true,
    date: normalizeDate(data.date),
    source: text(data.source) || "master-quest"
  };
}

/**
 * @param {object} [input] Raw objective data.
 * @returns {object} A normalized objective.
 */
/**
 * @param {object|string} [input] Raw trigger data or a plain label.
 * @returns {object} A normalized activation trigger.
 */
export function normalizeTrigger(input = {}) {
  if (typeof input === "string") return { label: input.trim(), grantsStatus: null, fired: false };
  const data = isRecord(input) ? input : {};
  const grants = QUEST_STATUS[data.grantsStatus] ? data.grantsStatus : null;

  return {
    label: text(data.label),
    grantsStatus: grants,
    fired: data.fired === true
  };
}

/**
 * @param {object|string} [input] Raw link data or a plain JournalEntry name.
 * @returns {object} A normalized journal link.
 */
export function normalizeJournalLink(input = {}) {
  if (typeof input === "string") return { name: input.trim(), uuid: null, page: null };
  const data = isRecord(input) ? input : {};

  return {
    name: text(data.name),
    uuid: text(data.uuid) || null,
    page: text(data.page) || null
  };
}

export function normalizeObjective(input = {}) {
  const data = isRecord(input) ? input : {};
  const completed = data.completed === true;
  const failed = data.failed === true;

  return {
    id: text(data.id) || makeId(),
    name: text(data.name),
    // An objective cannot be both completed and failed; completion wins.
    completed,
    failed: completed ? false : failed,
    // DEC-006 + DEC-031: objetivo nasce OCULTO. Revelar sem contexto narrativo e spoiler;
    // o primeiro contato do Mestre com a quest transposta e uma triagem manual, item a
    // item. Dado ja gravado traz a chave e nao muda de valor — nao ha migracao retroativa.
    hidden: data.hidden !== false,
    // DEC-035, eixo D (diegetico): o PC sabe, NA FICCAO, que isto existe? Independente do
    // eixo P (`hidden`, o painel). "Sabe mas nao ve" e legitimo e frequente; "nao sabe mas
    // ve" e spoiler do painel — a UI sinaliza essa combinacao, nunca esta.
    known: data.known === true
  };
}

/**
 * @param {object} [input] Raw reward data.
 * @returns {object} A normalized reward.
 */
export function normalizeReward(input = {}) {
  const data = isRecord(input) ? input : {};
  const type = data.type === REWARD_TYPE.item ? REWARD_TYPE.item : REWARD_TYPE.abstract;

  return {
    id: text(data.id) || makeId(),
    type,
    name: text(data.name) || text(data.data?.name),
    img: text(data.img) || text(data.data?.img),
    uuid: text(data.uuid) || text(data.data?.uuid) || null,
    // DEC-031: recompensa nasce OCULTA, pela mesma razao do objetivo.
    hidden: data.hidden !== false,
    // DEC-031: os PCs conquistaram isto. NAO dispara nada — o MasterQuest registra, nao
    // executa: nenhuma ficha e tocada, nenhum item e criado. Serve ao relatorio de saida.
    granted: data.granted === true,
    // DEC-035, eixo D — ver normalizeObjective. Quando `tier` (Ramo B) existir, recompensa
    // de metajogo deixa de exibir este eixo: ninguem "sabe na ficcao" de um Feito.
    known: data.known === true,
    // DEPRECADO pela DEC-031. O `locked` do FQL era gambiarra: destravar era o unico jeito
    // de dizer a macro de relatorio que os PCs tinham recebido a recompensa. Agora existe
    // `granted` para isso. Segue sendo LIDO e propagado para nao quebrar snapshot nem
    // consumidor legado; nada na interface o escreve. Sai do schema numa versao futura.
    locked: data.locked === undefined ? true : data.locked === true,
    data: isRecord(data.data) ? { ...data.data } : {}
  };
}

/**
 * DEC-035, renomeada por Mario em 2026-08-05: a regua de admissao (nenhuma saida neutra,
 * toda saida custa) define um DILEMA, nao um problema generico. E a pergunta que a quest
 * poe — de design, estrutural, rara. `state` e binario e nao e checkbox: a saida e um
 * TEXTO (`resolution`), nunca um ganho limpo. `table` aponta a Tabela de Desfecho.
 *
 * @param {object} [input] Raw dilemma data.
 * @returns {object} A normalized dilemma.
 */
export function normalizeDilemma(input = {}) {
  const data = isRecord(input) ? input : {};
  return {
    id: text(data.id) || makeId(),
    name: text(data.name),
    state: data.state === "resolved" ? "resolved" : "open",
    // Gradacao (Mario, 2026-08-06): quanto pesa a pergunta. Autoral — vem da fonte.
    severity: SEVERITIES.includes(data.severity) ? data.severity : "leve",
    // O que de fato aconteceu quando resolveu. Da mesa, escrito pelo Mestre.
    resolution: text(data.resolution ?? data.outcome),
    // Ponteiro descritivo para a Tabela de Desfecho (nome ou @UUID). Da fonte.
    table: text(data.table),
    hidden: data.hidden !== false,
    known: data.known === true
  };
}

/**
 * Pista (Mario, 2026-08-05): informacao que aponta o caminho — gancho que leva a
 * objetivo ou recompensa. Nao e posse. `found` registra que a mesa a obteve.
 * Desenhada para a futura DEC das Descobertas ESTENDER (metodo, custo, camadas),
 * nao substituir.
 *
 * @param {object} [input] Raw clue data.
 * @returns {object} A normalized clue.
 */
export function normalizeClue(input = {}) {
  const data = isRecord(input) ? input : {};
  return {
    id: text(data.id) || makeId(),
    name: text(data.name),
    found: data.found === true,
    hidden: data.hidden !== false,
    known: data.known === true
  };
}

/**
 * Outcome (Mario, 2026-08-05): como a quest PODE terminar, e como terminou. Nao e
 * recompensa — posse e registro sao categorias diferentes. Secao final da Details.
 * `occurred` marca que aconteceu em ficcao; `record` guarda o que de fato se deu.
 *
 * @param {object} [input] Raw outcome data.
 * @returns {object} A normalized outcome.
 */
export function normalizeOutcome(input = {}) {
  const data = isRecord(input) ? input : {};
  return {
    id: text(data.id) || makeId(),
    name: text(data.name),
    occurred: data.occurred === true,
    record: text(data.record),
    table: text(data.table),
    hidden: data.hidden !== false,
    known: data.known === true
  };
}

/**
 * DEC-032. Uma linha do Log: alvo · mudanca · razao. `at` e epoch ms; `reason` nasce
 * vazia e VISIVELMENTE pendente — exigir o motivo no clique quebraria o gesto unico da
 * DEC-031, entao o modulo grava o fato e cobra o sentido depois.
 *
 * @param {object} [input] Raw log entry.
 * @returns {object} A normalized log entry.
 */
export function normalizeLogEntry(input = {}) {
  const data = isRecord(input) ? input : {};
  return {
    id: text(data.id) || makeId(),
    at: Number.isFinite(Number(data.at)) ? Number(data.at) : 0,
    target: text(data.target),
    targetType: text(data.targetType),
    change: text(data.change),
    reason: text(data.reason),
    // 0.23 (Mario, 2026-08-06): o Log agrupa por sessao de jogo, nao por dia do relogio.
    // `session` carimba o numero da sessao corrente no momento do registro; entradas
    // antigas (sem carimbo) caem no grupo "before session records".
    session: Number.isFinite(Number(data.session)) && data.session !== null && data.session !== "" ? Number(data.session) : null,
    // "auto" = escrito pelo diff central no commit(); "manual" = o Mestre incluiu a linha
    // a mao. O Log e do Mestre — registro de ficcao, nao trilha de auditoria: toda linha
    // pode ser editada ou apagada, e a origem so distingue quem a escreveu primeiro.
    origin: data.origin === "manual" ? "manual" : "auto"
  };
}

/**
 * 0.23 (Mario, 2026-08-06): sessao de jogo — numero, data e subtitulo. Vive na quest
 * (`sessions[]`) e da o cabecalho dos grupos do Log. `number` e a chave que o carimbo
 * `log[].session` referencia. Estrutura minima de proposito: sessao aqui e MARCADOR DE
 * TEMPO DE MESA, nao agenda — o fvtt-campaign-builder ja faz agenda; o MasterQuest
 * registra em qual sessao a ficcao mudou.
 *
 * @param {object} [input] Raw session data.
 * @returns {object} A normalized session.
 */
export function normalizeSession(input = {}) {
  const data = isRecord(input) ? input : {};
  const number = Number.isFinite(Number(data.number)) && data.number !== null && data.number !== "" ? Number(data.number) : 1;
  return {
    number: Math.max(1, Math.trunc(number)),
    date: text(data.date),
    title: text(data.title)
  };
}

/**
 * DEC-035. `severity` usa o vocabulario ja fixado pela Arquitetura de Tabelas Q1 §1.6
 * (leve/grave/severa) — vocabulario de CAMPANHA, nao rotulo de UI; DEC-027 nao o alcanca.
 * `fired` segue a semantica de `normalizeTrigger`: registro, nunca disparo.
 *
 * @param {object} [input] Raw complication data.
 * @returns {object} A normalized complication.
 */
export const COMPLICATION_SEVERITIES = SEVERITIES;

export function normalizeComplication(input = {}) {
  const data = isRecord(input) ? input : {};
  return {
    id: text(data.id) || makeId(),
    name: text(data.name),
    trigger: text(data.trigger),
    severity: SEVERITIES.includes(data.severity) ? data.severity : "leve",
    fired: data.fired === true,
    hidden: data.hidden !== false,
    known: data.known === true
  };
}

/** Sessions keyed by `number`: a duplicate number keeps the LAST occurrence (an edit). */
function dedupeSessions(sessions) {
  const byNumber = new Map();
  for (const s of sessions) byNumber.set(s.number, s);
  return Array.from(byNumber.values()).sort((a, b) => a.number - b.number);
}

/**
 * The current session is simply the highest-numbered one, or null before any is opened.
 *
 * @param {object} quest A normalized quest.
 * @returns {object|null} The current session.
 */
export function currentSession(quest) {
  const sessions = toArray(quest?.sessions);
  if (!sessions.length) return null;
  return sessions.reduce((top, s) => (s.number > (top?.number ?? -Infinity) ? s : top), null);
}

function normalizeDate(input) {
  const data = isRecord(input) ? input : {};
  return {
    create: numberOrNull(data.create),
    start: numberOrNull(data.start),
    end: numberOrNull(data.end)
  };
}

/**
 * Apply the date bookkeeping implied by a status transition.
 *
 * @param {object} quest A normalized quest.
 * @param {string} status The target status.
 * @param {number} [now] Timestamp to stamp with.
 * @returns {object} A new quest with `status` and `date` updated.
 */
export function withStatus(quest, status, now = Date.now()) {
  const target = QUEST_STATUS[status] ? status : QUEST_STATUS.inactive;
  const date = { ...normalizeDate(quest?.date) };

  switch (target) {
    case QUEST_STATUS.active:
      date.start = now;
      date.end = null;
      break;
    case QUEST_STATUS.completed:
    case QUEST_STATUS.failed:
      if (date.start === null) date.start = now;
      date.end = now;
      break;
    case QUEST_STATUS.available:
    case QUEST_STATUS.inactive:
      date.start = null;
      date.end = null;
      break;
  }

  return { ...quest, status: target, date };
}

/**
 * Count objectives for the log badge.
 *
 * @param {object} quest A normalized quest.
 * @param {object} [options]
 * @param {boolean} [options.countHidden] Include hidden objectives in the totals.
 * @returns {{done: number, total: number, failed: number}} Objective counts.
 */
export function countObjectives(quest, { countHidden = true } = {}) {
  const objectives = toArray(quest?.objectives).filter((o) => countHidden || !o.hidden);
  return {
    done: objectives.filter((o) => o.completed).length,
    failed: objectives.filter((o) => o.failed).length,
    total: objectives.length
  };
}

/**
 * Move an entry inside a list, addressed by id. Returns a new array.
 *
 * @param {Array<{id: string}>} list The list to reorder.
 * @param {string} sourceId Id of the entry being moved.
 * @param {string|null} targetId Id to insert before; null appends at the end.
 * @returns {Array} A reordered copy.
 */
export function reorderById(list, sourceId, targetId) {
  const items = toArray(list).slice();
  const from = items.findIndex((item) => item?.id === sourceId);
  if (from < 0) return items;

  const [moved] = items.splice(from, 1);
  if (targetId === null || targetId === undefined) {
    items.push(moved);
    return items;
  }

  const to = items.findIndex((item) => item?.id === targetId);
  if (to < 0) items.push(moved);
  else items.splice(to, 0, moved);
  return items;
}

/** @returns {string} A random 12-character id. */
export function makeId() {
  const bytes = new Uint8Array(9);
  const crypto = globalThis.crypto;
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return value == null ? "" : String(value).trim();
}

function html(value) {
  return value == null ? "" : String(value);
}

function numberOrNull(value) {
  return Number.isFinite(Number(value)) && value !== null ? Number(value) : null;
}

function uniqueStrings(value) {
  return Array.from(new Set(toArray(value).map(text).filter(Boolean)));
}
