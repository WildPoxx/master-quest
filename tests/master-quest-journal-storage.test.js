import assert from "node:assert/strict";
import test from "node:test";
import { MODULE_ID } from "../src/constants.js";
import { createMasterQuestDraft } from "../src/authoring/master-quest-authoring.js";
import {
  MASTER_QUEST_DRAFT_FLAG,
  MASTER_QUEST_PAGE_FLAG,
  MASTER_QUEST_STORAGE_FLAG,
  saveMasterQuestDraftToJournal
} from "../src/foundry/master-quest-journal-storage.js";

function makeCompleteDraft(overrides = {}) {
  return createMasterQuestDraft({
    title: "Black Sun Choir",
    premise: "A future city begins singing in the voice of a dead star-god.",
    dramaticQuestion: "Can the heroes stop the hymn before it rewrites everyone?",
    playerSafeSummary: "A forbidden signal is spreading through the city.",
    objectives: ["Trace the signal.", "Stop the choir."],
    threats: ["The Choir Below"],
    scenes: ["First broadcast", "Glass cathedral"],
    rewards: ["A reclaimed frequency"],
    ...overrides
  });
}

test("saveMasterQuestDraftToJournal creates a folder and JournalEntry with draft pages", async () => {
  const draft = makeCompleteDraft();
  const createdFolders = [];
  const createdJournals = [];
  const Folder = {
    async create(data) {
      const folder = { id: "folder-mq", ...data };
      createdFolders.push(folder);
      return folder;
    }
  };
  const JournalEntry = {
    async create(data) {
      const entry = { id: "journal-mq", uuid: "JournalEntry.journal-mq", ...data };
      createdJournals.push(entry);
      return entry;
    }
  };

  const result = await saveMasterQuestDraftToJournal(draft, {
    game: { folders: [], journal: [] },
    Folder,
    JournalEntry,
    now: "2026-06-20T10:00:00.000Z"
  });

  assert.equal(result.status, "created");
  assert.equal(result.changedFoundryDocuments, true);
  assert.equal(createdFolders[0].name, "MasterQuest Drafts");
  assert.equal(createdFolders[0].type, "JournalEntry");
  assert.equal(createdJournals[0].name, "MasterQuest - Black Sun Choir");
  assert.equal(createdJournals[0].folder, "folder-mq");
  assert.equal(createdJournals[0].pages.length, 4);
  assert.deepEqual(
    createdJournals[0].pages.map((page) => page.flags[MODULE_ID][MASTER_QUEST_PAGE_FLAG]),
    ["briefing", "gm-operations", "player-safe-preview", "masterquest-data"]
  );
  assert.equal(createdJournals[0].flags[MODULE_ID][MASTER_QUEST_DRAFT_FLAG].id, draft.id);
  assert.equal(createdJournals[0].flags[MODULE_ID][MASTER_QUEST_STORAGE_FLAG].savedAt, "2026-06-20T10:00:00.000Z");
});

test("saveMasterQuestDraftToJournal updates an existing MasterQuest JournalEntry", async () => {
  const draft = makeCompleteDraft({ title: "Glass Saint Protocol" });
  const calls = [];
  const existing = {
    id: "journal-existing",
    uuid: "JournalEntry.journal-existing",
    name: "Old Name",
    folder: "folder-mq",
    flags: {
      [MODULE_ID]: {
        [MASTER_QUEST_DRAFT_FLAG]: { id: draft.id }
      }
    },
    pages: [
      {
        id: "page-old",
        name: "Briefing",
        flags: { [MODULE_ID]: { [MASTER_QUEST_PAGE_FLAG]: "briefing" } }
      }
    ],
    getFlag(moduleId, key) {
      return this.flags?.[moduleId]?.[key] ?? null;
    },
    async update(data) {
      calls.push({ type: "update", data });
      Object.assign(this, data);
    },
    async setFlag(moduleId, key, value) {
      calls.push({ type: "setFlag", moduleId, key, value });
      this.flags[moduleId] ??= {};
      this.flags[moduleId][key] = value;
    },
    async deleteEmbeddedDocuments(type, ids) {
      calls.push({ type: "deleteEmbeddedDocuments", docType: type, ids });
    },
    async createEmbeddedDocuments(type, pages) {
      calls.push({ type: "createEmbeddedDocuments", docType: type, pages });
      this.pages = pages;
    }
  };

  const result = await saveMasterQuestDraftToJournal(draft, {
    game: {
      folders: [{ id: "folder-mq", name: "MasterQuest Drafts", type: "JournalEntry" }],
      journal: [existing]
    },
    now: "2026-06-20T11:00:00.000Z"
  });

  assert.equal(result.status, "updated");
  assert.equal(existing.name, "MasterQuest - Glass Saint Protocol");
  assert.ok(calls.some((call) => call.type === "setFlag" && call.key === MASTER_QUEST_DRAFT_FLAG));
  assert.ok(calls.some((call) => call.type === "setFlag" && call.key === MASTER_QUEST_STORAGE_FLAG));
  assert.deepEqual(calls.find((call) => call.type === "deleteEmbeddedDocuments").ids, ["page-old"]);
  assert.equal(calls.find((call) => call.type === "createEmbeddedDocuments").pages.length, 4);
});

test("saveMasterQuestDraftToJournal dry-run prepares payload without creating Foundry documents", async () => {
  const draft = makeCompleteDraft();
  const result = await saveMasterQuestDraftToJournal(draft, {
    game: { folders: [], journal: [] },
    dryRun: true,
    Folder: {
      async create() {
        throw new Error("Folder.create should not run during dry-run");
      }
    },
    JournalEntry: {
      async create() {
        throw new Error("JournalEntry.create should not run during dry-run");
      }
    }
  });

  assert.equal(result.status, "dry-run");
  assert.equal(result.writeMode, "dry-run");
  assert.equal(result.changedFoundryDocuments, false);
  assert.equal(result.payload.pages.length, 4);
  assert.equal(result.payload.flags[MODULE_ID][MASTER_QUEST_DRAFT_FLAG].id, draft.id);
});