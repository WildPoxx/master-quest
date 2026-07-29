/**
 * Import quests stored by Forien's Quest Log into the MasterQuest namespace.
 *
 * FQL keeps its whole payload in `flags["forien-quest-log"].json` on a JournalEntry.
 * The quest id is the JournalEntry id, so parent/subquest links survive the import
 * untouched — we only translate field names.
 *
 * The importer never deletes or edits the FQL flag. The original data stays in place
 * as a rollback, and a re-import is idempotent because it overwrites by entry id.
 */

import { FQL_MODULE_ID, FQL_FLAG_KEY, MODULE_ID } from "../constants.js";
import { normalizeQuest, QUEST_STATUS } from "./quest-schema.js";
import { QUEST_FLAG } from "./quest-store.js";

/**
 * Translate one FQL payload into a MasterQuest quest.
 *
 * @param {object} [fql] The raw `flags["forien-quest-log"].json` value.
 * @returns {object} A normalized MasterQuest quest.
 */
export function fqlToMasterQuest(fql = {}) {
  const data = fql && typeof fql === "object" ? fql : {};

  return normalizeQuest({
    name: data.name,
    status: QUEST_STATUS[data.status] ? data.status : QUEST_STATUS.inactive,
    giver: data.giver,
    giverData: data.giverData,
    giverName: data.giverName,
    image: data.image,
    description: data.description,
    gmnotes: data.gmnotes,
    playernotes: data.playernotes,
    splash: data.splash,
    splashPos: data.splashPos,
    splashAsIcon: data.splashAsIcon,
    location: data.location,
    priority: data.priority,
    type: data.type,
    parent: data.parent,
    subquests: data.subquests,
    // FQL calls them tasks and keys them by uuidv4.
    objectives: toArray(data.tasks).map((task) => ({
      id: task?.uuidv4,
      name: task?.name,
      completed: task?.completed,
      failed: task?.failed,
      hidden: task?.hidden
    })),
    rewards: toArray(data.rewards).map((reward) => ({
      id: reward?.uuidv4,
      type: reward?.type,
      name: reward?.data?.name,
      img: reward?.data?.img,
      uuid: reward?.data?.uuid,
      hidden: reward?.hidden,
      locked: reward?.locked,
      data: reward?.data
    })),
    date: data.date,
    source: "imported-fql"
  });
}

/**
 * Survey the world for FQL quests, without writing anything.
 *
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {object} `{total, alreadyImported, pending, entries}`.
 */
export function previewFqlImport({ game = globalThis.game } = {}) {
  const entries = collectionToArray(game?.journal)
    .map((entry) => {
      const fql = readFlag(entry, FQL_MODULE_ID, FQL_FLAG_KEY);
      if (!fql) return null;

      const hasMasterQuest = Boolean(readFlag(entry, MODULE_ID, QUEST_FLAG));
      return {
        id: entry.id ?? entry._id ?? null,
        name: entry.name ?? fql.name ?? "",
        status: fql.status ?? QUEST_STATUS.inactive,
        objectiveCount: toArray(fql.tasks).length,
        rewardCount: toArray(fql.rewards).length,
        subquestCount: toArray(fql.subquests).length,
        alreadyImported: hasMasterQuest,
        entry
      };
    })
    .filter(Boolean);

  return {
    total: entries.length,
    alreadyImported: entries.filter((e) => e.alreadyImported).length,
    pending: entries.filter((e) => !e.alreadyImported).length,
    entries
  };
}

/**
 * Import FQL quests into the MasterQuest namespace.
 *
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @param {boolean} [options.dryRun] Compute the plan without writing.
 * @param {boolean} [options.overwrite] Re-import entries that already carry a MasterQuest quest.
 * @returns {Promise<object>} `{status, imported, skipped, failed, results}`.
 */
export async function importFromFql({
  game = globalThis.game,
  dryRun = false,
  overwrite = false
} = {}) {
  const preview = previewFqlImport({ game });
  const results = [];

  for (const candidate of preview.entries) {
    if (candidate.alreadyImported && !overwrite) {
      results.push({ id: candidate.id, name: candidate.name, outcome: "skipped" });
      continue;
    }

    const fql = readFlag(candidate.entry, FQL_MODULE_ID, FQL_FLAG_KEY);
    const quest = fqlToMasterQuest(fql);

    if (dryRun) {
      results.push({ id: candidate.id, name: candidate.name, outcome: "dry-run", quest });
      continue;
    }

    try {
      await candidate.entry.update(
        { flags: { [MODULE_ID]: { [QUEST_FLAG]: quest } } },
        { diff: false }
      );
      results.push({ id: candidate.id, name: candidate.name, outcome: "imported" });
    } catch (err) {
      results.push({
        id: candidate.id,
        name: candidate.name,
        outcome: "failed",
        error: String(err?.message ?? err)
      });
    }
  }

  return {
    status: dryRun ? "dry-run" : "done",
    total: preview.total,
    imported: results.filter((r) => r.outcome === "imported").length,
    skipped: results.filter((r) => r.outcome === "skipped").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    results
  };
}

/**
 * Read a flag straight off the document data.
 *
 * Deliberately does NOT use `Document#getFlag`. Foundry validates the flag scope
 * against `core`, the system id and the *active* module ids, and throws
 * `Flag scope "<id>" is not valid or not currently active` otherwise. FQL cannot be
 * enabled on Foundry v14 (its manifest caps at v13), so `getFlag("forien-quest-log")`
 * always throws there — even though the flag data is still sitting on the JournalEntry.
 * Reading `flags[scope][key]` is exactly what `getFlag` does, minus the scope check.
 *
 * @param {object} entry A JournalEntry (document or plain data).
 * @param {string} moduleId The flag scope.
 * @param {string} key The flag key.
 * @returns {*} The flag value, or null.
 */
function readFlag(entry, moduleId, key) {
  if (!entry) return null;
  return entry.flags?.[moduleId]?.[key] ?? null;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function collectionToArray(collection) {
  if (collection == null) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}
