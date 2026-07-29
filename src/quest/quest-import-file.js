/**
 * Import an adventure from a JSON file.
 *
 * Adventures travel in two shapes, and both are accepted:
 *
 * - a MasterQuest blueprint (`{blueprintId, quests: [...]}`), the reviewable data contract;
 * - a Foundry Journal export — a whole folder (`{folders, items}`), a bare array of
 *   entries, or a single JournalEntry (`{name, pages}`) — because that is how finished
 *   adventures actually circulate between worlds.
 *
 * Journal-shaped payloads become JournalEntries first and quests second: the Journal stays
 * the database, and the quest is the flag written onto it.
 */

import { MODULE_ID } from "../constants.js";
import { QUEST_FLAG, QUEST_FOLDER_NAME } from "./quest-store.js";
import { applyBlueprintImport, planBlueprintImport } from "./quest-blueprint.js";
import { questFromJournalEntry } from "./quest-import-journal.js";

const JOURNAL_ENTRY_TYPE = "JournalEntry";

export const PAYLOAD_KIND = Object.freeze({
  blueprint: "blueprint",
  journalExport: "journal-export",
  journalEntry: "journal-entry",
  unknown: "unknown"
});

/**
 * Identify what a parsed JSON file actually is.
 *
 * @param {*} payload The parsed JSON.
 * @returns {string} One of `PAYLOAD_KIND`.
 */
export function detectPayloadKind(payload) {
  if (Array.isArray(payload)) {
    return payload.some((entry) => isRecord(entry) && "pages" in entry) ? PAYLOAD_KIND.journalExport : PAYLOAD_KIND.unknown;
  }
  if (!isRecord(payload)) return PAYLOAD_KIND.unknown;

  if (Array.isArray(payload.quests) && payload.quests.some((quest) => isRecord(quest) && quest.designId)) {
    return PAYLOAD_KIND.blueprint;
  }
  if (Array.isArray(payload.items)) return PAYLOAD_KIND.journalExport;
  if (Array.isArray(payload.pages) || typeof payload.name === "string") return PAYLOAD_KIND.journalEntry;

  return PAYLOAD_KIND.unknown;
}

/**
 * Report what importing a payload would do, without writing anything.
 *
 * @param {object} options
 * @param {*} options.payload The parsed JSON.
 * @param {object} [options.game] The Foundry game object.
 * @param {string} [options.folderName] Destination folder for journal-shaped payloads.
 * @returns {object} A plan describing the operation.
 */
export function planFileImport({ payload, game = globalThis.game, folderName = null } = {}) {
  const kind = detectPayloadKind(payload);

  if (kind === PAYLOAD_KIND.blueprint) {
    return { ...planBlueprintImport({ blueprint: payload, game }), kind };
  }

  if (kind === PAYLOAD_KIND.unknown) {
    return {
      kind,
      status: "invalid",
      total: 0,
      create: 0,
      update: 0,
      entries: [],
      missingJournalLinks: [],
      issues: [
        {
          severity: "error",
          code: "unrecognised-payload",
          message: "O arquivo não é um blueprint do MasterQuest nem um export de Journal do Foundry.",
          designId: null
        }
      ]
    };
  }

  const items = journalItems(payload);
  return {
    kind,
    status: items.length ? "ok" : "invalid",
    folderName: folderName || payloadFolderName(payload) || QUEST_FOLDER_NAME,
    total: items.length,
    create: items.length,
    update: 0,
    entries: items.map((item) => ({
      designId: null,
      name: item?.name ?? "(sem nome)",
      type: null,
      operation: "create",
      journalEntryId: null,
      preserved: null,
      blueprintStatus: "inactive"
    })),
    missingJournalLinks: [],
    issues: items.length
      ? []
      : [{ severity: "error", code: "no-entries", message: "O export não tem entradas.", designId: null }]
  };
}

