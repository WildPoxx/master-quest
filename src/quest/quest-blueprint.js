/**
 * Quest blueprints: adventures authored outside Foundry, imported into the Journal.
 *
 * The database of MasterQuest is the Journal. A blueprint is a reviewable data contract
 * that becomes JournalEntries carrying `flags["master-quest"].quest` — MasterQuest then
 * reads those flags. The blueprint is never the live state; the Journal is.
 *
 * Two rules govern the import:
 *
 * 1. It is idempotent, keyed by `designId` (e.g. "MQ-ATO1-01"). Re-importing a revised
 *    blueprint updates text and structure, never duplicating quests.
 * 2. It never overwrites table state. Status, completed objectives, player notes and
 *    quest giver belong to the table and survive every re-import.
 *
 * Nothing is written without an explicit apply. `planBlueprintImport` is pure reading.
 */

import { MODULE_ID } from "../constants.js";
import { QUEST_FLAG, QUEST_FOLDER_NAME } from "./quest-store.js";
import { QUEST_STATUS, normalizeQuest } from "./quest-schema.js";
import { AUTHORED_BY_BLUEPRINT, mergeQuest } from "./merge-quest.js";

const JOURNAL_ENTRY_TYPE = "JournalEntry";

/**
 * Read a blueprint and report what an import would do, without touching anything.
 *
 * @param {object} options
 * @param {object} options.blueprint The blueprint payload.
 * @param {object} [options.game] The Foundry game object.
 * @returns {object} `{status, blueprintId, total, create, update, entries, missingJournalLinks, issues}`.
 */
export function planBlueprintImport({ blueprint, game = globalThis.game } = {}) {
  const issues = validateBlueprint(blueprint);
  if (issues.some((issue) => issue.severity === "error")) {
    return { status: "invalid", blueprintId: blueprint?.blueprintId ?? null, total: 0, create: 0, update: 0, entries: [], missingJournalLinks: [], issues };
  }

  const journal = collectionToArray(game?.journal);
  const existingByDesignId = indexByDesignId(journal);
  const journalNames = new Set(journal.map((entry) => entry?.name).filter(Boolean));
  const missingJournalLinks = [];

  const entries = toArray(blueprint.quests).map((spec) => {
    const existing = existingByDesignId.get(spec.designId) ?? null;
    const current = existing ? readQuestFlag(existing) : null;

    for (const link of toArray(spec.journalLinks)) {
      const name = typeof link === "string" ? link : link?.name;
      if (name && !journalNames.has(name)) {
        missingJournalLinks.push({ designId: spec.designId, name });
      }
    }

    return {
      designId: spec.designId,
      name: spec.name,
      type: spec.type ?? null,
      operation: existing ? "update" : "create",
      journalEntryId: existing?.id ?? existing?._id ?? null,
      // What the table owns and the import will leave alone.
      preserved: current
        ? {
            status: current.status,
            completedObjectives: toArray(current.objectives).filter((o) => o?.completed === true).length,
            hasPlayerNotes: Boolean(current.playernotes)
          }
        : null,
      blueprintStatus: spec.status ?? QUEST_STATUS.inactive
    };
  });

  return {
    status: "ok",
    blueprintId: blueprint.blueprintId ?? null,
    title: blueprint.title ?? null,
    folderName: blueprint.folderName || QUEST_FOLDER_NAME,
    total: entries.length,
    create: entries.filter((entry) => entry.operation === "create").length,
    update: entries.filter((entry) => entry.operation === "update").length,
    entries,
    missingJournalLinks,
    issues
  };
}

/**
 * Apply a blueprint to the world.
 *
 * @param {object} options
 * @param {object} options.blueprint The blueprint payload.
 * @param {object} [options.game] The Foundry game object.
 * @param {boolean} [options.dryRun] When true, nothing is written. Defaults to false.
 * @param {object} [options.JournalEntry] Injectable document class.
 * @param {object} [options.Folder] Injectable folder class.
 * @returns {Promise<object>} `{status, created, updated, failed, results, plan}`.
 */
