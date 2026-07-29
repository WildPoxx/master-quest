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
    notifyWarning("O MasterQuest requer Foundry ApplicationV2.", ui);
    return { opened: false, reason: "missing-application-v2" };
  }

  if (!ImportClass || Object.getPrototypeOf(ImportClass.prototype) !== applicationClass.prototype) {
    ImportClass = createImportAdventureClass(applicationClass);
  }

  if (!activeWindow?.rendered) activeWindow = new ImportClass({ api, game, ui, onDone });

  try {
    await activeWindow.render({ force: true });
  } catch (error) {
    console.error(`${MODULE_ID} | falha ao abrir a importação`, error);
    notifyError(`MasterQuest não conseguiu abrir a importação: ${error?.message ?? error}`, ui);
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
      window: { title: "MasterQuest: importar aventura", icon: "fa-solid fa-map-location-dot", resizable: true },
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
        console.error(`${MODULE_ID} | falha ao listar pastas de Journal`, error);
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
          notifyInfo(`MasterQuest: ${file.name} lido.`, this.ui);
          await this.render({ force: false });
        } catch (error) {
          console.error(`${MODULE_ID} | falha ao ler o arquivo`, error);
          notifyError(`Não consegui ler ${file.name}: ${error?.message ?? error}`, this.ui);
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
          notifyWarning("MasterQuest: escolha uma fonte antes de gerar a prévia.", this.ui);
          this.plan = null;
          return;
        }

        this.plan = { ...planFileImport({ payload, game: this.game }), mode: "file" };
      } catch (error) {
        console.error(`${MODULE_ID} | falha ao montar a prévia`, error);
        notifyError(`MasterQuest não conseguiu montar a prévia: ${error?.message ?? error}`, this.ui);
        this.plan = null;
      }
    }

    /** Apply the current selection. Requires a plan, so nothing is written unpreviewed. */
    async apply() {
      if (!this.plan) {
        notifyWarning("MasterQuest: gere a prévia antes de importar.", this.ui);
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
            `MasterQuest: ${result.promoted} promovida(s), ${result.skipped} já eram quests, ${result.failed} falha(s).`,
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
            `MasterQuest: ${result.created} criada(s), ${result.updated} atualizada(s), ${result.failed} falha(s).`,
            this.ui
          );
        }

        this.plan = null;
        await this.render({ force: false });
        await this.onDone?.();
      } catch (error) {
        console.error(`${MODULE_ID} | falha ao importar`, error);
        notifyError(`MasterQuest não conseguiu importar: ${error?.message ?? error}`, this.ui);
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
      <span>Blueprint incluído no módulo</span>
      <select data-field="blueprint">
        ${context.blueprints
          .map((id) => `<option value="${esc(id)}" ${id === context.selectedBlueprint ? "selected" : ""}>${esc(id)}</option>`)
          .join("")}
      </select>
    </label>`;

  const filePanel = context.source !== "file" ? "" : `
    <label class="mq-field">
      <span>Arquivo JSON (blueprint do MasterQuest ou export de Journal do Foundry)</span>
      <input type="file" accept="application/json,.json" data-field="file">
    </label>
    ${context.fileName ? `<p class="mq-hint">Carregado: <strong>${esc(context.fileName)}</strong></p>` : ""}`;

  const folderPanel = context.source !== "folder" ? "" : `
    <label class="mq-field">
      <span>Pasta de Journal deste mundo</span>
      <select data-field="folder">
        ${context.folders
          .map((folder) => {
            const value = folder.id ?? "__root__";
            const selected = (folder.id ?? null) === (context.selectedFolderId ?? null) ? "selected" : "";
            return `<option value="${esc(value)}" ${selected}>${esc(folder.name)} — ${esc(folder.promotable)} promovível(is) de ${esc(folder.total)}</option>`;
          })
          .join("")}
      </select>
    </label>
    <p class="mq-hint">Entradas que já são quests são puladas. Rascunhos do Console de Autoria
    viram quests com seus objetivos; Journals comuns viram quests com a primeira página como descrição.</p>`;

  return `
    <header class="mq-import-header">
      <h1>Importar aventura</h1>
      <p>Escolha de onde vem o material. Nada é escrito antes da prévia.</p>
    </header>

    <div class="mq-import-sources">
      ${radio("bundled", "Blueprint do módulo", "Aventuras que acompanham o MasterQuest")}
      ${radio("file", "Arquivo JSON", "Blueprint ou export de Journal")}
      ${radio("folder", "Pasta do Journal", "Promove o que já está neste mundo")}
    </div>

    <div class="mq-import-panel">
      ${blueprintPanel}
      ${filePanel}
      ${folderPanel}
    </div>

    <label class="mq-field mq-import-status">
      <span>Status inicial das quests importadas</span>
      <select data-field="landing-status">
        <option value="available" ${context.landingStatus === "available" ? "selected" : ""}>Disponíveis</option>
        <option value="inactive" ${context.landingStatus === "inactive" ? "selected" : ""}>Inativas (só o Mestre vê)</option>
        <option value="active" ${context.landingStatus === "active" ? "selected" : ""}>Em Andamento</option>
        <option value="blueprint" ${context.landingStatus === "blueprint" ? "selected" : ""}>Respeitar o que o blueprint declara</option>
      </select>
    </label>
    <p class="mq-hint">Blueprints declaram o próprio status por quest. Para eles, escolher
    &quot;respeitar o blueprint&quot; preserva a sequência de ativação desenhada na aventura.</p>

    ${renderPlan(context.plan)}

    <footer class="mq-import-actions">
      <button type="button" class="mq-bulk" data-action="preview">
        <i class="fa-solid fa-eye" inert></i> Gerar prévia</button>
      <button type="button" class="mq-bulk" data-action="apply" ${context.plan ? "" : "disabled"}>
        <i class="fa-solid fa-file-import" inert></i> Importar</button>
    </footer>
  `;
}

function renderPlan(plan) {
  if (!plan) return "";

  const errors = (plan.issues ?? []).filter((issue) => issue.severity === "error");
  if (errors.length) {
    return `<div class="mq-import-plan mq-import-plan-error">
      <h2>Não dá para importar</h2>
      <ul>${errors.map((issue) => `<li>${esc(issue.message)}</li>`).join("")}</ul>
    </div>`;
  }

  if (plan.mode === "folder") {
    return `<div class="mq-import-plan">
      <h2>Prévia</h2>
      <p><strong>${esc(plan.promote)}</strong> entrada(s) a promover, ${esc(plan.skip)} já são quests,
      de ${esc(plan.total)} na pasta.</p>
      <ul class="mq-box">${plan.entries
        .map((entry) => `<li>${esc(entry.name)} — ${esc(kindLabel(entry.kind))}</li>`)
        .join("")}</ul>
    </div>`;
  }

  const missing = plan.missingJournalLinks?.length ?? 0;
  const preserved = (plan.entries ?? []).filter((entry) => entry.preserved).length;

  return `<div class="mq-import-plan">
    <h2>Prévia</h2>
    <p><strong>${esc(plan.create)}</strong> quest(s) a criar, ${esc(plan.update)} a atualizar${
      plan.folderName ? `, na pasta <em>${esc(plan.folderName)}</em>` : ""
    }.</p>
    ${preserved ? `<p>${esc(preserved)} já existem: status, objetivos concluídos e notas de jogador serão preservados.</p>` : ""}
    ${missing ? `<p class="mq-hint">${esc(missing)} link(s) de Journal apontam para entradas inexistentes neste mundo. Nada é apagado por isso.</p>` : ""}
  </div>`;
}

function kindLabel(kind) {
  if (kind === "already-quest") return "já é quest, será pulada";
  if (kind === "from-draft") return "rascunho de autoria";
  return "Journal comum";
}

export { PAYLOAD_KIND };
