export function getFoundryGame() {
  return globalThis.game;
}

export function isModuleActive(moduleId, game = getFoundryGame()) {
  return Boolean(game?.modules?.get?.(moduleId)?.active);
}

export function notifyWarning(message, ui = globalThis.ui) {
  if (ui?.notifications?.warn) {
    ui.notifications.warn(message);
    return;
  }

  console.warn(message);
}

export function notifyInfo(message, ui = globalThis.ui) {
  if (ui?.notifications?.info) {
    ui.notifications.info(message);
    return;
  }

  console.info(message);
}
export function notifyError(message, ui = globalThis.ui) {
  if (ui?.notifications?.error) {
    ui.notifications.error(message);
    return;
  }

  console.error(message);
}