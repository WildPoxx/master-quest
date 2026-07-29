const FOUNDRY_LINK_PATTERN = /@(UUID|JournalEntry)\[[^\]]+\](?:\{[^}]*\})?/g;

export function extractJournalLinks(text) {
  const links = String(text ?? "").match(FOUNDRY_LINK_PATTERN) ?? [];
  return [...new Set(links)];
}
