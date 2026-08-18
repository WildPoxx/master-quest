import { MODULE_ID } from "../constants.js";

/** World setting that selects the shared MasterQuest interface skin. */
export const INTERFACE_SKIN_SETTING = "interfaceSkin";

export const INTERFACE_SKINS = Object.freeze({
  parchment: "pergaminho",
  cosmic: "cosmic",
  sciFi: "sci-fi",
  modernInvestigation: "investigacao-moderna",
  medievalFantasy: "fantasia-medieval"
});

const INTERFACE_SKIN_CHOICES = Object.freeze({
  [INTERFACE_SKINS.parchment]: "Pergaminho Hyboriano",
  [INTERFACE_SKINS.cosmic]: "Cosmic",
  [INTERFACE_SKINS.sciFi]: "Futurista",
  [INTERFACE_SKINS.modernInvestigation]: "Investigação Contemporânea",
  [INTERFACE_SKINS.medievalFantasy]: "Fantasia Medieval"
});

/**
 * Keep a malformed or removed setting from leaking an arbitrary selector into the UI.
 *
 * @param {unknown} value Raw persisted setting value.
 * @returns {string} A supported skin id.
 */
export function normalizeInterfaceSkin(value) {
  return Object.values(INTERFACE_SKINS).includes(value)
    ? value
    : INTERFACE_SKINS.parchment;
}

/**
 * Read the currently active skin without making a setting lookup a requirement for tests.
 *
 * @param {object} [options]
 * @param {object} [options.game] Foundry game object.
 * @returns {string} A supported skin id.
 */
export function getInterfaceSkin({ game = globalThis.game } = {}) {
  const value = game?.settings?.get?.(MODULE_ID, INTERFACE_SKIN_SETTING);
  return normalizeInterfaceSkin(value);
}

/**
 * Apply the skin at MasterQuest's own application root. This deliberately never writes
 * to document.body, so a skin cannot affect Foundry or another module.
 *
 * @param {HTMLElement} element An application content element or its root.
 * @param {object} [options]
 * @param {object} [options.game] Foundry game object.
 * @returns {string|null} The applied skin, or null when this is not a MasterQuest root.
 */
export function applyInterfaceSkin(element, { game = globalThis.game } = {}) {
  const root = element?.matches?.(".masterquest")
    ? element
    : element?.closest?.(".masterquest");
  if (!root?.dataset) return null;

  const skin = getInterfaceSkin({ game });
  root.dataset.mqSkin = skin;
  return skin;
}

/** Update already-open MasterQuest windows immediately after the GM changes the setting. */
export function refreshOpenMasterQuestSkins({
  game = globalThis.game,
  document = globalThis.document
} = {}) {
  const roots = document?.querySelectorAll?.(".masterquest") ?? [];
  for (const root of roots) applyInterfaceSkin(root, { game });
}

/** Register the small native Game Settings control for the visual layer (DEC-018). */
export function registerInterfaceSkinSettings({
  game = globalThis.game,
  document = globalThis.document
} = {}) {
  if (!game?.settings?.register) return;

  game.settings.register(MODULE_ID, INTERFACE_SKIN_SETTING, {
    name: "MasterQuest: visual da interface",
    hint: "Define o visual compartilhado das janelas do MasterQuest neste mundo.",
    scope: "world",
    config: true,
    type: String,
    choices: INTERFACE_SKIN_CHOICES,
    default: INTERFACE_SKINS.parchment,
    onChange: () => refreshOpenMasterQuestSkins({ game, document })
  });
}
