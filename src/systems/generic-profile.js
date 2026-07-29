import { MASTER_QUEST_SYSTEM_AGNOSTIC } from "../constants.js";

export function createGenericSystemProfile(systemInput = {}, options = {}) {
  const system = normalizeSystemInput(systemInput);
  const id = cleanText(system.id) || MASTER_QUEST_SYSTEM_AGNOSTIC;
  const isAgnostic = id === MASTER_QUEST_SYSTEM_AGNOSTIC || id === "none";

  if (isAgnostic && options.allowAgnosticNull !== false) {
    return null;
  }

  return {
    id,
    version: cleanText(system.version),
    label: cleanText(system.title ?? system.label ?? system.name) || id,
    mode: cleanText(options.mode ?? system.mode) || "detected",
    source: cleanText(options.source) || "foundry-system",
    adapter: "generic",
    confidence: id === "unknown" ? "low" : "medium",
    capabilities: {
      rulesAware: false,
      readsActors: false,
      readsItems: false,
      readsCombat: false,
      writesSystemDocuments: false
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
