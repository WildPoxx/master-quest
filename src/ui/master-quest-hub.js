/**
 * MasterQuest hub: the first window the GM sees.
 *
 * Two doors. Creating a quest goes to the Authoring Console, which helps design the
 * adventure. Managing quests goes to the Quest Log, which runs it at the table.
 */

import { MODULE_ID } from "../constants.js";
import { applyInterfaceSkin } from "../foundry/skin-settings.js";
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
      applyInterfaceSkin(content, { game: this.game });
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

      root.querySelector("[data-action='feed-report']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const { openFeedReport } = await import("./feed-report.js");
        await openFeedReport({ api: this.api, game: this.game, ui: this.ui });
      });

      root.querySelector("[data-action='snapshot']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const { downloadQuestSnapshot } = await import("../quest/quest-snapshot.js");
        try {
          const result = downloadQuestSnapshot({ game: this.game });
          notifyInfo(
            `MasterQuest: snapshot of ${result.questCount} quest(s) generated (${result.filename}).`,
            this.ui
          );
        } catch (error) {
          console.error(`${MODULE_ID} | falha ao gerar o snapshot`, error);
          notifyError(`MasterQuest could not generate the snapshot: ${error?.message ?? error}`, this.ui);
        }
      });

      root.querySelector("[data-action='import-fql']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const result = await importFromFql({ game: this.game });
        notifyInfo(
          `MasterQuest: ${result.imported} quest(s) imported from FQL, ${result.skipped} already existed, ${result.failed} failed.`,
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
  // DEC-027: estrutura e UI em ingles, sempre; so o CONTEUDO da campanha e portugues.
  // O mesmo gesto de sempre, em lugar de menos destaque: manutencao nao disputa espaco com
  // o que se usa na mesa. O `data-action` NAO mudou — o ouvinte de clique segue o mesmo.
  // 1.2.1 — SO O ICONE. A primeira forma empilhava icone e rotulo em caixa alta, seguindo o
  // desenho de Mario ao pe da letra; em tamanho real virou um carimbo, alto demais, que
  // empurrava o cabecalho e nao se parecia com nenhum outro botao do modulo. Escolha dele
  // em 2026-08-23, entre tres formas medidas no laboratorio.
  //
  // `aria-label` NAO e redundante com `title`: sem nome acessivel, um botao so de icone
  // desaparece para quem navega por teclado ou leitor de tela — e o gesto ja e discreto por
  // decisao de layout; discreto nao pode virar invisivel.
  const snapshotButton = context.isGM
    ? `<button type="button" class="mq-bulk mq-hub-corner" data-action="snapshot"
        title="Take snapshot: downloads a read-only JSON with the current state of every quest"
        aria-label="Take snapshot">
        <i class="fa-solid fa-camera" inert></i></button>`
    : "";

  const importCard = context.isGM && context.fqlPending > 0
    ? `<div class="mq-hub-import">
        <p>Found <strong>${esc(context.fqlPending)}</strong> Forien's Quest Log quest(s) not yet imported
        (of ${esc(context.fqlTotal)} in this world).</p>
        <button type="button" class="mq-bulk" data-action="import-fql">
          <i class="fa-solid fa-file-import" inert></i> Import from FQL</button>
        <p class="mq-hint">Importing copies the data; the original FQL flag is never erased.</p>
      </div>`
    : "";

  // Export end of the pipeline: dump the current state of the log as JSON so the session
  // can be processed outside Foundry and come back as an update.
  // 1.2.0 — O QUADRANTE MUDA DE DONO, e a razao e de valor, nao de gosto.
  //
  // O Snapshot e utilidade de manutencao: baixa um JSON e nada mais. Ele ocupava um dos
  // quatro quadrantes da porta de entrada — o lugar mais caro da janela — enquanto o gesto
  // que a mesa faz TODA sessao (recuperar o que ficou estabelecido) nao tinha porta nenhuma.
  // Decisao de Mario em 2026-08-21, repetida em 22/08: o Snapshot desce para botao de canto
  // no cabecalho, e o quadrante passa ao Feed Report.
  const feedReportCard = context.isGM
    ? `<button type="button" class="mq-hub-card" data-action="feed-report">
        <i class="fa-solid fa-file-arrow-up" inert></i>
        <span class="mq-hub-card-title">Feed report</span>
        <span class="mq-hub-card-desc">Reads continuity reports and shows what is established, what is
        still hanging, and what the module is unsure about. Never writes to a quest.</span>
      </button>`
    : "";

  const adventureCard = context.isGM
    ? `<button type="button" class="mq-hub-card" data-action="import-adventure">
        <i class="fa-solid fa-map-location-dot" inert></i>
        <span class="mq-hub-card-title">Import adventure</span>
        <span class="mq-hub-card-desc">Brings an adventure in from a module blueprint, a JSON file
        or a Journal folder of this world. Always previews before writing.</span>
      </button>`
    : "";

  const authoringCard = context.isGM
    ? `<button type="button" class="mq-hub-card" data-action="open-authoring">
        <i class="fa-solid fa-wand-magic-sparkles" inert></i>
        <span class="mq-hub-card-title">Create quest</span>
        <span class="mq-hub-card-desc">Authoring console: turns an idea into objectives, scenes,
        threats, clues and rewards.</span>
      </button>`
    : "";

  return `
    <header class="mq-hub-header">
      <div class="mq-hub-heading">
        <h1>MasterQuest</h1>
        <p>${esc(context.questCount)} quest(s) in this world, ${esc(context.activeCount)} in progress.</p>
      </div>
      ${snapshotButton}
    </header>

    <div class="mq-hub-cards">
      ${authoringCard}
      <button type="button" class="mq-hub-card" data-action="open-log">
        <i class="fa-solid fa-list-check" inert></i>
        <span class="mq-hub-card-title">Manage quests</span>
        <span class="mq-hub-card-desc">Quest Log: tracks, edits and runs the quests at the table,
        by status, objectives and rewards.</span>
      </button>
      ${adventureCard}
      ${feedReportCard}
    </div>

    ${importCard}
  `;
}
