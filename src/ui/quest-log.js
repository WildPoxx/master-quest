/**
 * MasterQuest Quest Log.
 *
 * The operating window: every quest in the world, grouped by status, with the same
 * five tabs a GM expects from Forien's Quest Log. Built on ApplicationV2 for Foundry 14.
 */

import { MODULE_ID } from "../constants.js";
import { applyInterfaceSkin } from "../foundry/skin-settings.js";
import { filterHeaderControls } from "../foundry/window-controls.js";
import { notifyWarning } from "../foundry/environment.js";
import {
  createQuest,
  deleteQuest,
  getPrimaryQuestId,
  linkSubquest,
  readAllQuests,
  setPrimaryQuestId,
  setQuestStatus
} from "../quest/quest-store.js";
import { buildQuestLogViewModel } from "../quest/quest-view-model.js";
import { QUEST_STATUS } from "../quest/quest-schema.js";
import { cls, esc, escUrl, renderEmpty, renderStatusActions } from "./render-utils.js";

let ActiveLogClass = null;
let activeLog = null;

/**
 * Open (or focus) the Quest Log.
 *
 * @param {object} [options]
 * @param {object} [options.api] The MasterQuest API.
 * @param {object} [options.game] The Foundry game object.
 * @param {object} [options.ui] The Foundry ui object.
 * @param {Function} [options.applicationClass] ApplicationV2, injectable for tests.
 * @param {string} [options.tab] Tab to open on.
 * @returns {Promise<object>} The application instance, or a failure descriptor.
 */
export async function openMasterQuestLog({
  api = null,
  game = globalThis.game,
  ui = globalThis.ui,
  applicationClass = globalThis.foundry?.applications?.api?.ApplicationV2,
  tab = QUEST_STATUS.active
} = {}) {
  if (!applicationClass) {
    notifyWarning("O Quest Log do MasterQuest requer Foundry ApplicationV2.", ui);
    return { opened: false, reason: "missing-application-v2" };
  }

  if (!ActiveLogClass || Object.getPrototypeOf(ActiveLogClass.prototype) !== applicationClass.prototype) {
    ActiveLogClass = createMasterQuestLogClass(applicationClass);
  }

  if (!activeLog?.rendered) activeLog = new ActiveLogClass({ api, game, ui, tab });
  else activeLog.activeTab = tab;

  await activeLog.render({ force: true });
  return activeLog;
}

/** Re-render the Quest Log if it is open. Used after a quest changes elsewhere. */
export function refreshMasterQuestLog() {
  if (activeLog?.rendered) activeLog.render({ force: false });
}

/**
 * Build the Quest Log application class over the given ApplicationV2 base.
 *
 * @param {Function} ApplicationV2 The base class.
 * @returns {Function} The Quest Log class.
 */
