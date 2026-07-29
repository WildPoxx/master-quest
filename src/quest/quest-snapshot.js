/**
 * Read-only snapshot of the Quest Log.
 *
 * This is the export end of the table pipeline: plan the adventure, run it, then dump the
 * current state of every quest as JSON so it can be handed to an assistant together with
 * session logs and chat records, and come back as an update script.
 *
 * Read-only by construction. Nothing here creates, updates or deletes a document, sets a
 * flag, or posts a chat message.
 */

import { MODULE_ID, MODULE_TITLE, FQL_MODULE_ID } from "../constants.js";
import { QUEST_FLAG } from "./quest-store.js";

export const SNAPSHOT_SCHEMA_VERSION = 1;

/**
 * Build the snapshot payload.
 *
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @param {string} [options.capturedAt] ISO timestamp, injectable for tests.
 * @returns {object} The snapshot.
 */
export function buildQuestSnapshot({ game = globalThis.game, capturedAt = null } = {}) {
  const entries = collectionToArray(game?.journal);
  const quests = [];
  const legacyFqlQuests = [];

  for (const entry of entries) {
    const quest = readRawFlag(entry, MODULE_ID, QUEST_FLAG);
    if (quest) quests.push(describeQuest(entry, quest));

    // FQL data is reported but never converted here: the snapshot documents what exists.
    const fql = readRawFlag(entry, FQL_MODULE_ID, "json");
    if (fql) legacyFqlQuests.push(describeLegacyFql(entry, fql));
  }

  quests.sort((left, right) => String(left.name).localeCompare(String(right.name)));

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    app: MODULE_TITLE,
    capturedAt: capturedAt ?? new Date().toISOString(),
    source: {
      worldId: game?.world?.id ?? null,
      worldTitle: game?.world?.title ?? null,
      foundryVersion: game?.version ?? null,
      systemId: game?.system?.id ?? null,
      systemVersion: game?.system?.version ?? null,
      user: game?.user?.name ?? null,
      userIsGM: game?.user?.isGM === true
    },
    safety: {
      mode: "read-only",
      changedFoundryDocuments: false,
      createdChatMessage: false,
      touchedQuestStatus: false,
      touchedObjectives: false,
      touchedRewards: false
    },
    summary: {
      journalEntryCount: entries.length,
      questCount: quests.length,
      statusCounts: countBy(quests, (quest) => quest.status),
      objectiveCount: quests.reduce((total, quest) => total + quest.objectives.length, 0),
      completedObjectiveCount: quests.reduce(
        (total, quest) => total + quest.objectives.filter((objective) => objective.completed).length,
        0
      ),
      legacyFqlQuestCount: legacyFqlQuests.length
    },
    quests,
    legacyFqlQuests
  };
}

/**
 * Build the snapshot and hand it to the browser as a download.
 *
 * @param {object} [options] Passed through to `buildQuestSnapshot`, plus injectables.
 * @returns {object} `{status, filename, questCount, snapshot}`.
 */
export function downloadQuestSnapshot(options = {}) {
  const snapshot = buildQuestSnapshot(options);
  const json = JSON.stringify(snapshot, null, 2);
  const filename = makeSnapshotFilename(snapshot);
  const save = options.saveDataToFile ?? globalThis.saveDataToFile
    ?? globalThis.foundry?.utils?.saveDataToFile;

  if (typeof save === "function") {
    save(json, "application/json", filename);
    return { status: "downloaded", filename, questCount: snapshot.summary.questCount, snapshot };
  }

  const doc = options.document ?? globalThis.document;
  const blobFactory = options.Blob ?? globalThis.Blob;
  const urlFactory = options.URL ?? globalThis.URL;

  if (!doc || typeof blobFactory !== "function" || typeof urlFactory?.createObjectURL !== "function") {
    // No download path available (headless, or tests): the payload is still returned.
    return { status: "no-download-target", filename, questCount: snapshot.summary.questCount, snapshot };
  }

  const url = urlFactory.createObjectURL(new blobFactory([json], { type: "application/json" }));
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (typeof urlFactory.revokeObjectURL === "function") {
    globalThis.setTimeout?.(() => urlFactory.revokeObjectURL(url), 1000);
  }

  return { status: "downloaded", filename, questCount: snapshot.summary.questCount, snapshot };
}

/**
 * @param {object} snapshot A snapshot payload.
 * @returns {string} A filesystem-safe filename.
 */
export function makeSnapshotFilename(snapshot) {
  const world = String(snapshot?.source?.worldId ?? "world").replace(/[^a-z0-9_-]+/gi, "-");
  const stamp = String(snapshot?.capturedAt ?? "").replace(/[:.]/g, "-");
  return `masterquest-snapshot-${world}-${stamp}.json`;
}

function describeQuest(entry, quest) {
  const objectives = toArray(quest.objectives).map((objective) => ({
    id: objective?.id ?? null,
    name: objective?.name ?? "",
    completed: objective?.completed === true,
    failed: objective?.failed === true,
    hidden: objective?.hidden === true
  }));

  return {
    id: entry?.id ?? entry?._id ?? null,
    uuid: entry?.uuid ?? null,
    journalEntryName: entry?.name ?? null,
    folderName: typeof entry?.folder === "string" ? null : entry?.folder?.name ?? null,
    name: quest.name ?? entry?.name ?? "",
    status: quest.status ?? "inactive",
    source: quest.source ?? null,
    parent: quest.parent ?? null,
    subquests: toArray(quest.subquests),
    giverName: quest.giverName ?? "",
    location: quest.location ?? null,
    priority: quest.priority ?? 0,
    description: quest.description ?? "",
    gmnotes: quest.gmnotes ?? "",
    playernotes: quest.playernotes ?? "",
    objectiveCount: objectives.length,
    completedObjectiveCount: objectives.filter((objective) => objective.completed).length,
    objectives,
    rewards: toArray(quest.rewards).map((reward) => ({
      id: reward?.id ?? null,
      name: reward?.name ?? "",
      type: reward?.type ?? null,
      uuid: reward?.uuid ?? null,
      hidden: reward?.hidden === true,
      locked: reward?.locked !== false
    })),
    date: quest.date ?? null,
    ownership: entry?.ownership ? { ...entry.ownership } : {}
  };
}

function describeLegacyFql(entry, payload) {
  const tasks = toArray(payload?.tasks);
  const rewards = toArray(payload?.rewards);

  return {
    id: entry?.id ?? entry?._id ?? null,
    journalEntryName: entry?.name ?? null,
    name: payload?.name ?? null,
    status: payload?.status ?? null,
    parent: payload?.parent ?? null,
    subquests: toArray(payload?.subquests),
    taskCount: tasks.length,
    completedTaskCount: tasks.filter((task) => task?.completed === true).length,
    rewardCount: rewards.length,
    alreadyImported: Boolean(readRawFlag(entry, MODULE_ID, QUEST_FLAG))
  };
}

/**
 * Read a flag off the document data without `getFlag`.
 *
 * `getFlag` rejects scopes whose module is not active, which is exactly the case for
 * `forien-quest-log` on Foundry v14.
 *
 * @param {object} entry A document or plain data.
 * @param {string} scope The flag scope.
 * @param {string} key The flag key.
 * @returns {*} The flag value, or null.
 */
function readRawFlag(entry, scope, key) {
  if (!entry) return null;
  return entry.flags?.[scope]?.[key] ?? null;
}

function countBy(items, pick) {
  return items.reduce((counts, item) => {
    const key = pick(item) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
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
