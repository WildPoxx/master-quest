/**
 * Turn a Foundry drag-and-drop payload into the `@UUID[...]{Label}` source the GM Panel
 * stores.
 *
 * WHY THIS EXISTS
 * Until 0.17.0 the only way to link an Actor, Journal or Macro from the GM Panel was to type
 * `@UUID[Actor.xxxxxxxx]{Nome}` by hand, which means knowing the id. Dragging the document in
 * is how every other Foundry text surface does it. This module holds the part that can be
 * reasoned about without a browser: what the payload means, and what string it becomes.
 *
 * These two functions are pure on purpose. The DOM side (drop zones, caret placement) lives in
 * quest-details.js, where it can be read next to the rest of the editing behaviour.
 */

/**
 * Normalize whatever the drag event carried into `{ uuid, type }`, or null when the payload is
 * not a Foundry document (plain text, a file, a foreign app's drag).
 *
 * @param {string|object|null} raw `event.dataTransfer.getData("text/plain")` or a parsed object.
 */
export function readDropPayload(raw) {
  if (!raw) return null;

  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null; // Arrastar texto solto nao vira link.
    }
  }
  if (!data || typeof data !== "object") return null;

  // v11+ payloads carry the uuid directly. Everything else below is tolerance for older or
  // hand-built payloads, which still show up from macros and some modules.
  if (typeof data.uuid === "string" && data.uuid.trim()) {
    return { uuid: data.uuid.trim(), type: typeof data.type === "string" ? data.type : null };
  }
  if (typeof data.pack === "string" && data.pack && data.id) {
    return { uuid: `Compendium.${data.pack}.${data.id}`, type: data.type ?? null };
  }
  if (typeof data.type === "string" && data.type && data.id) {
    return { uuid: `${data.type}.${data.id}`, type: data.type };
  }
  return null;
}

/**
 * Build the stored source form of a content link.
 *
 * The label is written between braces, so a name containing braces would break the parser —
 * strip them rather than emit something the enricher will silently fail on. Without a name we
 * emit the bare `@UUID[...]`, which Foundry renders using the document's own title.
 */
export function buildUuidLink(uuid, name) {
  const id = String(uuid ?? "").trim();
  if (!id) return "";

  const label = String(name ?? "").replace(/[{}]/g, "").trim();
  return label ? `@UUID[${id}]{${label}}` : `@UUID[${id}]`;
}

/**
 * Resolve the dropped document's current name. Falls back to a bare link when the document
 * cannot be read (compendium not indexed, permission, deleted between drag and drop) — a link
 * without a label still works, so a failure here degrades instead of blocking the drop.
 */
export async function describeDrop(payload, { fromUuid = globalThis.fromUuid } = {}) {
  if (!payload?.uuid) return null;

  let name = null;
  try {
    name = (await fromUuid?.(payload.uuid))?.name ?? null;
  } catch (error) {
    console.warn("master-quest | could not resolve dropped document", payload.uuid, error);
  }
  return { uuid: payload.uuid, name };
}
