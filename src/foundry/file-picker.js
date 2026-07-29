/**
 * Foundry's file browser, reached defensively.
 *
 * FilePicker moved namespaces across versions (global in v12, `foundry.applications.apps`
 * in v13+), and this module cannot verify every build it will run on. So the class is
 * resolved at call time from every plausible location, and when nothing is found the
 * caller keeps its plain text field instead of breaking.
 */

/**
 * Resolve the FilePicker class available in this Foundry build.
 *
 * @param {object} [scope] Injectable global scope, for tests.
 * @returns {Function|null} The class, or null when unavailable.
 */
export function resolveFilePicker(scope = globalThis) {
  const candidates = [
    scope?.foundry?.applications?.apps?.FilePicker,
    scope?.foundry?.applications?.api?.FilePicker,
    scope?.foundry?.appv1?.apps?.FilePicker,
    scope?.FilePicker
  ];

  return candidates.find((candidate) => typeof candidate === "function") ?? null;
}

/**
 * Whether a file browser is available at all.
 *
 * @param {object} [scope] Injectable global scope.
 * @returns {boolean} True when a picker can be opened.
 */
export function hasFilePicker(scope = globalThis) {
  return resolveFilePicker(scope) !== null;
}

/**
 * Open the file browser and resolve with the chosen path.
 *
 * @param {object} [options]
 * @param {string} [options.type] Foundry picker type: "image", "audio", "video", "any".
 * @param {string} [options.current] Path to open on.
 * @param {string} [options.title] Window title.
 * @param {object} [options.scope] Injectable global scope.
 * @returns {Promise<string|null>} The selected path, or null when cancelled or unavailable.
 */
export async function pickFilePath({
  type = "image",
  current = "",
  title = "Escolher imagem",
  scope = globalThis
} = {}) {
  const FilePickerClass = resolveFilePicker(scope);
  if (!FilePickerClass) return null;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value ?? null);
    };

    try {
      const picker = new FilePickerClass({
        type,
        current: current || "",
        title,
        callback: (path) => settle(path),
        // v13+ closes through the ApplicationV2 lifecycle; cancelling never calls back,
        // so the close hook is what keeps this promise from hanging forever.
        close: () => settle(null)
      });

      const rendered = typeof picker.browse === "function" ? picker.browse() : picker.render(true);
      Promise.resolve(rendered).catch(() => settle(null));

      // ApplicationV2 exposes a close() promise; chain onto it when present.
      if (typeof picker.close === "function" && typeof picker.addEventListener !== "function") {
        const originalClose = picker.close.bind(picker);
        picker.close = async (...args) => {
          const result = await originalClose(...args);
          settle(null);
          return result;
        };
      }
    } catch (error) {
      console.error("master-quest | falha ao abrir o navegador de arquivos", error);
      settle(null);
    }
  });
}
