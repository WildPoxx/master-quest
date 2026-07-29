/**
 * MasterQuest hub: the first window the GM sees.
 *
 * Two doors. Creating a quest goes to the Authoring Console, which helps design the
 * adventure. Managing quests goes to the Quest Log, which runs it at the table.
 */

import { MODULE_ID } from "../constants.js";
import { filterHeaderControls } from "../foundry/window-controls.js";
import { notifyError, notifyInfo, notifyWarning } from "../foundry/environment.js";
import { previewFqlImport, importFromFql } from "../quest/quest-import-fql.js";
import { readAllQuests } from "../quest/quest-store.js";
import { QUEST_STATUS } from "../quest/quest-schema.js";
import { esc } from "./render-utils.js";

let HubClass = null;
let activeHub = null;

/**
 * Open (or focus) the MasterQuest hub.
 *
 * @param {object} [options]
 * @param {object} [options.api] The MasterQuest API.
 * @param {object} [options.game] The Foundry game object.
 * @param {object} [options.ui] The Foundry ui object.
 * @param {Function} [options.applicationClass] ApplicationV2, injectable for tests.
 * @returns {Promise<object>} The application instance, or a failure descriptor.
 */
export async function openMasterQuestHub({
  api = null,
  game = globalThis.game,
  ui = globalThis.ui,
  applicationClass = globalThis.foundry?.applications?.api?.ApplicationV2
} = {}) {
  if (!applicationClass) {
    notifyWarning("O MasterQuest requer Foundry ApplicationV2.", ui);
    return { opened: false, reason: "missing-application-v2" };
  }

  if (!HubClass || Object.getPrototypeOf(HubClass.prototype) !== applicationClass.prototype) {
    HubClass = createMasterQuestHubClass(applicationClass);
  }

  if (!activeHub?.rendered) activeHub = new HubClass({ api, game, ui });

  try {
    await activeHub.render({ force: true });
  } catch (error) {
    // Without this the click on the sidebar button produces an unhandled rejection in the
    // console and absolutely nothing on screen. Tell the GM the window failed to open.
    console.error(`${MODULE_ID} | falha ao abrir o hub`, error);
    notifyError(`MasterQuest não conseguiu abrir: ${error?.message ?? error}`, ui);
    activeHub = null;
    return { opened: false, reason: "render-failed", error };
  }

  return activeHub;
}

/**
 * Build the hub application class over the given ApplicationV2 base.
 *
 * @param {Function} ApplicationV2 The base class.
 * @returns {Function} The hub class.
 */
export function createMasterQuestHubClass(ApplicationV2) {
  return class MasterQuestHub extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-hub`,
      classes: ["masterquest", "masterquest-hub"],
      tag: "section",
      window: { title: "MasterQuest", icon: "fa-solid fa-scroll", resizable: false },
      position: { width: 560, height: "auto" }
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

    constructor({ api = null, game = globalThis.game, ui = globalThis.ui } = {}, options = {}) {
      super(options);
      this.api = api;
      this.game = game;
      this.ui = ui;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const quests = readAllQuests({ game: this.game });

      // The FQL scan is a convenience, never a precondition for opening the hub. If a
      // world's journal data makes it throw, degrade to "no import available" instead of
      // failing the render — a rejected _prepareContext leaves the GM with a dead button
      // and no window at all.
      let fql = { pending: 0, total: 0 };
      try {
        fql = previewFqlImport({ game: this.game });
      } catch (error) {
        console.error(`${MODULE_ID} | falha ao inspecionar quests do Forien's Quest Log`, error);
      }

      return {
        ...context,
        isGM: this.game?.user?.isGM === true,
        questCount: quests.length,
        activeCount: quests.filter((q) => q.status === QUEST_STATUS.active).length,
        fqlPending: fql.pending,
        fqlTotal: fql.total
      };
    }

    async _renderHTML(context) {
      const element = document.createElement("div");
      element.className = "mq-hub";
      element.innerHTML = renderHub(context);
      return element;
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
      this.activateListeners(result);
    }

    activateListeners(root) {
      root.querySelector("[data-action='open-log']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const { openMasterQuestLog } = await import("./quest-log.js");
        await openMasterQuestLog({ api: this.api, game: this.game, ui: this.ui });
      });

      root.querySelector("[data-action='open-authoring']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.api?.masterQuest?.openAuthoringConsole?.();
      });

      root.querySelector("[data-action='import-adventure']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const { openImportAdventure } = await import("./import-adventure.js");
        await openImportAdventure({
          api: this.api,
          game: this.game,
          ui: this.ui,
          onDone: () => this.render({ force: false })
        });
      });

      root.querySelector("[data-action='snapshot']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const { downloadQuestSnapshot } = await import("../quest/quest-snapshot.js");
        try {
          const result = downloadQuestSnapshot({ game: this.game });
          notifyInfo(
            `MasterQuest: snapshot de ${result.questCount} quest(s) gerado (${result.filename}).`,
            this.ui
          );
        } catch (error) {
          console.error(`${MODULE_ID} | falha ao gerar o snapshot`, error);
          notifyError(`MasterQuest não conseguiu gerar o snapshot: ${error?.message ?? error}`, this.ui);
        }
      });

      root.querySelector("[data-action='import-fql']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const result = await importFromFql({ game: this.game });
        notifyInfo(
          `MasterQuest: ${result.imported} quest(s) importada(s) do FQL, ${result.skipped} já existiam, ${result.failed} falharam.`,
          this.ui
        );
        await this.render({ force: false });
      });
    }
  };
}

