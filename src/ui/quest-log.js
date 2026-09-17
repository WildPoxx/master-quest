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
  setQuestStatus,
  setQuestType
} from "../quest/quest-store.js";
import { buildQuestLogViewModel } from "../quest/quest-view-model.js";
import { QUEST_STATUS, nextQuestType } from "../quest/quest-schema.js";
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

      // 1.5.3 — o clique do Mestre no selo circula o tipo, como a severidade dos
      // Dilemas: sem janela, sem campo novo. O jogador recebe o selo como texto.
      root.querySelectorAll("[data-action='cycle-quest-type']").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await setQuestType(button.dataset.questId, nextQuestType(button.dataset.questType || null), { game: this.game });
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

/**
 * 1.5.3 — o selo de tipo (Proposta B de Mario, 2026-09-17): um simbolo entre os icones
 * da linha que DIZ o tipo da quest e, para o Mestre, o troca no clique, circulando
 * main -> subquest -> side -> personal -> faction -> clock. `sequence` so exibe
 * (legado); quest sem tipo mostra a interrogacao apenas ao Mestre — convite a definir,
 * nunca ruido ao jogador. Cores por token, nunca hardcoded (DEC-012).
 */
const QUEST_TYPE_BADGE = Object.freeze({
  main: { icon: "fa-crown", className: "mq-type-main" },
  subquest: { icon: "fa-arrow-turn-up", className: "mq-type-subquest" },
  sequence: { icon: "fa-arrow-turn-up", className: "mq-type-subquest" },
  side: { icon: "fa-bullseye", className: "mq-type-side" },
  personal: { icon: "fa-user", className: "mq-type-personal" },
  faction: { icon: "fa-flag", className: "mq-type-faction" },
  clock: { icon: "fa-clock", className: "mq-type-clock" },
  none: { icon: "fa-circle-question", className: "mq-type-none" }
});

export function renderTypeBadge(row, model) {
  const spec = QUEST_TYPE_BADGE[row.type] ?? QUEST_TYPE_BADGE.none;
  const label = row.typeLabel ?? "Sem tipo";

  if (!model.isGM) {
    if (!row.typeLabel) return "";
    return `<span class="mq-icon-button mq-type-badge ${spec.className}" title="Tipo: ${esc(label)}">
        <i class="fa-solid ${spec.icon}" inert></i></span>`;
  }

  return `<button type="button" class="mq-icon-button mq-type-badge ${spec.className}"
      data-action="cycle-quest-type" data-quest-id="${esc(row.id)}" data-quest-type="${esc(row.type ?? "")}"
      title="Tipo: ${esc(label)} (clique para alternar)">
      <i class="fa-solid ${spec.icon}" inert></i></button>`;
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

  // 1.3.0: etapa que chegou a ser linha propria (o pai nao esta na lista de quem le) diz
  // de quem e etapa — nunca "Subquest de", que era a mentira que esta versao corrige.
  const subtitle = row.isSubquest
    ? `<p class="mq-subquest">Subquest de ${esc(row.parentName)}</p>`
    : row.isSequence && row.parentName
      ? `<p class="mq-subquest">Etapa de ${esc(row.parentName)}</p>`
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
    <li class="${cls("mq-quest-row", row.type === "main" && "mq-quest-main")}" data-quest-id="${esc(row.id)}" draggable="true">
      ${icon}
      <div class="mq-quest-title" data-action="open-quest" data-quest-id="${esc(row.id)}">
        <h3>${esc(row.name)} ${badges}</h3>
        ${subtitle}
        ${renderStages(row, model)}
      </div>
      <div class="mq-quest-count" title="Objectives completed">${esc(row.objectiveBadge)}</div>
      ${renderStatusActions(row.statusActions, row.id)}
      ${renderTypeBadge(row, model)}
      ${primaryToggle}
      ${deleteButton}
    </li>
  `;
}

/**
 * 1.3.0 — as etapas dentro da linha do pai.
 *
 * Para quem joga, o arco e UMA quest: a linha mostra em que etapa a mesa esta e a trilha
 * que ja pode ver. Para o Mestre, cada etapa conserva os botoes de status — avancar de
 * etapa continua sendo gesto dele, feito daqui, sem abrir janela (o modulo nao deriva o
 * status do pai nem da etapa seguinte).
 *
 * @param {object} row A linha do pai, de `buildQuestRow`.
 * @param {object} model O modelo do log.
 * @returns {string} HTML, ou "" quando nao ha etapa.
 */
export function renderStages(row, model) {
  const stages = row.stages ?? [];
  if (!stages.length) return "";

  const current = row.currentStage
    ? `<p class="mq-stage-current">${row.stageTotal
      ? `Etapa ${esc(row.currentStage.position)} de ${esc(row.stageTotal)}`
      : `Etapa ${esc(row.currentStage.position)}`} · ${esc(row.currentStage.name)}</p>`
    : "";

  const items = stages
    .map((stage) => `
      <li class="${cls("mq-stage-row", `mq-stage-${stage.status}`, stage.id === row.currentStage?.id && "is-current", model.isGM && stage.isHidden && "is-hidden")}"
          data-stage-id="${esc(stage.id)}">
        <span class="mq-stage-position">${esc(stage.position)}</span>
        <span class="mq-stage-name" data-action="open-quest" data-quest-id="${esc(stage.id)}">${esc(stage.name)}</span>
        <span class="mq-status mq-status-${esc(stage.status)}">${esc(stage.statusLabel)}</span>
        ${renderStatusActions(stage.statusActions, stage.id)}
      </li>`)
    .join("");

  return `${current}<ol class="mq-stage-list" aria-label="Etapas">${items}</ol>`;
}

function readDragPayload(event) {
  try {
    return JSON.parse(event.dataTransfer?.getData("text/plain") ?? "null");
  } catch {
    return null;
  }
}
