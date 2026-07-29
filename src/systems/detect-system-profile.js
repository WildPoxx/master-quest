import { createSystemProfile } from "./system-adapter-registry.js";

export function detectSystemProfile({ game = globalThis.game, system = null, fallback = null } = {}) {
  const foundrySystem = system ?? safeReadSystem(game);
  if (!foundrySystem) {
    return fallback;
  }

  return createSystemProfile(foundrySystem, {
    mode: "detected",
    source: "foundry-game-system"
  }) ?? fallback;
}

function safeReadSystem(game) {
  try {
    return game?.system ?? null;
  } catch {
    return null;
  }
}
