import { MODULE_ID, MODULE_TITLE } from "../constants.js";
import {
  createMasterQuestDraft,
  generateMasterQuestPreview
} from "../authoring/master-quest-authoring.js";
import { mergeDraftIntoQuest } from "../quest/quest-from-draft.js";
import { QUEST_FLAG } from "../quest/quest-store.js";

export const MASTER_QUEST_DRAFT_FLAG = "masterQuestDraft";
export const MASTER_QUEST_STORAGE_FLAG = "masterQuestStorage";
export const MASTER_QUEST_PAGE_FLAG = "masterQuestPage";

const DEFAULT_FOLDER_NAME = "MasterQuest Drafts";
const JOURNAL_ENTRY_TYPE = "JournalEntry";
const PAGE_DEFINITIONS = [
  ["briefing", "Briefing"],
  ["gm-operations", "GM Operations"],
  ["player-safe-preview", "Player-Safe Preview"],
  ["masterquest-data", "MasterQuest Data"]
];

export async function saveMasterQuestDraftToJournal(seedOrDraft = {}, options = {}) {
  const draft = isMasterQuestDraft(seedOrDraft)
    ? seedOrDraft
    : createMasterQuestDraft(seedOrDraft, options);
  const dryRun = options.dryRun === true;
  const game = options.game ?? globalThis.game;
  const now = resolveNow(options.now);
  const folderName = cleanText(options.folderName) || DEFAULT_FOLDER_NAME;
  const journal = options.journal ?? game?.journal;
  const Folder = options.Folder ?? globalThis.Folder;
  const JournalEntry = options.JournalEntry ?? globalThis.JournalEntry;
  const existing = options.journalEntry ?? findExistingDraftJournal(journal, draft, options);
  const folder = await resolveDraftFolder({ game, Folder, folderName, dryRun });
  const previews = resolvePreviews(draft, options);
  const pages = buildDraftPages(draft, previews, options);
  const mode = existing ? "update" : "create";
  const flags = buildDraftFlags(draft, {
    savedAt: now,
    folderName,
    journalEntryId: existing?.id ?? null,
    // Preserve whatever the table already did to this quest in the Log.
    currentQuest: existing ? getFlag(existing, QUEST_FLAG) : null
  });
  const journalEntryName = makeJournalEntryName(draft);

  const baseResult = {
    schemaVersion: 1,
    mode: "journal-draft-storage",
    status: dryRun ? "dry-run" : "pending",
    writeMode: dryRun ? "dry-run" : "journal",
    operation: mode,
    draftId: draft.id,
    title: draft.title,
    folderName,
    folderId: folder?.id ?? folder?._id ?? null,
    journalEntryId: existing?.id ?? null,
    journalEntryUuid: existing?.uuid ?? null,
    journalEntryName,
    pageCount: pages.length,
    changedFoundryDocuments: false,
    safety: [
      "This operation only writes MasterQuest draft storage.",
      "No FQL payload is read or written.",
      "No quest status, actor, item, combat, or setting is changed.",
      "The GM must explicitly click Save to Journal."
    ]
  };

  if (dryRun) {
    return {
      ...baseResult,
      payload: makeJournalPayload({ draft, pages, flags, folder, journalEntryName })
    };
  }

  if (!existing && typeof JournalEntry?.create !== "function") {
    return {
      ...baseResult,
      status: "blocked",
      reason: "missing-journal-entry-create"
    };
  }

  try {
    if (existing) {
      await updateJournalEntry(existing, { draft, pages, flags, folder, journalEntryName });
      return {
        ...baseResult,
        status: "updated",
        changedFoundryDocuments: true,
        journalEntryId: existing.id ?? existing._id ?? null,
        journalEntryUuid: existing.uuid ?? null
      };
    }

    const created = await JournalEntry.create(makeJournalPayload({
      draft,
      pages,
      flags,
      folder,
      journalEntryName
    }));

    return {
      ...baseResult,
      status: "created",
      changedFoundryDocuments: true,
      journalEntryId: created?.id ?? created?._id ?? null,
      journalEntryUuid: created?.uuid ?? null
    };
  } catch (err) {
    return {
      ...baseResult,
      status: "failed",
      error: String(err?.message ?? err)
    };
  }
}