/**
 * Import a parsed JSON payload.
 *
 * @param {object} options
 * @param {*} options.payload The parsed JSON.
 * @param {object} [options.game] The Foundry game object.
 * @param {boolean} [options.dryRun] When true, nothing is written.
 * @param {string} [options.folderName] Destination folder for journal-shaped payloads.
 * @param {object} [options.JournalEntry] Injectable document class.
 * @param {object} [options.Folder] Injectable folder class.
 * @returns {Promise<object>} `{status, kind, created, updated, failed, results, plan}`.
 */
export async function applyFileImport({
  payload,
  game = globalThis.game,
  dryRun = false,
  folderName = null,
  status = null,
  JournalEntry = globalThis.JournalEntry,
  Folder = globalThis.Folder
} = {}) {
  const kind = detectPayloadKind(payload);

  if (kind === PAYLOAD_KIND.blueprint) {
    const result = await applyBlueprintImport({ blueprint: payload, game, dryRun, JournalEntry, Folder });
    return { ...result, kind };
  }

  const plan = planFileImport({ payload, game, folderName });
  if (plan.status !== "ok") return { status: "invalid", kind, created: 0, updated: 0, failed: 0, results: [], plan };
  if (dryRun) return { status: "dry-run", kind, created: 0, updated: 0, failed: 0, results: [], plan };

  const folder = await ensureFolder({ game, Folder, folderName: plan.folderName });
  const folderId = folder?.id ?? folder?._id ?? null;
  const results = [];

  for (const item of journalItems(payload)) {
    try {
      if (typeof JournalEntry?.create !== "function") {
        results.push({ name: item?.name ?? "", outcome: "failed", error: "missing-journal-entry-create" });
        continue;
      }

      // The quest is derived from the entry data before creation, so the flag is written
      // in the same operation instead of a second update round-trip.
      // A blueprint declares its own statuses; a Journal export does not, so the GM chooses.
      const quest = questFromJournalEntry(item, status ? { status } : {});
      const created = await JournalEntry.create({
        name: item?.name ?? quest.name,
        folder: folderId,
        pages: Array.isArray(item?.pages) ? item.pages : [],
        flags: mergeFlags(item?.flags, quest)
      });

      results.push({ name: item?.name ?? "", outcome: "created", journalEntryId: created?.id ?? created?._id ?? null });
    } catch (error) {
      results.push({ name: item?.name ?? "", outcome: "failed", error: String(error?.message ?? error) });
    }
  }

  return {
    status: "done",
    kind,
    created: results.filter((result) => result.outcome === "created").length,
    updated: 0,
    failed: results.filter((result) => result.outcome === "failed").length,
    results,
    plan
  };
}

/**
 * Read and parse a File chosen by the GM.
 *
 * @param {File} file A browser File.
 * @returns {Promise<*>} The parsed JSON.
 */
export async function readJsonFile(file) {
  const text = typeof file?.text === "function" ? await file.text() : null;
  if (typeof text !== "string") throw new Error("Não consegui ler o arquivo.");
  return JSON.parse(text);
}

function journalItems(payload) {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (Array.isArray(payload?.items)) return payload.items.filter(isRecord);
  if (isRecord(payload)) return [payload];
  return [];
}

function payloadFolderName(payload) {
  const folders = Array.isArray(payload?.folders) ? payload.folders : [];
  return folders[0]?.name ?? null;
}

function mergeFlags(existing, quest) {
  const flags = isRecord(existing) ? { ...existing } : {};
  flags[MODULE_ID] = { ...(isRecord(flags[MODULE_ID]) ? flags[MODULE_ID] : {}), [QUEST_FLAG]: quest };
  return flags;
}

async function ensureFolder({ game, Folder, folderName }) {
  const folders = collectionToArray(game?.folders);
  const existing = folders.find(
    (folder) => folder?.name === folderName && (!folder.type || folder.type === JOURNAL_ENTRY_TYPE)
  );
  if (existing) return existing;
  if (typeof Folder?.create !== "function") return null;
  return Folder.create({ name: folderName, type: JOURNAL_ENTRY_TYPE, sorting: "m" });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function collectionToArray(collection) {
  if (collection == null) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}
