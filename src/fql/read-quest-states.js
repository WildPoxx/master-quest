import { FQL_FLAG_KEY, FQL_MODULE_ID, OBSERVER_OWNERSHIP_LEVEL, QUEST_STATUS } from "../constants.js";
import { extractJournalLinks } from "../journal/links.js";

const KNOWN_QUEST_FIELDS = new Set([
  "name",
  "status",
  "giver",
  "giverData",
  "description",
  "gmnotes",
  "gmNotes",
  "playernotes",
  "playerNotes",
  "image",
  "giverName",
  "splash",
  "splashPos",
  "splashAsIcon",
  "location",
  "priority",
  "type",
  "parent",
  "subquests",
  "tasks",
  "rewards",
  "date",
  "tags"
]);

export function readQuestStates({ journal, includeHidden = true } = {}) {
  if (!journal) {
    return [];
  }

  return toArray(journal)
    .map((doc) => readQuestState(doc))
    .filter(Boolean)
    .filter((state) => includeHidden || state.visibility.playersVisible);
}

export function readQuestState(doc) {
  const fqlData = getFqlData(doc);
  if (!isPlainObject(fqlData)) {
    return null;
  }

  const source = cloneData(fqlData);
  const id = doc.id ?? source.id ?? null;
  const name = source.name ?? doc.name ?? "Unnamed quest";
  const playerNotes = source.playernotes ?? source.playerNotes ?? "";
  const gmnotes = source.gmnotes ?? source.gmNotes ?? "";
  const textFields = [source.description, gmnotes, playerNotes].filter(Boolean);

  return {
    id,
    uuid: doc.uuid ?? (id ? `JournalEntry.${id}` : null),
    name,
    status: normalizeStatus(source.status),
    visibility: getVisibility(doc, source),
    tasks: normalizeTasks(source.tasks, id),
    rewards: normalizeRewards(source.rewards, id),
    gmnotes,
    playerNotes,
    description: source.description ?? "",
    journalLinks: extractJournalLinks(textFields.join("\n")),
    tags: Array.isArray(source.tags) ? [...source.tags] : [],
    parent: source.parent ?? null,
    subquests: Array.isArray(source.subquests) ? [...source.subquests] : [],
    olfFlags: cloneData(doc.flags?.["outsiders-lost-frontier"] ?? null),
    lastUpdated: getLastUpdated(doc, source),
    unknownFields: getUnknownFields(source),
    source
  };
}

export function getFqlData(doc) {
  if (!doc) {
    return null;
  }

  // Read the raw flag rather than `doc.getFlag(...)`: Foundry rejects flag scopes whose
  // module is not active, and FQL cannot be activated on v14. See quest-import-fql.js.
  return doc.flags?.[FQL_MODULE_ID]?.[FQL_FLAG_KEY] ?? null;
}

function normalizeTasks(tasks, sourceQuest) {
  if (!Array.isArray(tasks)) {
    return [];
  }

  return tasks.map((task) => ({
    id: task.uuidv4 ?? task.id ?? null,
    title: task.name ?? task.title ?? "",
    done: Boolean(task.completed ?? task.done),
    failed: Boolean(task.failed),
    visible: !Boolean(task.hidden),
    gmOnly: Boolean(task.hidden),
    sourceQuest,
    type: task.type ?? "unknown",
    source: cloneData(task)
  }));
}

function normalizeRewards(rewards, sourceQuest) {
  if (!Array.isArray(rewards)) {
    return [];
  }

  return rewards.map((reward) => ({
    id: reward.uuidv4 ?? reward.id ?? reward.data?.uuid ?? null,
    title: reward.data?.name ?? reward.name ?? reward.title ?? "",
    claimed: Boolean(reward.claimed ?? reward.completed),
    visible: !Boolean(reward.hidden),
    locked: typeof reward.locked === "boolean" ? reward.locked : true,
    sourceQuest,
    type: reward.type ?? "unknown",
    source: cloneData(reward)
  }));
}

function normalizeStatus(status) {
  return Object.values(QUEST_STATUS).includes(status) ? status : QUEST_STATUS.unknown;
}

function getVisibility(doc, source) {
  const ownership = doc.ownership ?? doc.permission ?? {};
  const defaultLevel = Number(ownership.default ?? 0);
  const explicitLevels = Object.entries(ownership)
    .filter(([key]) => key !== "default")
    .map(([, level]) => Number(level));
  const playersVisible = defaultLevel >= OBSERVER_OWNERSHIP_LEVEL ||
    explicitLevels.some((level) => level >= OBSERVER_OWNERSHIP_LEVEL);

  return {
    playersVisible,
    gmOnly: !playersVisible || Boolean(source.hidden)
  };
}

function getLastUpdated(doc, source) {
  return source.date?.end ??
    source.date?.start ??
    source.date?.created ??
    doc.updatedTime ??
    doc.updateTime ??
    null;
}

function getUnknownFields(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => !KNOWN_QUEST_FIELDS.has(key))
  );
}

function toArray(collection) {
  if (Array.isArray(collection)) {
    return collection;
  }

  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }

  if (typeof collection[Symbol.iterator] === "function") {
    return Array.from(collection);
  }

  return Object.values(collection);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneData(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}
