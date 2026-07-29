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

export const QUEST_SCHEMA_VERSION = 1;

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
  available: "Disponíveis",
  active: "Em Andamento",
  completed: "Concluídas",
  failed: "Fracassadas",
  inactive: "Inativas"
});

export const GM_ONLY_STATUS = Object.freeze([QUEST_STATUS.inactive]);

export const REWARD_TYPE = Object.freeze({
  abstract: "abstract",
  item: "item"
});

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
    gmnotes: html(data.gmnotes),
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
    hidden: data.hidden === true
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
    hidden: data.hidden === true,
    // Rewards start locked: the party has not earned them yet.
    locked: data.locked === undefined ? true : data.locked === true,
    data: isRecord(data.data) ? { ...data.data } : {}
  };
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
