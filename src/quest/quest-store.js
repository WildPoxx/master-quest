/**
 * Quest storage: reads and writes MasterQuest quests on JournalEntry flags.
 *
 * Every Foundry touchpoint is injectable so the layer is unit-testable without a
 * running world. The write boundary of the module stays intact: nothing here runs
 * on its own, it only executes when the GM acts in the Quest Log.
 */

import { MODULE_ID } from "../constants.js";
import { normalizeQuest, withStatus, QUEST_STATUS } from "./quest-schema.js";

export const QUEST_FLAG = "quest";
export const QUEST_FOLDER_NAME = "MasterQuest";
export const PRIMARY_QUEST_SETTING = "primaryQuest";

const JOURNAL_ENTRY_TYPE = "JournalEntry";

/**
 * Read one quest from a JournalEntry.
 *
 * @param {object} entry A JournalEntry document.
 * @returns {object|null} `{id, entry, ...quest}` or null when the entry holds no quest.
 */
export function readQuest(entry) {
  const raw = readFlag(entry);
  if (!raw) return null;

  return {
    ...normalizeQuest(raw),
    id: entry.id ?? entry._id ?? null,
    entry
  };
}

/**
 * Read every quest visible in the world.
 *
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @param {object} [options.user] The acting user; defaults to `game.user`.
 * @returns {object[]} Quests the user is allowed to see.
 */
export function readAllQuests({ game = globalThis.game, user = null } = {}) {
  const actingUser = user ?? game?.user ?? null;
  const isGM = actingUser?.isGM === true;

  return collectionToArray(game?.journal)
    .map(readQuest)
    .filter(Boolean)
    .filter((quest) => isGM || canUserView(quest.entry, actingUser));
}

/**
 * Read a single quest by its JournalEntry id.
 *
 * @param {string} questId The quest / JournalEntry id.
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {object|null} The quest or null.
 */
export function readQuestById(questId, { game = globalThis.game } = {}) {
  if (!questId) return null;
  const entry = game?.journal?.get?.(questId) ?? null;
  return entry ? readQuest(entry) : null;
}

/**
 * Persist a quest payload back onto its JournalEntry.
 *
 * Also keeps the JournalEntry name in sync with the quest name, so the sidebar and
 * the log never disagree.
 *
 * @param {object} quest A quest carrying `entry`.
 * @param {object} [options]
 * @param {boolean} [options.dryRun] Return the payload without writing.
 * @returns {Promise<object>} `{status, questId, payload}`.
 */
export async function saveQuest(quest, { dryRun = false } = {}) {
  const entry = quest?.entry ?? null;
  const payload = toStoredPayload(quest);
  const questId = entry?.id ?? entry?._id ?? null;

  if (dryRun || !entry?.update) {
    return { status: dryRun ? "dry-run" : "blocked", questId, payload };
  }

  if (entry.canUserModify && !entry.canUserModify(currentUser(), "update")) {
    return { status: "forbidden", questId, payload };
  }

  await entry.update(
    {
      name: payload.name,
      flags: { [MODULE_ID]: { [QUEST_FLAG]: payload } }
    },
    { diff: false }
  );

  return { status: "saved", questId, payload };
}

/**
 * Create a new quest as a JournalEntry inside the MasterQuest folder.
 *
 * @param {object} [seed] Partial quest data.
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @param {object} [options.JournalEntry] The JournalEntry class.
 * @param {object} [options.Folder] The Folder class.
 * @param {string} [options.parentId] Create as a subquest of this quest.
 * @returns {Promise<object|null>} The created quest, or null when creation failed.
 */
export async function createQuest(
  seed = {},
  {
    game = globalThis.game,
    JournalEntry = globalThis.JournalEntry,
    Folder = globalThis.Folder,
    parentId = null
  } = {}
) {
  if (typeof JournalEntry?.create !== "function") return null;

  const now = Date.now();
  const quest = normalizeQuest({
    ...seed,
    parent: parentId ?? seed.parent ?? null,
    date: { create: now, start: null, end: null }
  });

  const folder = await ensureQuestFolder({ game, Folder });
  const created = await JournalEntry.create({
    name: quest.name,
    folder: folder?.id ?? folder?._id ?? null,
    flags: { [MODULE_ID]: { [QUEST_FLAG]: quest } }
  });

  if (!created) return null;

  if (parentId) await linkSubquest(parentId, created.id ?? created._id, { game });

  return readQuest(created);
}

/**
 * Delete a quest, detaching it from its parent and orphaning its subquests.
 *
 * Subquests are never deleted in cascade: losing a branch by accident is far worse
 * than leaving a few orphans behind for the GM to re-file.
 *
 * @param {string} questId The quest id.
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {Promise<object>} `{status, questId, orphaned}`.
 */
export async function deleteQuest(questId, { game = globalThis.game } = {}) {
  const quest = readQuestById(questId, { game });
  if (!quest) return { status: "missing", questId, orphaned: [] };

  if (quest.parent) await unlinkSubquest(quest.parent, questId, { game });

  const orphaned = [];
  for (const childId of quest.subquests) {
    const child = readQuestById(childId, { game });
    if (!child) continue;
    await saveQuest({ ...child, parent: null });
    orphaned.push(childId);
  }

  if (typeof quest.entry?.delete === "function") await quest.entry.delete();

  return { status: "deleted", questId, orphaned };
}

