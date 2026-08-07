/**
 * Import adventure: one door, three sources.
 *
 * Importing must never be tied to a single adventure. The GM picks where the material
 * comes from — a blueprint shipped with the module, a JSON file on disk, or a Journal
 * folder already in this world — sees a plan, and only then writes.
 */

import { MODULE_ID } from "../constants.js";
import { filterHeaderControls } from "../foundry/window-controls.js";
import { notifyError, notifyInfo, notifyWarning } from "../foundry/environment.js";
import { esc } from "./render-utils.js";
import { BUNDLED_BLUEPRINTS, loadBundledBlueprint } from "../quest/quest-blueprint.js";
import { applyFileImport, planFileImport, readJsonFile, PAYLOAD_KIND } from "../quest/quest-import-file.js";
import { listPromotableFolders, planJournalPromotion, promoteJournalFolder } from "../quest/quest-import-journal.js";

let ImportClass = null;
let activeWindow = null;

/**
 * Open (or focus) the import window.
 *
 * @param {object} [options]
 * @param {object} [options.api] The MasterQuest API.
 * @param {object} [options.game] The Foundry game object.
 * @param {object} [options.ui] The Foundry ui object.
 * @param {Function} [options.applicationClass] ApplicationV2, injectable for tests.
 * @param {Function} [options.onDone] Called after a successful import.
 * @returns {Promise<object>} The application, or a failure descriptor.
 */
export async function openImportAdventure({
  api = null,
  game = globalThis.game,
  ui = globalThis.ui,
  onDone = null,
  applicationClass = globalThis.foundry?.applications?.api?.ApplicationV2
} = {}) {
  if (!applicationClass) {
    notifyWarning("MasterQuest requires Foundry ApplicationV2.", ui);
    return { opened: false, reason: "missing-application-v2" };
  }

  if (!ImportClass || Object.getPrototypeOf(ImportClass.prototype) !== applicationClass.prototype) {
    ImportClass = createImportAdventureClass(applicationClass);
  }

  if (!activeWindow?.rendered) activeWindow = new ImportClass({ api, game, ui, onDone });

  try {
    await activeWindow.render({ force: true });
  } catch (error) {
    console.error(`${MODULE_ID} | failed to open the import window`, error);
    notifyError(`MasterQuest could not open the import window: ${error?.message ?? error}`, ui);
    activeWindow = null;
    return { opened: false, reason: "render-failed", error };
  }

  return activeWindow;
}

/**
 * Build the import window class.
 *
 * @param {Function} ApplicationV2 The base class.
 * @returns {Function} The application class.
 */
