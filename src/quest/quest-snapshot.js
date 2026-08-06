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

/**
 * 1 -> 2 (0.19.0): o payload ganhou `scope` e cada quest ganhou `gmcomments`.
 */
export const SNAPSHOT_SCHEMA_VERSION = 2;

/**
 * Build the snapshot payload.
 *
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @param {string} [options.capturedAt] ISO timestamp, injectable for tests.
 * @param {string|null} [options.questId] Capture only this quest and its subquest tree.
 * @returns {object} The snapshot.
 */
export function buildQuestSnapshot({ game = globalThis.game, capturedAt = null, questId = null } = {}) {
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

  // Recorte por quest (0.19.0): a janela de uma quest exporta ELA e a arvore de subquests
  // abaixo dela, nao o log inteiro. O snapshot geral continua sendo o do Hub. Quando ha
  // recorte, o corpus legado do FQL fica de fora: ele nao pertence a esta arvore, e
  // arrasta-lo junto faria o arquivo mentir sobre o proprio escopo.
  const scoped = questId ? scopeToQuestTree(quests, questId) : quests;
  const scopedLegacy = questId ? [] : legacyFqlQuests;

  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    app: MODULE_TITLE,
    capturedAt: capturedAt ?? new Date().toISOString(),
    scope: questId
      ? {
          mode: "single-quest",
          rootQuestId: questId,
          rootQuestName: scoped.find((quest) => quest.id === questId)?.name ?? null
        }
      : { mode: "all-quests", rootQuestId: null, rootQuestName: null },
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
      questCount: scoped.length,
      statusCounts: countBy(scoped, (quest) => quest.status),
      objectiveCount: scoped.reduce((total, quest) => total + quest.objectives.length, 0),
      completedObjectiveCount: scoped.reduce(
        (total, quest) => total + quest.objectives.filter((objective) => objective.completed).length,
        0
      ),
      legacyFqlQuestCount: scopedLegacy.length
    },
    quests: scoped,
    legacyFqlQuests: scopedLegacy
  };
}

/**
 * A quest pedida e tudo que pende dela, por travessia em largura.
 *
 * `seen` existe porque a arvore de quests e desenhada a mao pelo Mestre e nada impede
 * que uma subquest apareca em dois pais, ou que um ciclo se forme numa reorganizacao.
 * Sem a guarda, um ciclo travaria o Foundry; com ela, o snapshot sai com cada quest uma
 * vez so. Uma raiz inexistente devolve lista vazia, nao o log inteiro.
 *
 * @param {object[]} quests Every described quest in the world.
 * @param {string} rootId The quest to start from.
 * @returns {object[]} The root and its subquest tree.
 */
function scopeToQuestTree(quests, rootId) {
  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  const tree = [];
  const seen = new Set();
  const queue = [rootId];

  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const quest = byId.get(id);
    if (!quest) continue;

    tree.push(quest);
    for (const child of toArray(quest.subquests)) queue.push(child);
  }

  return tree;
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
  // Com recorte, o nome da quest entra no arquivo: dois snapshots do mesmo mundo no mesmo
  // minuto sao coisas diferentes, e quem for procurar depois procura pelo nome da quest.
  const quest = slugForFilename(snapshot?.scope?.rootQuestName);
  return `masterquest-snapshot-${world}${quest ? `-${quest}` : ""}-${stamp}.json`;
}

/**
 * @param {*} value A quest name, or nothing.
 * @returns {string} An ASCII, filesystem-safe slug, or "".
 */
function slugForFilename(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);
}

function describeQuest(entry, quest) {
  const objectives = toArray(quest.objectives).map((objective) => ({
    id: objective?.id ?? null,
    name: objective?.name ?? "",
    completed: objective?.completed === true,
    failed: objective?.failed === true,
    hidden: objective?.hidden === true,
    known: objective?.known === true
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
    // DEC-028: os dois campos saem marcados pela origem. `gmnotes` e fonte (fasciculo,
    // sobrescrito por reimportacao); `gmcomments` e mesa, e so existe a partir da 0.19.0 —
    // flag antigo o entrega vazio, que e a verdade sobre ele.
    gmnotes: quest.gmnotes ?? "",
    gmcomments: quest.gmcomments ?? "",
    playernotes: quest.playernotes ?? "",
    objectiveCount: objectives.length,
    // 0.20.1: a chave pela qual a reimportacao de blueprint reconhece a quest. Sem ela o
    // snapshot nao permitia rastrear quest <-> fonte. Aditivo; leitores antigos ignoram.
    designId: quest.designId ?? null,
    completedObjectiveCount: objectives.filter((objective) => objective.completed).length,
    objectives,
    rewards: toArray(quest.rewards).map((reward) => ({
      id: reward?.id ?? null,
      name: reward?.name ?? "",
      type: reward?.type ?? null,
      uuid: reward?.uuid ?? null,
      hidden: reward?.hidden === true,
      granted: reward?.granted === true,
      known: reward?.known === true,
      locked: reward?.locked !== false
    })),
    // DEC-035/0.22.0: problems virou dilemmas (Mario, 2026-08-05); clues, outcomes e log
    // entram aditivos — leitores antigos ignoram.
    dilemmas: toArray(quest.dilemmas).map((dilemma) => ({
      id: dilemma?.id ?? null,
      name: dilemma?.name ?? "",
      state: dilemma?.state === "resolved" ? "resolved" : "open",
      // 0.23: gradacao autoral, mesma escada da complicacao.
      severity: dilemma?.severity ?? "leve",
      resolution: dilemma?.resolution ?? "",
      table: dilemma?.table ?? "",
      hidden: dilemma?.hidden !== false,
      known: dilemma?.known === true
    })),
    clues: toArray(quest.clues).map((clue) => ({
      id: clue?.id ?? null,
      name: clue?.name ?? "",
      found: clue?.found === true,
      hidden: clue?.hidden !== false,
      known: clue?.known === true
    })),
    outcomes: toArray(quest.outcomes).map((outcome) => ({
      id: outcome?.id ?? null,
      name: outcome?.name ?? "",
      occurred: outcome?.occurred === true,
      record: outcome?.record ?? "",
      table: outcome?.table ?? "",
      hidden: outcome?.hidden !== false,
      known: outcome?.known === true
    })),
    log: toArray(quest.log).map((entry) => ({ ...entry })),
    // 0.23: tempo de mesa e encerramento editorial, aditivos — leitores antigos ignoram.
    sessions: toArray(quest.sessions).map((session) => ({ ...session })),
    wrappedUp: quest.wrappedUp === true,
    complications: toArray(quest.complications).map((complication) => ({
      id: complication?.id ?? null,
      name: complication?.name ?? "",
      trigger: complication?.trigger ?? "",
      severity: complication?.severity ?? "leve",
      fired: complication?.fired === true,
      hidden: complication?.hidden !== false,
      known: complication?.known === true
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
