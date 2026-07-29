import { SWADE_SYSTEM_ID, SWADE_SYSTEM_VERSION } from "../constants.js";

export const SWADE_MECHANICAL_TOPICS = Object.freeze([
  "Bennies",
  "Wild Die",
  "Support",
  "Quick Encounters",
  "Chases",
  "Dramatic Tasks",
  "Fear",
  "Hazards",
  "Interludes",
  "Mass Battles",
  "Networking",
  "Social Conflict",
  "Travel"
]);

export function createSwadeSystemProfile(systemInput = {}, options = {}) {
  const system = normalizeSystemInput(systemInput);

  return {
    id: SWADE_SYSTEM_ID,
    version: cleanText(system.version) || SWADE_SYSTEM_VERSION,
    label: cleanText(system.title ?? system.label ?? system.name) || "SWADE",
    mode: cleanText(options.mode ?? system.mode) || "detected",
    source: cleanText(options.source) || "foundry-system",
    adapter: "swade",
    confidence: "high",
    capabilities: {
      rulesAware: true,
      readsActors: true,
      readsItems: true,
      readsCombat: true,
      readsCards: true,
      readsJournalPageTypes: true,
      writesSystemDocuments: false
    },
    mechanics: {
      suggestedSceneProcedures: [
        "quick-encounter",
        "dramatic-task",
        "chase",
        "social-conflict",
        "hazard",
        "combat"
      ],
      knownRuntimeFeatures: [
        "Combat.chase",
        "Combat.dramaticTask",
        "Benny automation",
        "Joker logic",
        "JournalEntryPage.headquarters"
      ]
    },
    suggestions: toTextArray(system.suggestions)
  };
}

function normalizeSystemInput(value) {
  if (typeof value === "string") {
    return { id: value };
  }

  if (isPlainObject(value)) {
    return value;
  }

  return {};
}

function cleanText(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function toTextArray(value) {
  if (value == null) {
    return [];
  }

  const list = Array.isArray(value) ? value : [value];
  return list.map(cleanText).filter(Boolean);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