export function createImportAdventureClass(ApplicationV2) {
  return class MasterQuestImportAdventure extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-import`,
      classes: ["masterquest", "masterquest-import"],
      tag: "section",
      window: { title: "MasterQuest: Import Adventure", icon: "fa-solid fa-map-location-dot", resizable: true },
      position: { width: 620, height: "auto" }
    };

    /**
     * Drop Foundry v14's Detach/Attach controls when the GM asked for that.
     * See src/foundry/window-controls.js.
     *
     * @returns {Array<object>} The header controls to show.
     */
    _getHeaderControls() {
      return filterHeaderControls(super._getHeaderControls(), { game: this.game });
    }

    constructor({ api = null, game = globalThis.game, ui = globalThis.ui, onDone = null } = {}, options = {}) {
      super(options);
      this.api = api;
      this.game = game;
      this.ui = ui;
      this.onDone = onDone;
      this.source = "bundled";
      this.selectedBlueprint = Object.keys(BUNDLED_BLUEPRINTS)[0] ?? null;
      this.selectedFolderId = null;
      this.filePayload = null;
      this.fileName = null;
      this.landingStatus = "available";
      this.plan = null;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      let folders = [];
      try {
        folders = listPromotableFolders({ game: this.game });
      } catch (error) {
        console.error(`${MODULE_ID} | failed to list Journal folders`, error);
      }

      return {
        ...context,
        source: this.source,
        blueprints: Object.keys(BUNDLED_BLUEPRINTS),
        selectedBlueprint: this.selectedBlueprint,
        folders,
        selectedFolderId: this.selectedFolderId,
        fileName: this.fileName,
        landingStatus: this.landingStatus,
        plan: this.plan
      };
    }

    async _renderHTML(context) {
      const element = document.createElement("div");
      element.className = "mq-import";
      element.innerHTML = renderImport(context);
      return element;
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
      this.activateListeners(result);
    }

    activateListeners(root) {
      root.querySelectorAll("[data-source]").forEach((input) => {
        input.addEventListener("change", () => {
          this.source = input.value;
          this.plan = null;
          this.render({ force: false });
        });
      });

      root.querySelector("[data-field='blueprint']")?.addEventListener("change", (event) => {
        this.selectedBlueprint = event.target.value;
        this.plan = null;
      });

      root.querySelector("[data-field='folder']")?.addEventListener("change", (event) => {
        this.selectedFolderId = event.target.value === "__root__" ? null : event.target.value;
        this.plan = null;
      });

      root.querySelector("[data-field='file']")?.addEventListener("change", async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        try {
          this.filePayload = await readJsonFile(file);
          this.fileName = file.name;
          this.plan = null;
          notifyInfo(`MasterQuest: ${file.name} loaded.`, this.ui);
          await this.render({ force: false });
        } catch (error) {
          console.error(`${MODULE_ID} | failed to read the file`, error);
          notifyError(`Could not read ${file.name}: ${error?.message ?? error}`, this.ui);
        }
      });

      root.querySelector("[data-field='landing-status']")?.addEventListener("change", (event) => {
        this.landingStatus = event.target.value;
        this.plan = null;
      });

      root.querySelector("[data-action='preview']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.buildPlan();
        await this.render({ force: false });
      });

      root.querySelector("[data-action='apply']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.apply();
      });
    }

    /** Build the plan for the currently selected source. Pure reading. */
    async buildPlan() {
      try {
        if (this.source === "folder") {
          this.plan = { ...planJournalPromotion({ folderId: this.selectedFolderId, game: this.game }), mode: "folder" };
          return;
        }

        const payload = this.source === "file"
          ? this.filePayload
          : await loadBundledBlueprint(this.selectedBlueprint);

        if (!payload) {
          notifyWarning("MasterQuest: choose a source before generating the preview.", this.ui);
          this.plan = null;
          return;
        }

        this.plan = { ...planFileImport({ payload, game: this.game }), mode: "file" };
      } catch (error) {
        console.error(`${MODULE_ID} | failed to build the preview`, error);
        notifyError(`MasterQuest could not build the preview: ${error?.message ?? error}`, this.ui);
        this.plan = null;
      }
    }

    /** Apply the current selection. Requires a plan, so nothing is written unpreviewed. */
    async apply() {
      if (!this.plan) {
        notifyWarning("MasterQuest: generate the preview before importing.", this.ui);
        return;
      }

      try {
        if (this.plan.mode === "folder") {
          const result = await promoteJournalFolder({
            folderId: this.selectedFolderId,
            game: this.game,
            status: this.landingStatus
          });
          notifyInfo(
            `MasterQuest: ${result.promoted} promoted, ${result.skipped} already quests, ${result.failed} failed.`,
            this.ui
          );
        } else {
          const payload = this.source === "file"
            ? this.filePayload
            : await loadBundledBlueprint(this.selectedBlueprint);
          const result = await applyFileImport({
            payload,
            game: this.game,
            // A blueprint carries its own statuses; only Journal-shaped payloads take this.
            status: this.landingStatus === "blueprint" ? null : this.landingStatus
          });
          notifyInfo(
            `MasterQuest: ${result.created} created, ${result.updated} updated, ${result.failed} failed.`,
            this.ui
          );
          // 0.25: a divergencia entre fonte e mesa deixa de morrer no retorno da funcao.
          // `mergeQuest` sempre devolveu os itens que a mesa tem e a fonte deixou de
          // listar — mas nada os mostrava, e ate a 0.23 o importador so contava DUAS das
          // seis colecoes. Aqui a noticia chega ao Mestre no momento em que nasce.
          const orphanTotal = countOrphans(result.results);
          if (orphanTotal) {
            notifyWarning(
              `MasterQuest: ${orphanTotal} item(s) kept from the table that the source no longer lists. Nothing was deleted — see the console for the list.`,
              this.ui
            );
            console.info(`${MODULE_ID} | orphans kept after import`, orphanReport(result.results));
          }
        }

        this.plan = null;
        await this.render({ force: false });
        await this.onDone?.();
      } catch (error) {
        console.error(`${MODULE_ID} | failed to import`, error);
        notifyError(`MasterQuest could not import: ${error?.message ?? error}`, this.ui);
      }
    }
  };
}

/**
 * Render the import body.
 *
 * @param {object} context The prepared context.
 * @returns {string} HTML.
 */
export function renderImport(context) {
  const radio = (value, label, hint) => `
    <label class="mq-import-source ${context.source === value ? "is-active" : ""}">
      <input type="radio" name="mq-import-source" value="${esc(value)}" data-source
        ${context.source === value ? "checked" : ""}>
      <span class="mq-import-source-label">${esc(label)}</span>
      <span class="mq-import-source-hint">${esc(hint)}</span>
    </label>`;

  const blueprintPanel = context.source !== "bundled" ? "" : `
    <label class="mq-field">
      <span>Blueprint bundled with the module</span>
      <select data-field="blueprint">
        ${context.blueprints
          .map((id) => `<option value="${esc(id)}" ${id === context.selectedBlueprint ? "selected" : ""}>${esc(id)}</option>`)
          .join("")}
      </select>
    </label>`;

  const filePanel = context.source !== "file" ? "" : `
    <label class="mq-field">
      <span>JSON file (MasterQuest blueprint or Foundry Journal export)</span>
      <input type="file" accept="application/json,.json" data-field="file">
    </label>
    ${context.fileName ? `<p class="mq-hint">Loaded: <strong>${esc(context.fileName)}</strong></p>` : ""}`;

  const folderPanel = context.source !== "folder" ? "" : `
    <label class="mq-field">
      <span>Journal folder in this world</span>
      <select data-field="folder">
        ${context.folders
          .map((folder) => {
            const value = folder.id ?? "__root__";
            const selected = (folder.id ?? null) === (context.selectedFolderId ?? null) ? "selected" : "";
            return `<option value="${esc(value)}" ${selected}>${esc(folder.name)} — ${esc(folder.promotable)} promotable of ${esc(folder.total)}</option>`;
          })
          .join("")}
      </select>
    </label>
    <p class="mq-hint">Entries that are already quests are skipped. Authoring Console drafts
    become quests with their objectives; plain Journals become quests with the first page as description.</p>`;

  return `
    <header class="mq-import-header">
      <h1>Import Adventure</h1>
      <p>Choose where the material comes from. Nothing is written before the preview.</p>
    </header>

    <div class="mq-import-sources">
      ${radio("bundled", "Module blueprint", "Adventures shipped with MasterQuest")}
      ${radio("file", "JSON file", "Blueprint or Journal export")}
      ${radio("folder", "Journal folder", "Promote what is already in this world")}
    </div>

    <div class="mq-import-panel">
      ${blueprintPanel}
      ${filePanel}
      ${folderPanel}
    </div>

    <label class="mq-field mq-import-status">
      <span>Landing status for imported quests</span>
      <select data-field="landing-status">
        <option value="available" ${context.landingStatus === "available" ? "selected" : ""}>Available</option>
        <option value="inactive" ${context.landingStatus === "inactive" ? "selected" : ""}>Inactive (GM only)</option>
        <option value="active" ${context.landingStatus === "active" ? "selected" : ""}>In Progress</option>
        <option value="blueprint" ${context.landingStatus === "blueprint" ? "selected" : ""}>Respect what the blueprint declares</option>
      </select>
    </label>
    <p class="mq-hint">Blueprints declare their own status per quest. For those, choosing
    &quot;respect the blueprint&quot; preserves the activation sequence designed into the adventure.</p>

    ${renderPlan(context.plan)}

    <footer class="mq-import-actions">
      <button type="button" class="mq-bulk" data-action="preview">
        <i class="fa-solid fa-eye" inert></i> Generate preview</button>
      <button type="button" class="mq-bulk" data-action="apply" ${context.plan ? "" : "disabled"}>
        <i class="fa-solid fa-file-import" inert></i> Import</button>
    </footer>
  `;
}

function renderPlan(plan) {
  if (!plan) return "";

  const errors = (plan.issues ?? []).filter((issue) => issue.severity === "error");
  if (errors.length) {
    return `<div class="mq-import-plan mq-import-plan-error">
      <h2>Cannot import</h2>
      <ul>${errors.map((issue) => `<li>${esc(issue.message)}</li>`).join("")}</ul>
    </div>`;
  }

  if (plan.mode === "folder") {
    return `<div class="mq-import-plan">
      <h2>Preview</h2>
      <p><strong>${esc(plan.promote)}</strong> entry(ies) to promote, ${esc(plan.skip)} already quests,
      out of ${esc(plan.total)} in the folder.</p>
      <ul class="mq-box">${plan.entries
        .map((entry) => `<li>${esc(entry.name)} — ${esc(kindLabel(entry.kind))}</li>`)
        .join("")}</ul>
    </div>`;
  }

  const missing = plan.missingJournalLinks?.length ?? 0;
  const preserved = (plan.entries ?? []).filter((entry) => entry.preserved).length;

  return `<div class="mq-import-plan">
    <h2>Preview</h2>
    <p><strong>${esc(plan.create)}</strong> quest(s) to create, ${esc(plan.update)} to update${
      plan.folderName ? `, in folder <em>${esc(plan.folderName)}</em>` : ""
    }.</p>
    ${preserved ? `<p>${esc(preserved)} already exist: status, completed objectives and player notes will be preserved.</p>` : ""}
    ${missing ? `<p class="mq-hint">${esc(missing)} Journal link(s) point to entries that do not exist in this world. Nothing is deleted because of it.</p>` : ""}
  </div>`;
}

function kindLabel(kind) {
  if (kind === "already-quest") return "already a quest, will be skipped";
  if (kind === "from-draft") return "authoring draft";
  return "plain Journal";
}

/* ---------------------------------------------------------------------------------- *
 * Orfaos da importacao (0.25)
 *
 * `mergeQuest` devolve, em SEIS colecoes, os itens que a mesa tem e a fonte deixou de
 * listar. Ate a 0.23 o importador so lia `objectives` e `rewards` — resto da epoca em que
 * so existiam essas duas — e mesmo esses dois nunca chegavam a tela: viviam em
 * `results[]`, que nenhuma superficie consultava. Pergunta do Backlog Ops em 2026-08-06.
 * ---------------------------------------------------------------------------------- */

/** Colecoes que podem render orfao, na ordem canonica da Details. */
const ORPHAN_KEYS = ["dilemmas", "objectives", "clues", "rewards", "complications", "outcomes"];

/**
 * @param {object[]} results Os resultados de `applyBlueprintImport`.
 * @returns {number} Quantos itens de mesa sobreviveram sem correspondencia na fonte.
 */
export function countOrphans(results) {
  return orphanReport(results).reduce((total, row) => total + row.items.length, 0);
}

/**
 * @param {object[]} results Os resultados de `applyBlueprintImport`.
 * @returns {Array<{quest: string, collection: string, items: string[]}>} Um por colecao.
 */
export function orphanReport(results) {
  const rows = [];
  for (const entry of Array.isArray(results) ? results : []) {
    const orphans = entry?.orphans;
    if (!orphans) continue;
    for (const key of ORPHAN_KEYS) {
      const items = Array.isArray(orphans[key]) ? orphans[key] : [];
      if (items.length) {
        rows.push({
          quest: entry.designId ?? entry.journalEntryId ?? "?",
          collection: key,
          items: items.map((item) => item?.name ?? "(unnamed)")
        });
      }
    }
  }
  return rows;
}

export { PAYLOAD_KIND };