export async function applyBlueprintImport({
  blueprint,
  game = globalThis.game,
  dryRun = false,
  JournalEntry = globalThis.JournalEntry,
  Folder = globalThis.Folder
} = {}) {
  const plan = planBlueprintImport({ blueprint, game });
  if (plan.status !== "ok") return { status: "invalid", created: 0, updated: 0, failed: 0, results: [], plan };
  if (dryRun) return { status: "dry-run", created: 0, updated: 0, failed: 0, results: [], plan };

  const journal = collectionToArray(game?.journal);
  const existingByDesignId = indexByDesignId(journal);
  const folder = await ensureFolder({ game, Folder, folderName: plan.folderName });
  const folderId = folder?.id ?? folder?._id ?? null;
  const results = [];
  // designId -> JournalEntry id, so the second pass can wire parents and subquests.
  const idByDesignId = new Map();

  for (const spec of toArray(blueprint.quests)) {
    const existing = existingByDesignId.get(spec.designId) ?? null;
    const { quest: merged, orphans } = mergeBlueprintIntoQuestWithOrphans(
      existing ? readQuestFlag(existing) : null,
      spec
    );
    // Item que a mesa tem e o blueprint deixou de listar sobrevive na quest. Reportamos
    // para o Mestre saber que a fonte e o mundo divergiram — nunca apagamos em silencio.
    //
    // 0.25: o relatorio passa a cobrir as SEIS colecoes que `mergeQuest` devolve. Ate a
    // 0.23 lia so `objectives` e `rewards` — resto da epoca em que so existiam essas duas.
    // A DEC-035 criou dilemmas, clues, complications e outcomes, e a divergencia dessas
    // quatro sumia aqui: o item sobrevivia na quest (correto) mas a NOTICIA morria nesta
    // linha. Achado do Backlog Ops em 2026-08-06.
    const orphanReport = summarizeOrphans(orphans);

    try {
      if (existing) {
        await writeQuest(existing, merged, { name: spec.name });
        idByDesignId.set(spec.designId, existing.id ?? existing._id);
        results.push({
          designId: spec.designId,
          outcome: "updated",
          journalEntryId: existing.id ?? existing._id,
          ...(orphanReport ?? {})
        });
        continue;
      }

      if (typeof JournalEntry?.create !== "function") {
        results.push({ designId: spec.designId, outcome: "failed", error: "missing-journal-entry-create" });
        continue;
      }

      const created = await JournalEntry.create({
        name: spec.name,
        folder: folderId,
        flags: { [MODULE_ID]: { [QUEST_FLAG]: merged } }
      });
      const createdId = created?.id ?? created?._id ?? null;
      if (createdId) idByDesignId.set(spec.designId, createdId);
      results.push({ designId: spec.designId, outcome: "created", journalEntryId: createdId });
    } catch (error) {
      results.push({ designId: spec.designId, outcome: "failed", error: String(error?.message ?? error) });
    }
  }

  // Second pass: parents and subquests can only be wired once every entry has an id.
  await linkHierarchy({ blueprint, game, idByDesignId, results });

  return {
    status: "done",
    created: results.filter((result) => result.outcome === "created").length,
    updated: results.filter((result) => result.outcome === "updated").length,
    failed: results.filter((result) => result.outcome === "failed").length,
    results,
    plan
  };
}

/**
 * Merge a blueprint spec into an existing quest, preserving table state.
 *
 * @param {object|null} current The quest currently stored, if any.
 * @param {object} spec The blueprint entry.
 * @returns {object} A normalized quest.
 */
export function mergeBlueprintIntoQuest(current, spec) {
  return mergeBlueprintIntoQuestWithOrphans(current, spec).quest;
}

/**
 * Resume os orfaos devolvidos pelo merge num objeto plano para `results[]`.
 *
 * Mantem `orphanObjectives`/`orphanRewards` (contrato de quem ja lia o resultado antes da
 * 0.25) e acrescenta `orphans`, com as seis colecoes — que e o que a UI passa a mostrar.
 *
 * @param {object} orphans O `orphans` de `mergeQuest`.
 * @returns {object|null} O resumo, ou null quando nada divergiu.
 */
export function summarizeOrphans(orphans) {
  if (!orphans) return null;
  const keys = ["objectives", "rewards", "dilemmas", "clues", "complications", "outcomes"];
  const kept = {};
  let total = 0;
  for (const key of keys) {
    const items = toArray(orphans[key]);
    if (!items.length) continue;
    kept[key] = items;
    total += items.length;
  }
  if (!total) return null;
  return {
    orphanObjectives: toArray(orphans.objectives).map((o) => o?.name ?? ""),
    orphanRewards: toArray(orphans.rewards).map((r) => r?.name ?? ""),
    orphanCount: total,
    orphans: kept
  };
}

/**
 * Como `mergeBlueprintIntoQuest`, mas devolve tambem os itens que a mesa tem e o blueprint
 * deixou de listar. Eles NAO sao apagados — sobrevivem na quest e sao reportados, na mesma
 * filosofia com que `journalLinks` ausente e reportado e nunca descartado em silencio.
 *
 * @param {object|null} current A quest gravada, se houver.
 * @param {object} spec A entrada do blueprint.
 * @returns {{quest: object, orphans: {objectives: object[], rewards: object[]}}}
 */
export function mergeBlueprintIntoQuestWithOrphans(current, spec) {
  const authored = normalizeQuest({
    designId: spec.designId,
    name: spec.name,
    type: spec.type ?? null,
    status: spec.status ?? QUEST_STATUS.inactive,
    priority: spec.priority ?? 0,
    description: spec.description ?? "",
    gmnotes: spec.gmnotes ?? "",
    objectives: toArray(spec.objectives).map((objective) => ({
      id: objective?.id ?? slugId(spec.designId, objective?.name),
      name: objective?.name ?? "",
      hidden: objective?.hidden
    })),
    rewards: toArray(spec.rewards),
    activationTriggers: toArray(spec.activationTriggers),
    journalLinks: toArray(spec.journalLinks),
    source: "blueprint"
  });

  return mergeQuest(current, authored, { authoredBy: AUTHORED_BY_BLUEPRINT, matchBy: "id" });
}

