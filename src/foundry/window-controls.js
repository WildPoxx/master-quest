/**
 * Header controls of MasterQuest windows.
 *
 * Foundry v14 ships Detach/Attach as default header controls on every ApplicationV2
 * (`ApplicationV2.DEFAULT_OPTIONS.window.controls`, core 14.365). With the PopOut! module
 * also installed the same window ends up with two ways to do the same thing.
 *
 * MasterQuest does not decide that for the GM: it exposes a setting. Hiding is only the
 * default because a redundant control is noise, and nothing of the module depends on it.
 */

import { MODULE_ID } from "../constants.js";

export const HIDE_DETACH_SETTING = "hideDetachControls";

/** Header control actions that come from Foundry core, not from MasterQuest. */
const CORE_DETACH_ACTIONS = new Set(["detach", "attach"]);

function supportsDetachControls(game) {
  const generation = Number(game?.release?.generation);
  // An incomplete test stub should preserve the V14 default. A real V13 Game always
  // exposes release.generation, verified against 13.351.
  return !Number.isFinite(generation) || generation >= 14;
}

/**
 * Register the setting. Safe to call when settings are unavailable.
 *
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {boolean} Whether the setting was registered.
 */
export function registerWindowControlSettings({ game = globalThis.game } = {}) {
  if (!supportsDetachControls(game)) return false;
  if (typeof game?.settings?.register !== "function") return false;

  game.settings.register(MODULE_ID, HIDE_DETACH_SETTING, {
    name: "MasterQuest: ocultar Destacar/Anexar",
    hint:
      "O Foundry 14 acrescenta os botões Destacar e Anexar a toda janela. Desligue esta opção "
      + "para voltar a mostrá-los nas janelas do MasterQuest.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  return true;
}

/**
 * Whether the core detach controls should be hidden.
 *
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {boolean} True when they should be hidden.
 */
export function shouldHideDetachControls({ game = globalThis.game } = {}) {
  if (!supportsDetachControls(game)) return false;
  if (typeof game?.settings?.get !== "function") return true;
  try {
    return game.settings.get(MODULE_ID, HIDE_DETACH_SETTING) !== false;
  } catch {
    // Setting not registered yet (early render): fall back to the default.
    return true;
  }
}

/**
 * Filter a control list according to the setting.
 *
 * @param {Array<object>} controls The controls Foundry assembled.
 * @param {object} [options]
 * @param {object} [options.game] The Foundry game object.
 * @returns {Array<object>} The filtered controls.
 */
export function filterHeaderControls(controls, { game = globalThis.game } = {}) {
  const list = Array.isArray(controls) ? controls : [];
  if (!shouldHideDetachControls({ game })) return list;
  return list.filter((control) => !CORE_DETACH_ACTIONS.has(control?.action));
}
