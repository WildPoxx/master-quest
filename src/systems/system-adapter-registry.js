import { MASTER_QUEST_SYSTEM_AGNOSTIC, SWADE_SYSTEM_ID } from "../constants.js";
import { createGenericSystemProfile } from "./generic-profile.js";
import { createSwadeSystemProfile } from "./swade-profile.js";

const ADAPTERS = Object.freeze({
  [SWADE_SYSTEM_ID]: createSwadeSystemProfile
});

export function createSystemProfile(systemInput = {}, options = {}) {
  const id = cleanSystemId(systemInput);
  if (!id || id === MASTER_QUEST_SYSTEM_AGNOSTIC || id === "none") {
    return null;
  }

  const adapter = ADAPTERS[id] ?? createGenericSystemProfile;
  return adapter(systemInput, options);
}

export function getRegisteredSystemAdapterIds() {
  return Object.keys(ADAPTERS);
}

function cleanSystemId(systemInput) {
  if (typeof systemInput === "string") {
    return systemInput.trim();
  }

  if (systemInput !== null && typeof systemInput === "object") {
    return String(systemInput.id ?? systemInput.system ?? systemInput.name ?? "").trim();
  }

  return "";
}