export function buildMasterQuestDraftJournalPages(draftInput = {}, options = {}) {
  const draft = isMasterQuestDraft(draftInput) ? draftInput : createMasterQuestDraft(draftInput, options);
  return buildDraftPages(draft, resolvePreviews(draft, options), options);
}

function resolvePreviews(draft, options) {
  return {
    gm: options.gmPreview ?? generateMasterQuestPreview(draft, { ...options, audience: "gm" }),
    playerSafe: options.playerSafePreview ?? generateMasterQuestPreview(draft, { ...options, audience: "player-safe" })
  };
}

async function resolveDraftFolder({ game, Folder, folderName, dryRun }) {
  const existing = findFolder(game?.folders, folderName);
  if (existing || dryRun) {
    return existing ?? { id: null, name: folderName, type: JOURNAL_ENTRY_TYPE };
  }

  if (typeof Folder?.create !== "function") {
    return null;
  }

  return Folder.create({
    name: folderName,
    type: JOURNAL_ENTRY_TYPE,
    sorting: "a"
  });
}

function findFolder(folders, folderName) {
  return toArray(folders).find((folder) =>
    folder?.name === folderName && (!folder.type || folder.type === JOURNAL_ENTRY_TYPE)
  ) ?? null;
}

function findExistingDraftJournal(journal, draft, options = {}) {
  const folderId = options.folderId ?? null;
  const documents = toArray(journal);

  return documents.find((entry) => {
    const storedDraft = getFlag(entry, MASTER_QUEST_DRAFT_FLAG);
    return storedDraft?.id === draft.id;
  }) ?? documents.find((entry) => {
    if (folderId && normalizeId(entry.folder) !== folderId) return false;
    return entry?.name === makeJournalEntryName(draft) || entry?.name === draft.title;
  }) ?? null;
}

function makeJournalPayload({ pages, flags, folder, journalEntryName }) {
  const folderId = folder?.id ?? folder?._id ?? null;

  return {
    name: journalEntryName,
    folder: folderId,
    pages,
    flags
  };
}

async function updateJournalEntry(entry, { draft, pages, flags, folder, journalEntryName }) {
  const folderId = folder?.id ?? folder?._id ?? null;
  if (typeof entry.update === "function") {
    await entry.update({
      name: journalEntryName,
      folder: folderId
    });
  } else {
    entry.name = journalEntryName;
    entry.folder = folderId;
  }

  await setMasterQuestFlags(entry, flags[MODULE_ID], draft);
  await replaceMasterQuestPages(entry, pages);
}

async function setMasterQuestFlags(entry, moduleFlags, draft) {
  if (typeof entry.setFlag === "function") {
    await entry.setFlag(MODULE_ID, MASTER_QUEST_DRAFT_FLAG, draft);
    await entry.setFlag(MODULE_ID, QUEST_FLAG, moduleFlags[QUEST_FLAG]);
    await entry.setFlag(MODULE_ID, MASTER_QUEST_STORAGE_FLAG, moduleFlags[MASTER_QUEST_STORAGE_FLAG]);
    return;
  }

  entry.flags = mergeObjects(entry.flags, {
    [MODULE_ID]: moduleFlags
  });
}

async function replaceMasterQuestPages(entry, pages) {
  const existingPages = toArray(entry.pages);
  const replaceIds = existingPages
    .filter((page) => getFlag(page, MASTER_QUEST_PAGE_FLAG) || PAGE_DEFINITIONS.some(([, name]) => page?.name === name))
    .map((page) => page.id ?? page._id)
    .filter(Boolean);

  if (replaceIds.length && typeof entry.deleteEmbeddedDocuments === "function") {
    await entry.deleteEmbeddedDocuments("JournalEntryPage", replaceIds);
  }

  if (typeof entry.createEmbeddedDocuments === "function") {
    await entry.createEmbeddedDocuments("JournalEntryPage", pages);
    return;
  }

  if (typeof entry.update === "function") {
    await entry.update({ pages });
    return;
  }

  entry.pages = pages;
}

