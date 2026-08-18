import { MODULE_ID } from "../constants.js";

/** World setting that selects the shared MasterQuest interface skin. */
export const INTERFACE_SKIN_SETTING = "interfaceSkin";

/**
 * As nove skins do catalogo (Mario, 2026-08-18). Cinco vieram do candidato do Codex;
 * quatro — horror, steampunk, supers e olf — foram aprovadas nesta data.
 *
 * A ordem aqui e a ordem do menu em Game Settings, e ela e deliberada: o padrao primeiro,
 * e depois as demais agrupadas por familia de genero. Menu em ordem alfabetica poria
 * "Cosmic" antes do padrao e faria o Mestre procurar o proprio default.
 */
export const INTERFACE_SKINS = Object.freeze({
  parchment: "pergaminho",
  medievalFantasy: "fantasia-medieval",
  horror: "horror",
  steampunk: "steampunk",
  cosmic: "cosmic",
  sciFi: "sci-fi",
  supers: "supers",
  modernInvestigation: "investigacao-moderna",
  olf: "olf"
});

const INTERFACE_SKIN_CHOICES = Object.freeze({
  [INTERFACE_SKINS.parchment]: "Pergaminho Hyboriano",
  [INTERFACE_SKINS.medievalFantasy]: "Fantasia Medieval",
  [INTERFACE_SKINS.horror]: "Horror",
  [INTERFACE_SKINS.steampunk]: "Steampunk",
  [INTERFACE_SKINS.cosmic]: "Cosmic",
  [INTERFACE_SKINS.sciFi]: "Futurista",
  [INTERFACE_SKINS.supers]: "Supers",
  [INTERFACE_SKINS.modernInvestigation]: "Investigação Contemporânea",
  [INTERFACE_SKINS.olf]: "OLF"
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

  healStoredInterfaceSkin({ game });
}

/**
 * Se o mundo tiver gravado uma skin que nao existe mais, REESCREVE o valor.
 *
 * Achado da homologacao de 2026-08-17: `normalizeInterfaceSkin` conserta a APLICACAO — a
 * tela nunca mostra um seletor invalido — mas o valor errado continuava no banco do mundo.
 * O menu de configuracao entao exibia uma opcao vazia, e a proxima leitura tinha de
 * consertar de novo, para sempre. Guardar no banco um valor que a interface nunca honra e
 * uma discordancia calada entre o que esta escrito e o que se ve.
 *
 * So o Mestre grava: `scope: "world"` e territorio do GM, e um jogador tentando escrever
 * receberia recusa do servidor.
 */
export function healStoredInterfaceSkin({ game = globalThis.game } = {}) {
  if (game?.user?.isGM !== true) return { status: "not-gm" };
  if (typeof game?.settings?.get !== "function" || typeof game?.settings?.set !== "function") {
    return { status: "no-settings" };
  }

  const stored = game.settings.get(MODULE_ID, INTERFACE_SKIN_SETTING);
  const healthy = normalizeInterfaceSkin(stored);
  if (stored === healthy) return { status: "ok", skin: healthy };

  game.settings.set(MODULE_ID, INTERFACE_SKIN_SETTING, healthy);
  return { status: "healed", from: stored, skin: healthy };
}
