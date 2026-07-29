import { FQL_FLAG_KEY, FQL_MODULE_ID } from "../constants.js";
import { readQuestStates } from "./read-quest-states.js";

export function readQuestStatesFromSnapshot(snapshot, options = {}) {
  return readQuestStates({
    ...options,
    journal: snapshotToJournalDocuments(snapshot)
  });
}

export function snapshotToJournalDocuments(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.fqlQuests)) {
    return [];
  }

  return snapshot.fqlQuests.map((quest) => ({
    id: quest.id ?? null,
    uuid: quest.uuid ?? (quest.id ? `JournalEntry.${quest.id}` : null),
    name: quest.name ?? quest.fqlPayload?.name ?? "Unnamed quest",
    folder: quest.folderId || quest.folderName
      ? {
          id: quest.folderId ?? null,
          name: quest.folderName ?? null
        }
      : null,
    ownership: cloneData(quest.ownership ?? {}),
    flags: {
      [FQL_MODULE_ID]: {
        [FQL_FLAG_KEY]: cloneData(quest.fqlPayload ?? {})
      },
      ...(quest.olfFlags ? { "outsiders-lost-frontier": cloneData(quest.olfFlags) } : {})
    },
    getFlag(moduleId, key) {
      return this.flags?.[moduleId]?.[key] ?? null;
    }
  }));
}

function cloneData(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}