function buildDraftPages(draft, previews, options) {
  const htmlFormat = options.htmlFormat ?? globalThis.CONST?.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1;
  const pageContents = {
    briefing: renderBriefingHtml(draft),
    "gm-operations": markdownToHtml(previews.gm.markdown),
    "player-safe-preview": markdownToHtml(previews.playerSafe.markdown),
    "masterquest-data": renderJsonHtml(draft)
  };

  return PAGE_DEFINITIONS.map(([key, name], index) => ({
    name,
    type: "text",
    sort: (index + 1) * 100000,
    title: {
      show: true,
      level: 1
    },
    text: {
      format: htmlFormat,
      content: pageContents[key]
    },
    flags: {
      [MODULE_ID]: {
        [MASTER_QUEST_PAGE_FLAG]: key
      }
    }
  }));
}

function renderBriefingHtml(draft) {
  return [
    `<h1>${escapeHtml(draft.title)}</h1>`,
    renderParagraph("Premise", draft.premise),
    renderParagraph("Dramatic Question", draft.dramaticQuestion),
    renderParagraph("Player-Safe Summary", draft.playerSafeSummary),
    renderList("Objectives", draft.objectives.map((objective) => objective.title)),
    renderList("Threats", draft.threats.map((threat) => threat.label)),
    renderList("Scenes", draft.scenes.map((scene) => scene.title))
  ].filter(Boolean).join("\n");
}

function markdownToHtml(markdown) {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const html = [];
  let listOpen = false;

  for (const line of lines) {
    if (line.startsWith("# ")) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      html.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
    } else if (line.startsWith("## ")) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      html.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
    } else if (line.startsWith("- ")) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${escapeHtml(line.slice(2))}</li>`);
    } else if (cleanText(line)) {
      if (listOpen) {
        html.push("</ul>");
        listOpen = false;
      }
      html.push(`<p>${escapeHtml(line)}</p>`);
    }
  }

  if (listOpen) {
    html.push("</ul>");
  }

  return html.join("\n");
}

function renderJsonHtml(value) {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

function renderParagraph(label, value) {
  const text = cleanText(value);
  if (!text) return "";
  return `<h2>${escapeHtml(label)}</h2>\n<p>${escapeHtml(text)}</p>`;
}

function renderList(label, values) {
  const items = values.map(cleanText).filter(Boolean);
  if (!items.length) return "";
  return `<h2>${escapeHtml(label)}</h2>\n<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function buildDraftFlags(draft, { savedAt, folderName, journalEntryId, currentQuest = null }) {
  return {
    [MODULE_ID]: {
      [MASTER_QUEST_DRAFT_FLAG]: cloneData(draft),
      // Authoring and the Quest Log are one pipeline: saving a draft registers the quest
      // so it shows up where the table is actually run, instead of only in the Journal.
      [QUEST_FLAG]: mergeDraftIntoQuest(currentQuest, draft),
      [MASTER_QUEST_STORAGE_FLAG]: {
        schemaVersion: 1,
        app: MODULE_TITLE,
        draftId: draft.id,
        savedAt,
        folderName,
        journalEntryId,
        storageVersion: 1
      }
    }
  };
}

function makeJournalEntryName(draft) {
  return `${MODULE_TITLE} - ${draft.title}`;
}

function getFlag(document, key) {
  if (!document) return null;
  if (typeof document.getFlag === "function") {
    return document.getFlag(MODULE_ID, key);
  }
  return document.flags?.[MODULE_ID]?.[key] ?? null;
}

function normalizeId(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  return value.id ?? value._id ?? null;
}

function mergeObjects(a, b) {
  return {
    ...(a ?? {}),
    ...(b ?? {}),
    [MODULE_ID]: {
      ...(a?.[MODULE_ID] ?? {}),
      ...(b?.[MODULE_ID] ?? {})
    }
  };
}

function resolveNow(now) {
  if (typeof now === "function") {
    return now();
  }
  return now ?? new Date().toISOString();
}

function cloneData(value) {
  if (value == null) return value;
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value));
}

function isMasterQuestDraft(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && value.scope === "quest"
    && value.source === "native"
    && Array.isArray(value.objectives)
    && Array.isArray(value.threats);
}

function toArray(collection) {
  if (collection == null) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
