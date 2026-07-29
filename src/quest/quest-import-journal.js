/**
 * Promote JournalEntries already in the world into Quest Log quests.
 *
 * The database of MasterQuest is the Journal, so an adventure that already lives there —
 * an authoring draft, a folder of imported lore, an adventure written as Journal pages —
 * should be promotable without going through a blueprint file.
 *
 * Three shapes are recognised, in order:
 *
 * 1. Already a quest (`flags["master-quest"].quest`) — skipped, never touched.
 * 2. An authoring draft (`flags["master-quest"].masterQuestDraft`) — converted through the
 *    same draft-to-quest bridge the Authoring Console uses, so nothing diverges.
 * 3. A plain JournalEntry — becomes a quest whose description is the first text page.
 *
 * The landing status is the GM's choice and defaults to `available`: promoted quests should
 * be visible where they can be picked up, not buried in the GM-only tab.
 */

import { MODULE_ID } from "../constants.js";
import { QUEST_FLAG } from "./quest-store.js";
import { QUEST_STATUS, normalizeQuest } from "./quest-schema.js";
import { draftToQuest } from "./quest-from-draft.js";

export const PROMOTION_KIND = Object.freeze({
  alreadyQuest: "already-quest",
  fromDraft: "from-draft",
  fromJournal: "from-journal"
});

/**
 * List the Journal folders of the world, with how many entries each could contribute.
 *
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {Array<object>} `[{id, name, total, promotable, alreadyQuests}]`.
 */
export function listPromotableFolders({ game = globalThis.game } = {}) {
  const entries = collectionToArray(game?.journal);
  const byFolder = new Map();

  for (const entry of entries) {
    const folder = entry?.folder;
    const id = typeof folder === "string" ? folder : folder?.id ?? folder?._id ?? null;
    const name = typeof folder === "string" ? null : folder?.name ?? null;
    const key = id ?? "__root__";

    if (!byFolder.has(key)) {
      byFolder.set(key, { id, name: name ?? "(sem pasta)", total: 0, promotable: 0, alreadyQuests: 0 });
    }

    const bucket = byFolder.get(key);
    bucket.total += 1;
    if (bucket.name === "(sem pasta)" && name) bucket.name = name;
    if (readQuestFlag(entry)) bucket.alreadyQuests += 1;
    else bucket.promotable += 1;
  }

  return Array.from(byFolder.values()).sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Report what promoting a folder would do, without writing anything.
 *
 * @param {object} options
 * @param {string|null} options.folderId The folder id, or null for entries with no folder.
 * @param {object} [options.game] The Foundry game object.
 * @returns {object} `{status, folderId, total, promote, skip, entries}`.
 */
export function planJournalPromotion({ folderId, game = globalThis.game } = {}) {
  const entries = collectionToArray(game?.journal).filter((entry) => matchesFolder(entry, folderId));

  const described = entries.map((entry) => {
    const kind = classify(entry);
    return {
      journalEntryId: entry?.id ?? entry?._id ?? null,
      name: entry?.name ?? "",
      kind,
      willPromote: kind !== PROMOTION_KIND.alreadyQuest
    };
  });

  return {
    status: "ok",
    folderId: folderId ?? null,
    total: described.length,
    promote: described.filter((entry) => entry.willPromote).length,
    skip: described.filter((entry) => !entry.willPromote).length,
    entries: described
  };
}

/**
 * Promote every eligible JournalEntry of a folder into a quest.
 *
 * @param {object} options
 * @param {string|null} options.folderId The folder id.
 * @param {object} [options.game] The Foundry game object.
 * @param {boolean} [options.dryRun] When true, nothing is written.
 * @returns {Promise<object>} `{status, promoted, skipped, failed, results, plan}`.
 */
export async function promoteJournalFolder({
  folderId,
  game = globalThis.game,
  dryRun = false,
  status = QUEST_STATUS.available
} = {}) {
  const plan = planJournalPromotion({ folderId, game });
  if (dryRun) return { status: "dry-run", promoted: 0, skipped: 0, failed: 0, results: [], plan };

  const entries = collectionToArray(game?.journal).filter((entry) => matchesFolder(entry, folderId));
  const results = [];

  for (const entry of entries) {
    const kind = classify(entry);
    if (kind === PROMOTION_KIND.alreadyQuest) {
      results.push({ journalEntryId: entry?.id ?? null, name: entry?.name ?? "", outcome: "skipped", kind });
      continue;
    }

    try {
      const landing = QUEST_STATUS[status] ? status : QUEST_STATUS.available;
      const quest = kind === PROMOTION_KIND.fromDraft
        ? draftToQuest(readDraftFlag(entry), { status: landing })
        : questFromJournalEntry(entry, { status: landing });

      await writeQuest(entry, quest);
      results.push({ journalEntryId: entry?.id ?? null, name: entry?.name ?? "", outcome: "promoted", kind });
    } catch (error) {
      results.push({
        journalEntryId: entry?.id ?? null,
        name: entry?.name ?? "",
        outcome: "failed",
        kind,
        error: String(error?.message ?? error)
      });
    }
  }

  return {
    status: "done",
    promoted: results.filter((result) => result.outcome === "promoted").length,
    skipped: results.filter((result) => result.outcome === "skipped").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    results,
    plan
  };
}

/**
 * Build a quest out of a plain JournalEntry.
 *
 * The first text page becomes the player-facing description; the remaining pages are
 * listed in the GM notes so nothing is lost, and the GM can see what else the entry holds.
 *
 * @param {object} entry A JournalEntry.
 * @returns {object} A normalized quest.
 */
export function questFromJournalEntry(entry, { status = QUEST_STATUS.available } = {}) {
  const pages = collectionToArray(entry?.pages);
  const textPages = pages.filter((page) => pageText(page));
  const [first, ...rest] = textPages;

  const gmnotes = rest.length
    ? `<h3>Outras páginas deste Journal</h3><ul>${rest
        .map((page) => `<li>${escapeHtml(page?.name ?? "(sem nome)")}</li>`)
        .join("")}</ul>`
    : "";

  return normalizeQuest({
    name: entry?.name ?? "Nova Quest",
    status: QUEST_STATUS[status] ? status : QUEST_STATUS.available,
    description: pageText(first) ?? "",
    gmnotes,
    source: "journal-promotion"
  });
}

function classify(entry) {
  if (readQuestFlag(entry)) return PROMOTION_KIND.alreadyQuest;
  if (readDraftFlag(entry)) return PROMOTION_KIND.fromDraft;
  return PROMOTION_KIND.fromJournal;
}

function matchesFolder(entry, folderId) {
  const folder = entry?.folder;
  const id = typeof folder === "string" ? folder : folder?.id ?? folder?._id ?? null;
  return (id ?? null) === (folderId ?? null);
}

function readQuestFlag(entry) {
  return entry?.flags?.[MODULE_ID]?.[QUEST_FLAG] ?? null;
}

function readDraftFlag(entry) {
  return entry?.flags?.[MODULE_ID]?.masterQuestDraft ?? null;
}

function pageText(page) {
  const content = page?.text?.content ?? page?.system?.content ?? "";
  return typeof content === "string" && content.trim() ? content : null;
}

async function writeQuest(entry, quest) {
  if (typeof entry.update === "function") {
    await entry.update({ flags: { [MODULE_ID]: { [QUEST_FLAG]: quest } } });
    return;
  }
  entry.flags ??= {};
  entry.flags[MODULE_ID] ??= {};
  entry.flags[MODULE_ID][QUEST_FLAG] = quest;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function collectionToArray(collection) {
  if (collection == null) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}