export function createMasterQuestLogClass(ApplicationV2) {
  return class MasterQuestLog extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-quest-log`,
      classes: ["masterquest", "masterquest-quest-log"],
      tag: "section",
      window: {
        title: "MasterQuest — Quests",
        icon: "fa-solid fa-scroll",
        resizable: true
      },
      position: { width: 820, height: 680 }
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

    constructor({ api = null, game = globalThis.game, ui = globalThis.ui, tab } = {}, options = {}) {
      super(options);
      this.api = api;
      this.game = game;
      this.ui = ui;
      this.activeTab = tab ?? QUEST_STATUS.active;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const game = this.game;

      return {
        ...context,
        model: buildQuestLogViewModel(readAllQuests({ game }), {
          isGM: game?.user?.isGM === true,
          primaryQuestId: getPrimaryQuestId({ game }),
          activeTab: this.activeTab
        })
      };
    }

    async _renderHTML(context) {
      const element = document.createElement("div");
      element.className = "mq-log";
      element.innerHTML = renderQuestLog(context.model);
      return element;
    }

    _replaceHTML(result, content) {
      applyInterfaceSkin(content, { game: this.game });
      content.replaceChildren(result);
      this.activateListeners(result);
    }

    activateListeners(root) {
      root.querySelectorAll("[data-tab-target]").forEach((tab) => {
        tab.addEventListener("click", (event) => {
          event.preventDefault();
          this.activeTab = tab.dataset.tabTarget;
          this.render({ force: false });
        });
      });

      root.querySelectorAll("[data-action='open-quest']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await this.openQuest(node.dataset.questId);
        });
      });

      root.querySelectorAll("[data-action='set-status']").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await setQuestStatus(button.dataset.questId, button.dataset.status, { game: this.game });
          this.render({ force: false });
        });
      });

      root.querySelectorAll("[data-action='toggle-primary']").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await setPrimaryQuestId(button.dataset.questId, { game: this.game });
          this.render({ force: false });
        });
      });

      root.querySelectorAll("[data-action='delete-quest']").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!(await this.confirmDelete(button.dataset.questName))) return;
          await deleteQuest(button.dataset.questId, { game: this.game });
          this.render({ force: false });
        });
      });

      root.querySelectorAll("[data-action='new-quest']").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          const status = button.dataset.status ?? QUEST_STATUS.inactive;
          const quest = await createQuest({ name: "Nova Quest", status }, { game: this.game });
          this.render({ force: false });
          if (quest) await this.openQuest(quest.id);
        });
      });

      this.activateDragAndDrop(root);
    }

    /** Dragging a quest row onto another row files it as a subquest. */
    activateDragAndDrop(root) {
      root.querySelectorAll(".mq-quest-row").forEach((row) => {
        row.addEventListener("dragstart", (event) => {
          event.dataTransfer?.setData("text/plain", JSON.stringify({
            type: "masterquest-quest",
            questId: row.dataset.questId
          }));
          row.classList.add("mq-dragging");
        });

        row.addEventListener("dragend", () => row.classList.remove("mq-dragging"));

        row.addEventListener("dragover", (event) => {
          event.preventDefault();
          row.classList.add("mq-drop-target");
        });

        row.addEventListener("dragleave", () => row.classList.remove("mq-drop-target"));

        row.addEventListener("drop", async (event) => {
          event.preventDefault();
          row.classList.remove("mq-drop-target");

          const payload = readDragPayload(event);
          if (payload?.type !== "masterquest-quest") return;
          if (payload.questId === row.dataset.questId) return;

          const result = await linkSubquest(row.dataset.questId, payload.questId, { game: this.game });
          if (result.status === "cycle") {
            notifyWarning("A quest cannot become its own subquest.", this.ui);
          }
          this.render({ force: false });
        });
      });
    }

    async openQuest(questId) {
      if (!questId) return;
      const { openMasterQuestDetails } = await import("./quest-details.js");
      await openMasterQuestDetails({
        questId,
        api: this.api,
        game: this.game,
        ui: this.ui,
        onChange: () => this.render({ force: false })
      });
    }

    async confirmDelete(name) {
      const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
      if (!DialogV2?.confirm) return true;

      return DialogV2.confirm({
        window: { title: "Excluir quest" },
        content: `<p>Excluir <strong>${esc(name)}</strong>? As subquests não são apagadas, apenas desvinculadas.</p>`,
        rejectClose: false,
        modal: true
      });
    }
  };
}

/**
 * Render the Quest Log body.
 *
 * @param {object} model The view model from `buildQuestLogViewModel`.
 * @returns {string} HTML.
 */
export function renderQuestLog(model) {
  const tabs = model.tabs
    .map(
      (tab) => `<button type="button" class="${cls("mq-tab", tab.active && "is-active")}"
        data-tab-target="${esc(tab.id)}">${esc(tab.label)}
        <span class="mq-tab-count">${esc(tab.count)}</span></button>`
    )
    .join("");

  const rows = model.quests[model.activeTab] ?? [];
  const list = rows.length
    ? rows.map((row) => renderQuestRow(row, model)).join("")
    : renderEmpty("Nenhuma quest nesta aba.");

  const newButton = model.isGM
    ? `<button type="button" class="mq-new-quest" data-action="new-quest" data-status="${esc(model.activeTab)}">
        <i class="fa-solid fa-plus" inert></i> Nova quest</button>`
    : "";

  return `
    <nav class="mq-tabs">${tabs}</nav>
    <header class="mq-log-header">
      <h2>${esc(model.tabs.find((t) => t.active)?.label ?? "Quests")}</h2>
      ${newButton}
    </header>
    <div class="mq-log-body"><ul class="mq-quest-list">${list}</ul></div>
  `;
}

function renderQuestRow(row, model) {
  const icon = row.img
    ? `<div class="mq-quest-icon" data-action="open-quest" data-quest-id="${esc(row.id)}"
        style="background-image:url('${escUrl(row.img)}')" title="${esc(row.giverName)}"></div>`
    : `<div class="mq-quest-icon mq-quest-icon-empty" data-action="open-quest" data-quest-id="${esc(row.id)}"></div>`;

  const badges = [
    row.isPrimary
      ? `<i class="mq-badge mq-primary fa-solid fa-star" title="Quest principal" inert></i>`
      : "",
    model.isGM && row.isHidden
      ? `<i class="mq-badge mq-hidden fa-solid fa-eye-slash" title="Oculta dos jogadores" inert></i>`
      : "",
    row.subquestCount
      ? `<i class="mq-badge mq-branch fa-solid fa-code-branch" title="${esc(row.subquestCount)} subquest(s)" inert></i>`
      : ""
  ].join("");

  const subtitle = row.isSubquest
    ? `<p class="mq-subquest">Subquest de ${esc(row.parentName)}</p>`
    : "";

  const primaryToggle = model.isGM
    ? `<button type="button" class="mq-icon-button" data-action="toggle-primary" data-quest-id="${esc(row.id)}"
        title="${row.isPrimary ? "Remover como principal" : "Definir como principal"}">
        <i class="${row.isPrimary ? "fa-solid" : "fa-regular"} fa-star" inert></i></button>`
    : "";

  const deleteButton = model.isGM
    ? `<button type="button" class="mq-icon-button mq-danger" data-action="delete-quest"
        data-quest-id="${esc(row.id)}" data-quest-name="${esc(row.name)}" title="Excluir quest">
        <i class="fa-solid fa-trash" inert></i></button>`
    : "";

  return `
    <li class="mq-quest-row" data-quest-id="${esc(row.id)}" draggable="true">
      ${icon}
      <div class="mq-quest-title" data-action="open-quest" data-quest-id="${esc(row.id)}">
        <h3>${esc(row.name)} ${badges}</h3>
        ${subtitle}
      </div>
      <div class="mq-quest-count" title="Objectives completed">${esc(row.objectiveBadge)}</div>
      ${renderStatusActions(row.statusActions, row.id)}
      ${primaryToggle}
      ${deleteButton}
    </li>
  `;
}

function readDragPayload(event) {
  try {
    return JSON.parse(event.dataTransfer?.getData("text/plain") ?? "null");
  } catch {
    return null;
  }
}
