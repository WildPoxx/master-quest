/**
 * Small rendering helpers shared by the MasterQuest windows.
 *
 * The module renders HTML strings rather than Handlebars templates, so escaping is
 * explicit and mandatory: every value that came from the world goes through `esc`.
 */

/**
 * Escape a value for safe interpolation into HTML text or an attribute.
 *
 * @param {*} value Any value.
 * @returns {string} The escaped string.
 */
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Escape a value for use inside a CSS `url()`.
 *
 * @param {*} value A path or URL.
 * @returns {string} The escaped string.
 */
export function escUrl(value) {
  const raw = String(value ?? "").trim();

  // Browsers do not execute `javascript:` inside CSS url(), but the same helper feeds
  // href-like contexts elsewhere, and a path that is not a path is never legitimate here.
  // Anything with a scheme that is not http, https or an image data URL is dropped.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  const allowed = !scheme || scheme === "http" || scheme === "https";
  const isImageData = /^data:image\/[a-z0-9.+-]+;/i.test(raw);
  if (scheme && !allowed && !isImageData) return "";

  return raw.replaceAll("\\", "\\\\").replaceAll("'", "\\'").replaceAll("\n", "");
}

/**
 * Join class names, dropping falsy entries.
 *
 * @param {...(string|false|null|undefined)} names Class names.
 * @returns {string} The joined class attribute value.
 */
export function cls(...names) {
  return names.filter(Boolean).join(" ");
}

/**
 * Render the small status-change button row used in the log and in details.
 *
 * @param {object[]} actions Entries from `statusActionsFor`.
 * @param {string} questId The quest the buttons act on.
 * @returns {string} HTML.
 */
export function renderStatusActions(actions, questId) {
  if (!actions?.length) return "";

  const buttons = actions
    .map(
      (action) => `<button type="button" class="mq-status-action mq-status-${esc(action.status)}"
        data-action="set-status" data-quest-id="${esc(questId)}" data-status="${esc(action.status)}"
        title="${esc(action.label)}" aria-label="${esc(action.label)}"><i class="${esc(action.icon)}" inert></i></button>`
    )
    .join("");

  return `<div class="mq-status-actions">${buttons}</div>`;
}

/**
 * Render an empty-state message.
 *
 * @param {string} message The message to show.
 * @returns {string} HTML.
 */
export function renderEmpty(message) {
  return `<li class="mq-empty">${esc(message)}</li>`;
}

/**
 * Sanitize stored HTML before injecting it into the window.
 *
 * Quest descriptions and notes are authored by the GM through Foundry's editor, but
 * they are still world data. Strip the tags that turn a note into code execution.
 *
 * @param {string} value Stored HTML.
 * @returns {string} HTML with scripts, iframes and inline handlers removed.
 */
export function safeHtml(value) {
  const raw = String(value ?? "");
  if (!raw) return "";

  const doc = globalThis.document;
  if (!doc?.createElement) return esc(raw);

  const host = doc.createElement("div");
  host.innerHTML = raw;

  for (const node of host.querySelectorAll("script, iframe, object, embed, link, meta")) {
    node.remove();
  }
  for (const node of host.querySelectorAll("*")) {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      const value = String(attr.value ?? "").trim().toLowerCase();
      if (name.startsWith("on")) node.removeAttribute(attr.name);
      else if ((name === "href" || name === "src") && value.startsWith("javascript:")) {
        node.removeAttribute(attr.name);
      }
    }
  }

  return host.innerHTML;
}