/**
 * Change a quest's status, keeping the date bookkeeping consistent.
 *
 * @param {string} questId The quest id.
 * @param {string} status The target status.
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {Promise<object>} The save result.
 */
export async function setQuestStatus(questId, status, { game = globalThis.game } = {}) {
  const quest = readQuestById(questId, { game });
  if (!quest) return { status: "missing", questId };
  return saveQuest(withStatus(quest, status));
}

/**
 * Attach `childId` as a subquest of `parentId`, detaching it from any previous parent.
 *
 * @param {string} parentId The parent quest id.
 * @param {string} childId The child quest id.
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {Promise<object>} `{status}`.
 */
export async function linkSubquest(parentId, childId, { game = globalThis.game } = {}) {
  if (!parentId || !childId || parentId === childId) return { status: "invalid" };

  const parent = readQuestById(parentId, { game });
  const child = readQuestById(childId, { game });
  if (!parent || !child) return { status: "missing" };

  // A quest cannot become a descendant of itself.
  if (isAncestor(childId, parentId, { game })) return { status: "cycle" };

  if (child.parent && child.parent !== parentId) {
    await unlinkSubquest(child.parent, childId, { game });
  }

  if (!parent.subquests.includes(childId)) {
    await saveQuest({ ...parent, subquests: [...parent.subquests, childId] });
  }
  await saveQuest({ ...child, parent: parentId });

  return { status: "linked" };
}

/**
 * Detach `childId` from `parentId`.
 *
 * @param {string} parentId The parent quest id.
 * @param {string} childId The child quest id.
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {Promise<object>} `{status}`.
 */
export async function unlinkSubquest(parentId, childId, { game = globalThis.game } = {}) {
  const parent = readQuestById(parentId, { game });
  if (parent) {
    await saveQuest({ ...parent, subquests: parent.subquests.filter((id) => id !== childId) });
  }

  const child = readQuestById(childId, { game });
  if (child && child.parent === parentId) {
    await saveQuest({ ...child, parent: null });
  }

  return { status: "unlinked" };
}

/**
 * Walk up the parent chain to detect whether `ancestorId` is above `questId`.
 *
 * @param {string} ancestorId Candidate ancestor id.
 * @param {string} questId Quest to walk up from.
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {boolean} True when a cycle would be created.
 */
export function isAncestor(ancestorId, questId, { game = globalThis.game } = {}) {
  const seen = new Set();
  let current = questId;

  while (current && !seen.has(current)) {
    seen.add(current);
    if (current === ancestorId) return true;
    current = readQuestById(current, { game })?.parent ?? null;
  }

  return false;
}

/**
 * Find or create the MasterQuest journal folder.
 *
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @param {object} [options.Folder] The Folder class.
 * @returns {Promise<object|null>} The folder document, or null.
 */
export async function ensureQuestFolder({ game = globalThis.game, Folder = globalThis.Folder } = {}) {
  const existing = collectionToArray(game?.folders).find(
    (folder) => folder?.name === QUEST_FOLDER_NAME && folder?.type === JOURNAL_ENTRY_TYPE
  );
  if (existing) return existing;
  if (typeof Folder?.create !== "function") return null;

  return Folder.create({ name: QUEST_FOLDER_NAME, type: JOURNAL_ENTRY_TYPE, sorting: "m" });
}

/**
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {string|null} The id of the current primary quest.
 */
export function getPrimaryQuestId({ game = globalThis.game } = {}) {
  try {
    return game?.settings?.get?.(MODULE_ID, PRIMARY_QUEST_SETTING) || null;
  } catch {
    return null;
  }
}

/**
 * Set or clear the primary quest. Setting the current primary again clears it.
 *
 * @param {string|null} questId The quest id, or null to clear.
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {Promise<string|null>} The resulting primary quest id.
 */
export async function setPrimaryQuestId(questId, { game = globalThis.game } = {}) {
  const next = getPrimaryQuestId({ game }) === questId ? "" : questId ?? "";
  try {
    await game?.settings?.set?.(MODULE_ID, PRIMARY_QUEST_SETTING, next);
  } catch {
    return getPrimaryQuestId({ game });
  }
  return next || null;
}

/**
 * Strip the runtime-only fields before writing to a flag.
 *
 * @param {object} quest A quest, possibly carrying `entry` and `id`.
 * @returns {object} The payload to store.
 */
export function toStoredPayload(quest) {
  const normalized = normalizeQuest(quest);
  return normalized;
}

function readFlag(entry) {
  if (!entry) return null;
  if (typeof entry.getFlag === "function") {
    const value = entry.getFlag(MODULE_ID, QUEST_FLAG);
    if (value) return value;
  }
  return entry.flags?.[MODULE_ID]?.[QUEST_FLAG] ?? null;
}

function canUserView(entry, user) {
  if (!entry) return false;
  if (typeof entry.testUserPermission === "function") {
    return entry.testUserPermission(user, "OBSERVER");
  }
  return entry.visible !== false;
}

function currentUser() {
  return globalThis.game?.user ?? null;
}

function collectionToArray(collection) {
  if (collection == null) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}

export { QUEST_STATUS };