async function linkHierarchy({ blueprint, game, idByDesignId, results }) {
  const journal = collectionToArray(game?.journal);
  const byId = new Map(journal.map((entry) => [entry?.id ?? entry?._id, entry]));
  const childrenByParent = new Map();

  for (const spec of toArray(blueprint.quests)) {
    if (!spec.parent) continue;
    const childId = idByDesignId.get(spec.designId);
    const parentId = idByDesignId.get(spec.parent);
    if (!childId || !parentId) {
      results.push({ designId: spec.designId, outcome: "link-skipped", reason: "missing-id" });
      continue;
    }
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, []);
    childrenByParent.get(parentId).push(childId);

    const entry = byId.get(childId);
    const quest = entry ? readQuestFlag(entry) : null;
    if (entry && quest) await writeQuest(entry, normalizeQuest({ ...quest, parent: parentId }));
  }

  for (const [parentId, children] of childrenByParent) {
    const entry = byId.get(parentId);
    const quest = entry ? readQuestFlag(entry) : null;
    if (entry && quest) await writeQuest(entry, normalizeQuest({ ...quest, subquests: children }));
  }
}

/**
 * Check a blueprint for structural problems before anything is written.
 *
 * @param {object} blueprint The blueprint payload.
 * @returns {Array<object>} Issues, each `{severity, code, message, designId}`.
 */
export function validateBlueprint(blueprint) {
  const issues = [];
  if (!isRecord(blueprint)) {
    return [{ severity: "error", code: "not-an-object", message: "O blueprint não é um objeto.", designId: null }];
  }

  const quests = toArray(blueprint.quests);
  if (!quests.length) {
    issues.push({ severity: "error", code: "no-quests", message: "O blueprint não tem quests.", designId: null });
  }

  const seen = new Set();
  const designIds = new Set(quests.map((quest) => quest?.designId).filter(Boolean));

  for (const quest of quests) {
    const designId = quest?.designId ?? null;
    if (!designId) {
      issues.push({ severity: "error", code: "missing-design-id", message: "Quest sem designId.", designId: null });
      continue;
    }
    if (seen.has(designId)) {
      issues.push({ severity: "error", code: "duplicate-design-id", message: `designId repetido: ${designId}.`, designId });
    }
    seen.add(designId);

    if (!String(quest?.name ?? "").trim()) {
      issues.push({ severity: "error", code: "missing-name", message: `Quest ${designId} sem nome.`, designId });
    }
    if (quest?.status && !QUEST_STATUS[quest.status]) {
      issues.push({ severity: "error", code: "invalid-status", message: `Status inválido em ${designId}: ${quest.status}.`, designId });
    }
    if (quest?.parent && !designIds.has(quest.parent)) {
      issues.push({ severity: "error", code: "missing-parent", message: `Parent inexistente em ${designId}: ${quest.parent}.`, designId });
    }
    if (quest?.parent === designId) {
      issues.push({ severity: "error", code: "self-parent", message: `Quest ${designId} é pai de si mesma.`, designId });
    }
    if (!toArray(quest?.objectives).length && quest?.type !== "side") {
      issues.push({ severity: "warning", code: "no-objectives", message: `Quest ${designId} não tem objetivos.`, designId });
    }
  }

  return issues;
}

/** Blueprints shipped inside the module. */
export const BUNDLED_BLUEPRINTS = Object.freeze({
  "ecos-da-torre": `modules/${MODULE_ID}/data/blueprints/ecos-da-torre.quest-blueprint.json`
});

/**
 * Load a blueprint shipped with the module.
 *
 * @param {string} blueprintId Key of `BUNDLED_BLUEPRINTS`.
 * @param {object} [options]
 * @param {Function} [options.fetch] Injectable fetch.
 * @returns {Promise<object|null>} The blueprint, or null when unavailable.
 */
export async function loadBundledBlueprint(blueprintId, { fetch = globalThis.fetch } = {}) {
  const path = BUNDLED_BLUEPRINTS[blueprintId];
  if (!path || typeof fetch !== "function") return null;

  const response = await fetch(path);
  if (!response?.ok) return null;
  return response.json();
}

function indexByDesignId(journal) {
  const index = new Map();
  for (const entry of journal) {
    const designId = readQuestFlag(entry)?.designId;
    if (designId && !index.has(designId)) index.set(designId, entry);
  }
  return index;
}

function readQuestFlag(entry) {
  return entry?.flags?.[MODULE_ID]?.[QUEST_FLAG] ?? null;
}

async function writeQuest(entry, quest, { name = null } = {}) {
  if (typeof entry.update === "function") {
    const payload = { flags: { [MODULE_ID]: { [QUEST_FLAG]: quest } } };
    if (name) payload.name = name;
    await entry.update(payload);
    return;
  }
  entry.flags ??= {};
  entry.flags[MODULE_ID] ??= {};
  entry.flags[MODULE_ID][QUEST_FLAG] = quest;
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

/** Stable objective id derived from the quest and the objective text, so re-import matches. */
function slugId(designId, name) {
  const slug = String(name ?? "")
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${designId}-${slug}`.toLocaleLowerCase();
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
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
