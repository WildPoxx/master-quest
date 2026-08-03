import { safeHtml } from "../ui/render-utils.js";

/**
 * Turn stored quest HTML into display HTML with live Foundry content links.
 *
 * WHY THIS EXISTS
 * The GM Panel is the sheet the GM reads while running the table (DIR-05): it links to the
 * fascicle Journal, to NPC Actors, to macros. Those links are written as `@UUID[...]{Label}`,
 * which is inert text until Foundry's enricher rewrites it into an anchor. Until 0.16.0 the
 * module never called the enricher, so every link in the panel was dead text.
 *
 * ORDER MATTERS: sanitize first, enrich second.
 * `safeHtml` strips scripts and event handlers from whatever is stored; only then do we hand
 * the string to the enricher, which adds markup we trust because Foundry generated it. Doing
 * it the other way round would let stored markup ride through unsanitized.
 *
 * Never used on values that are about to be edited — see renderNotesTab. Enriched output
 * contains generated anchors; saving it back would overwrite the author's `@UUID` source.
 */

/** Resolve the enricher, tolerating both the v14 namespace and older globals. */
function resolveTextEditor() {
  // v14 canonical path. The bare `TextEditor` global still resolves but is on the
  // deprecation table (core 14.365, config.mjs), so prefer the namespaced one.
  const namespaced = globalThis.foundry?.applications?.ux?.TextEditor;
  const impl = namespaced?.implementation ?? namespaced;
  if (typeof impl?.enrichHTML === "function") return impl;

  const legacy = globalThis.TextEditor;
  if (typeof legacy?.enrichHTML === "function") return legacy;

  return null;
}

/**
 * @param {string} value Stored HTML for a quest field.
 * @param {object} [options]
 * @param {boolean} [options.secrets] Keep `<section class="secret">` blocks. True only for
 *   GM-only surfaces: the GM Panel tab is already gated by `isGM` in the view model, so the
 *   GM reading it should see the secrets they wrote.
 * @returns {Promise<string>} Display-ready HTML. Falls back to sanitized-only HTML when the
 *   enricher is unavailable (unit tests, or a core that moved the API again) — links stay
 *   inert, nothing breaks.
 */
export async function enrichQuestHtml(value, { secrets = false } = {}) {
  const sanitized = safeHtml(value);
  if (!sanitized) return "";

  const editor = resolveTextEditor();
  if (!editor) return sanitized;

  try {
    // Sem `async`: a opcao saiu do core; enrichHTML e sempre assincrono (DEC-027).
    return await editor.enrichHTML(sanitized, { secrets });
  } catch (error) {
    console.warn("master-quest | enrichHTML failed; showing plain content", error);
    return sanitized;
  }
}