/**
 * Render the hub body.
 *
 * @param {object} context `{isGM, questCount, activeCount, fqlPending, fqlTotal}`.
 * @returns {string} HTML.
 */
export function renderHub(context) {
  const importCard = context.isGM && context.fqlPending > 0
    ? `<div class="mq-hub-import">
        <p>Encontrei <strong>${esc(context.fqlPending)}</strong> quest(s) do Forien's Quest Log ainda não importadas
        (de ${esc(context.fqlTotal)} no mundo).</p>
        <button type="button" class="mq-bulk" data-action="import-fql">
          <i class="fa-solid fa-file-import" inert></i> Importar do FQL</button>
        <p class="mq-hint">A importação copia os dados; o flag original do FQL não é apagado.</p>
      </div>`
    : "";

  // Export end of the pipeline: dump the current state of the log as JSON so the session
  // can be processed outside Foundry and come back as an update.
  const snapshotCard = context.isGM
    ? `<button type="button" class="mq-hub-card" data-action="snapshot">
        <i class="fa-solid fa-camera-retro" inert></i>
        <span class="mq-hub-card-title">Gerar snapshot</span>
        <span class="mq-hub-card-desc">Baixa um JSON somente-leitura com o estado atual de
        todas as quests, para análise externa e scripts de atualização.</span>
      </button>`
    : "";

  const adventureCard = context.isGM
    ? `<button type="button" class="mq-hub-card" data-action="import-adventure">
        <i class="fa-solid fa-map-location-dot" inert></i>
        <span class="mq-hub-card-title">Importar aventura</span>
        <span class="mq-hub-card-desc">Traz uma aventura de um blueprint do módulo, de um arquivo JSON
        ou de uma pasta do Journal deste mundo. Sempre com prévia antes de escrever.</span>
      </button>`
    : "";

  const authoringCard = context.isGM
    ? `<button type="button" class="mq-hub-card" data-action="open-authoring">
        <i class="fa-solid fa-wand-magic-sparkles" inert></i>
        <span class="mq-hub-card-title">Criar quest</span>
        <span class="mq-hub-card-desc">Console de autoria: transforma uma ideia em objetivos, cenas,
        ameaças, pistas e recompensas.</span>
      </button>`
    : "";

  return `
    <header class="mq-hub-header">
      <h1>MasterQuest</h1>
      <p>${esc(context.questCount)} quest(s) no mundo, ${esc(context.activeCount)} em andamento.</p>
    </header>

    <div class="mq-hub-cards">
      ${authoringCard}
      <button type="button" class="mq-hub-card" data-action="open-log">
        <i class="fa-solid fa-list-check" inert></i>
        <span class="mq-hub-card-title">Gerenciar quests</span>
        <span class="mq-hub-card-desc">Quest Log: acompanha, edita e conduz as quests em mesa,
        por status, objetivos e recompensas.</span>
      </button>
      ${adventureCard}
      ${snapshotCard}
    </div>

    ${importCard}
  `;
}
