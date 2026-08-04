/**
 * MasterQuest Quest Details.
 *
 * Four tabs — Detalhes, Notas de Jogador, Notas do GM, Gerenciar — reproducing the
 * working surface of Forien's Quest Log on Foundry 14 / ApplicationV2.
 */

import { MODULE_ID } from "../constants.js";
import { filterHeaderControls } from "../foundry/window-controls.js";
import { notifyInfo, notifyWarning } from "../foundry/environment.js";
import { enrichQuestHtml } from "../foundry/enrich.js";
import {
  createQuest,
  getPrimaryQuestId,
  readQuestById,
  saveQuest,
  setPrimaryQuestId,
  setQuestStatus,
  unlinkSubquest
} from "../quest/quest-store.js";
import { buildQuestDetailsViewModel } from "../quest/quest-view-model.js";
import { makeId, normalizeObjective, normalizeReward, reorderById } from "../quest/quest-schema.js";
import { readAllQuests } from "../quest/quest-store.js";
import { cls, esc, escUrl, renderEmpty, renderStatusActions, safeHtml } from "./render-utils.js";

const openWindows = new Map();
let DetailsClass = null;

/**
 * Open (or focus) the details window for a quest.
 *
 * @param {object} options
 * @param {string} options.questId The quest to open.
 * @param {object} [options.api] The MasterQuest API.
 * @param {object} [options.game] The Foundry game object.
 * @param {object} [options.ui] The Foundry ui object.
 * @param {Function} [options.applicationClass] ApplicationV2, injectable for tests.
 * @param {Function} [options.onChange] Called after every write, to refresh the log.
 * @returns {Promise<object>} The application instance, or a failure descriptor.
 */
export async function openMasterQuestDetails({
  questId,
  api = null,
  game = globalThis.game,
  ui = globalThis.ui,
  applicationClass = globalThis.foundry?.applications?.api?.ApplicationV2,
  onChange = null
} = {}) {
  if (!applicationClass) {
    notifyWarning("Os detalhes de quest do MasterQuest requerem Foundry ApplicationV2.", ui);
    return { opened: false, reason: "missing-application-v2" };
  }

  if (!DetailsClass || Object.getPrototypeOf(DetailsClass.prototype) !== applicationClass.prototype) {
    DetailsClass = createMasterQuestDetailsClass(applicationClass);
  }

  const existing = openWindows.get(questId);
  if (existing?.rendered) {
    await existing.render({ force: true });
    return existing;
  }

  const app = new DetailsClass({ questId, api, game, ui, onChange });
  openWindows.set(questId, app);
  await app.render({ force: true });
  return app;
}

/**
 * Build the Quest Details application class over the given ApplicationV2 base.
 *
 * @param {Function} ApplicationV2 The base class.
 * @returns {Function} The Quest Details class.
 */
export function createMasterQuestDetailsClass(ApplicationV2) {
  return class MasterQuestDetails extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["masterquest", "masterquest-quest-details"],
      tag: "section",
      window: { title: "Quest", icon: "fa-solid fa-scroll", resizable: true },
      position: { width: 900, height: 720 }
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

    /**
     * The window title carries the quest name, so switching to Notas do Jogador,
     * Notas do GM or Gerenciar never loses track of which quest is open.
     *
     * @returns {string} The window title.
     */
    get title() {
      const name = this.quest?.name;
      return name ? `Quest - ${name}` : "Quest";
    }

    constructor({ questId, api = null, game = globalThis.game, ui = globalThis.ui, onChange = null } = {}, options = {}) {
      super({ id: `${MODULE_ID}-details-${questId}`, ...options });
      this.questId = questId;
      this.api = api;
      this.game = game;
      this.ui = ui;
      this.onChange = onChange;
      this.activeTab = "details";
    }

    get quest() {
      return readQuestById(this.questId, { game: this.game });
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const quest = this.quest;

      if (!quest) return { ...context, model: null };

      const isGM = this.game?.user?.isGM === true;
      const model = buildQuestDetailsViewModel(quest, {
        isGM,
        canEdit: isGM || quest.entry?.canUserModify?.(this.game?.user, "update") === true,
        primaryQuestId: getPrimaryQuestId({ game: this.game }),
        allQuests: readAllQuests({ game: this.game }),
        activeTab: this.activeTab
      });

      // Enrichment happens HERE, not inside the render functions. This step is async
      // (Foundry resolves each UUID against the world) and this method is already async,
      // so the string builders below stay synchronous and unit-testable outside Foundry.
      model.enriched = {
        description: await enrichQuestHtml(model.description),
        playernotes: await enrichQuestHtml(model.playernotes),
        // secrets: true — as abas do Mestre so existem para o Mestre (guarda isGM no view
        // model), entao esconder dele os proprios blocos secretos nao serviria a ninguem.
        gmnotes: isGM ? await enrichQuestHtml(model.gmnotes, { secrets: true }) : "",
        gmcomments: isGM ? await enrichQuestHtml(model.gmcomments, { secrets: true }) : ""
      };

      return { ...context, model };
    }

    async _renderHTML(context) {
      const element = document.createElement("div");
      element.className = "mq-details";
      element.innerHTML = context.model
        ? renderQuestDetails(context.model)
        : `<p class="mq-empty">Esta quest não existe mais.</p>`;
      return element;
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
      this.activateListeners(result);
    }

    /** Persist a change and refresh both this window and the log. */
    async commit(mutate) {
      const quest = this.quest;
      if (!quest) return;

      await saveQuest(mutate({ ...quest }));
      await this.render({ force: false });
      this.onChange?.();
    }

    activateListeners(root) {
      root.querySelectorAll("[data-tab-target]").forEach((tab) => {
        tab.addEventListener("click", (event) => {
          event.preventDefault();
          this.activeTab = tab.dataset.tabTarget;
          this.render({ force: false });
        });
      });

      this.activateFieldEditors(root);
      this.activateRichEditors(root);
      this.activateObjectiveHandlers(root);
      this.activateRewardHandlers(root);
      this.activateManagementHandlers(root);
      this.activateReordering(root);

      root.querySelectorAll("[data-action='set-status']").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          await setQuestStatus(this.questId, button.dataset.status, { game: this.game });
          await this.render({ force: false });
          this.onChange?.();
        });
      });

      this.activateSnapshotHandlers(root);
    }

    /**
     * A camera do cabecalho e o botao do rodape, ambos ligados na mesma acao.
     *
     * Leitura pura: nada aqui grava flag, muda status ou toca documento. Se o download
     * falhar, o Mestre e avisado — um snapshot que falha em silencio e pior que nenhum,
     * porque ele so descobre quando for procurar o arquivo que nao existe.
     *
     * @param {HTMLElement} root The rendered window body.
     */
    activateSnapshotHandlers(root) {
      root.querySelectorAll("[data-action='snapshot-quest']").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          const { downloadQuestSnapshot } = await import("../quest/quest-snapshot.js");

          try {
            const result = downloadQuestSnapshot({ game: this.game, questId: this.questId });
            notifyInfo(
              `MasterQuest: snapshot de ${result.questCount} quest(s) gerado (${result.filename}).`,
              this.ui
            );
          } catch (error) {
            console.error(`${MODULE_ID} | falha ao gerar o snapshot da quest`, error);
            notifyWarning(
              `MasterQuest não conseguiu gerar o snapshot: ${error?.message ?? error}`,
              this.ui
            );
          }
        });
      });
    }

    /**
     * Inline text and rich-text fields commit on blur.
     *
     * O SELETOR E ESTREITO DE PROPOSITO. Ate a 0.16.0 ele era `[data-field]`, e qualquer
     * elemento com esse atributo entrava no commit-on-blur — inclusive <button>. Um botao
     * tem `.value` == "" e nao e contenteditable, entao perder o foco gravava string vazia
     * por cima do campo: o clique em "Edit" do GM Panel apagava o painel inteiro (DEC-026).
     * So input, textarea, select e caixas contenteditable podem gravar. Botoes declaram seu
     * alvo em `data-target-field`.
     */
    activateFieldEditors(root) {
      const EDITABLE = "input[data-field], textarea[data-field], select[data-field], [data-field][contenteditable]";
      root.querySelectorAll(EDITABLE).forEach((field) => {
        field.addEventListener("blur", async () => {
          // Segunda trava, caso o seletor volte a afrouxar um dia.
          if (field.tagName === "BUTTON") return;
          const key = field.dataset.field;
          const value = field.isContentEditable ? field.innerHTML : field.value;
          const quest = this.quest;
          if (!quest || String(quest[key] ?? "") === String(value)) return;
          await this.commit((draft) => ({ ...draft, [key]: value }));
        });
      });

      root.querySelectorAll("[data-action='pick-image']").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.preventDefault();
          const key = button.dataset.targetField || "splash";
          const { hasFilePicker, pickFilePath } = await import("../foundry/file-picker.js");

          if (!hasFilePicker()) {
            // Degrade instead of failing: the text field is still there to type into.
            notifyWarning(
              "O navegador de arquivos do Foundry não está disponível neste build; use o campo de caminho.",
              this.ui
            );
            return;
          }

          const current = this.quest?.[key] ?? "";
          const picked = await pickFilePath({ type: "image", current, title: "Imagem da quest" });
          if (!picked || picked === current) return;
          await this.commit((draft) => ({ ...draft, [key]: picked }));
        });
      });
    }

    /**
     * Campos de texto rico usam o elemento nativo do Foundry, <prose-mirror> (DEC-027).
     *
     * O elemento faz sozinho o que a 0.16.0 e a 0.17.0 fizeram a mao: alterna leitura e
     * edicao (`toggled`), mostra barra de formatacao, aceita documentos arrastados
     * convertendo em @UUID, e avisa por evento quando o Mestre salva. Aqui so resta ouvir
     * esse evento e gravar. NAO gravamos em blur: o elemento define o momento do salvamento.
     */
    activateRichEditors(root) {
      root.querySelectorAll("prose-mirror[data-mq-field]").forEach((editor) => {
        editor.addEventListener("save", async () => {
          const field = editor.dataset.mqField;
          const quest = this.quest;
          if (!field || !quest) return;

          const value = String(editor.value ?? "");
          if (String(quest[field] ?? "") === value) return;

          await this.commit((draft) => ({ ...draft, [field]: value }));
        });
      });
    }

    activateObjectiveHandlers(root) {
      root.querySelector("[data-action='add-objective']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.commit((draft) => ({
          ...draft,
          // Nasce oculto: revelar é ato deliberado do Mestre, não o padrão.
          objectives: [
            ...draft.objectives,
            normalizeObjective({ id: makeId(), name: "Novo objetivo", hidden: true })
          ]
        }));
      });

      root.querySelectorAll("[data-action='cycle-objective']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          const id = node.dataset.objectiveId;
          await this.commit((draft) => ({
            ...draft,
            objectives: draft.objectives.map((objective) =>
              objective.id === id ? cycleObjectiveState(objective) : objective
            )
          }));
        });
      });

      root.querySelectorAll("[data-action='toggle-objective-hidden']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          const id = node.dataset.objectiveId;
          await this.commit((draft) => ({
            ...draft,
            objectives: draft.objectives.map((objective) =>
              objective.id === id ? { ...objective, hidden: !objective.hidden } : objective
            )
          }));
        });
      });

      root.querySelectorAll("[data-action='delete-objective']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          const id = node.dataset.objectiveId;
          await this.commit((draft) => ({
            ...draft,
            objectives: draft.objectives.filter((objective) => objective.id !== id)
          }));
        });
      });

      root.querySelectorAll("[data-objective-name]").forEach((node) => {
        node.addEventListener("blur", async () => {
          const id = node.dataset.objectiveName;
          const name = node.textContent.trim();
          await this.commit((draft) => ({
            ...draft,
            objectives: draft.objectives.map((objective) =>
              objective.id === id ? { ...objective, name } : objective
            )
          }));
        });
      });
    }

    activateRewardHandlers(root) {
      root.querySelector("[data-action='add-reward']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.commit((draft) => ({
          ...draft,
          rewards: [...draft.rewards, normalizeReward({ id: makeId(), type: "abstract", name: "Nova recompensa" })]
        }));
      });

      for (const [action, patch] of [
        ["toggle-reward-hidden", (reward) => ({ ...reward, hidden: !reward.hidden })],
        ["toggle-reward-locked", (reward) => ({ ...reward, locked: !reward.locked })]
      ]) {
        root.querySelectorAll(`[data-action='${action}']`).forEach((node) => {
          node.addEventListener("click", async (event) => {
            event.preventDefault();
            const id = node.dataset.rewardId;
            await this.commit((draft) => ({
              ...draft,
              rewards: draft.rewards.map((reward) => (reward.id === id ? patch(reward) : reward))
            }));
          });
        });
      }

      root.querySelectorAll("[data-action='delete-reward']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          const id = node.dataset.rewardId;
          await this.commit((draft) => ({
            ...draft,
            rewards: draft.rewards.filter((reward) => reward.id !== id)
          }));
        });
      });

      root.querySelectorAll("[data-reward-name]").forEach((node) => {
        node.addEventListener("blur", async () => {
          const id = node.dataset.rewardName;
          const name = node.textContent.trim();
          await this.commit((draft) => ({
            ...draft,
            rewards: draft.rewards.map((reward) => (reward.id === id ? { ...reward, name } : reward))
          }));
        });
      });

      for (const [action, patch] of [
        ["show-all-rewards", (reward) => ({ ...reward, hidden: false })],
        ["hide-all-rewards", (reward) => ({ ...reward, hidden: true })],
        ["unlock-all-rewards", (reward) => ({ ...reward, locked: false })],
        ["lock-all-rewards", (reward) => ({ ...reward, locked: true })]
      ]) {
        root.querySelector(`[data-action='${action}']`)?.addEventListener("click", async (event) => {
          event.preventDefault();
          await this.commit((draft) => ({ ...draft, rewards: draft.rewards.map(patch) }));
        });
      }
    }

    activateManagementHandlers(root) {
      root.querySelector("[data-action='toggle-primary']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await setPrimaryQuestId(this.questId, { game: this.game });
        await this.render({ force: false });
        this.onChange?.();
      });

      root.querySelector("[data-action='add-subquest']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await createQuest({ name: "Nova subquest" }, { game: this.game, parentId: this.questId });
        await this.render({ force: false });
        this.onChange?.();
      });

      root.querySelectorAll("[data-action='unlink-subquest']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          await unlinkSubquest(this.questId, node.dataset.questId, { game: this.game });
          await this.render({ force: false });
          this.onChange?.();
        });
      });

      root.querySelectorAll("[data-action='open-quest']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          await openMasterQuestDetails({
            questId: node.dataset.questId,
            api: this.api,
            game: this.game,
            ui: this.ui,
            onChange: this.onChange
          });
        });
      });

      root.querySelector("[data-action='configure-ownership']")?.addEventListener("click", (event) => {
        event.preventDefault();
        const quest = this.quest;
        const OwnershipConfig = globalThis.foundry?.applications?.apps?.DocumentOwnershipConfig;
        if (!quest?.entry || !OwnershipConfig) {
          notifyWarning("Configuração de permissões indisponível nesta versão.", this.ui);
          return;
        }
        new OwnershipConfig({ document: quest.entry }).render({ force: true });
      });
    }

    /** Objectives and rewards reorder by dragging their handle. */
    activateReordering(root) {
      for (const [selector, key] of [
        [".mq-objective", "objectives"],
        [".mq-reward", "rewards"]
      ]) {
        root.querySelectorAll(selector).forEach((item) => {
          item.addEventListener("dragstart", (event) => {
            event.dataTransfer?.setData("text/plain", JSON.stringify({ type: key, id: item.dataset.entryId }));
            item.classList.add("mq-dragging");
          });

          item.addEventListener("dragend", () => item.classList.remove("mq-dragging"));
          item.addEventListener("dragover", (event) => {
            event.preventDefault();
            item.classList.add("mq-drop-target");
          });
          item.addEventListener("dragleave", () => item.classList.remove("mq-drop-target"));

          item.addEventListener("drop", async (event) => {
            event.preventDefault();
            item.classList.remove("mq-drop-target");

            let payload = null;
            try {
              payload = JSON.parse(event.dataTransfer?.getData("text/plain") ?? "null");
            } catch {
              return;
            }
            if (payload?.type !== key || payload.id === item.dataset.entryId) return;

            await this.commit((draft) => ({
              ...draft,
              [key]: reorderById(draft[key], payload.id, item.dataset.entryId)
            }));
          });
        });
      }
    }

    async close(options) {
      openWindows.delete(this.questId);
      return super.close(options);
    }
  };
}

/**
 * Advance an objective through open -> completed -> failed -> open.
 *
 * @param {object} objective A normalized objective.
 * @returns {object} The objective in its next state.
 */
export function cycleObjectiveState(objective) {
  if (objective.completed) return { ...objective, completed: false, failed: true };
  if (objective.failed) return { ...objective, completed: false, failed: false };
  return { ...objective, completed: true, failed: false };
}

/**
 * Render the Quest Details body.
 *
 * @param {object} model The view model from `buildQuestDetailsViewModel`.
 * @returns {string} HTML.
 */
export function renderQuestDetails(model) {
  const tabs = model.tabs
    .map(
      (tab) => `<button type="button" class="${cls("mq-tab", tab.active && "is-active")}"
        data-tab-target="${esc(tab.id)}" data-label="${esc(tab.label)}">${esc(tab.label)}</button>`
    )
    .join("");

  const primaryStar = model.canEdit
    ? `<button type="button" class="mq-icon-button" data-action="toggle-primary"
        title="${model.isPrimary ? "Remover como principal" : "Definir como principal"}">
        <i class="${model.isPrimary ? "fa-solid" : "fa-regular"} fa-star" inert></i></button>`
    : "";

  const bodies = {
    details: renderDetailsTab(model),
    playernotes: renderNotesTab(model, "playernotes", "Player Notes"),
    gmnotes: renderNotesTab(model, "gmnotes", "GM Panel"),
    gmcomments: renderNotesTab(model, "gmcomments", "GM Notes"),
    management: renderManagementTab(model)
  };

  return `
    <nav class="mq-tabs">${tabs}${primaryStar}</nav>
    <div class="mq-details-body">${bodies[model.activeTab] ?? bodies.details}</div>
  `;
}

function renderDetailsTab(model) {
  const giver = model.giverImg
    ? `<div class="mq-giver" style="background-image:url('${escUrl(model.giverImg)}')" title="${esc(model.giverName)}"></div>`
    : "";

  const parentLine = model.isSubquest
    ? `<p class="mq-subquest-link" data-action="open-quest" data-quest-id="${esc(model.parentId)}">
        Subquest de ${esc(model.parentName)} <i class="fa-solid fa-link" inert></i></p>`
    : "";

  const description = model.canEdit
    ? `<prose-mirror name="description" data-mq-field="description"
        value="${esc(model.description ?? "")}" toggled="true">${model.enriched?.description ?? ""}</prose-mirror>`
    : `<div class="mq-readonly-html">${safeHtml(model.description)}</div>`;

  const image = renderQuestImage(model, "details");

  return `
    <header class="mq-details-header">
      ${giver}
      <div class="mq-details-heading">
        ${model.canEdit
          ? `<input class="mq-title-input" type="text" data-field="name" value="${esc(model.name)}">`
          : `<h1>${esc(model.name)}</h1>`}
        <p class="mq-status mq-status-${esc(model.status)}">${esc(model.statusLabel)}</p>
        ${parentLine}
      </div>
      <div class="mq-header-actions">
        ${renderSnapshotIcon(model)}
        ${renderStatusActions(model.statusActions, model.id)}
      </div>
    </header>

    <div class="mq-details-columns">
      <section class="mq-description">
        ${image}
        <h2>Descrição</h2>
        ${description}
      </section>

      <div class="mq-details-right">
        ${renderObjectives(model)}
        ${renderRewards(model)}
      </div>
    </div>

    ${renderSnapshotFooter(model)}
  `;
}

/**
 * Snapshot da quest, em dois lugares e um so ato.
 *
 * A camera pequena mora na fileira de status, ao alcance de quem ja esta marcando
 * objetivo; o botao grande mora no rodape, onde a mao vai quando a cena fecha. Os dois
 * disparam a MESMA acao — `snapshot-quest` — e capturam esta quest e as subquests dela,
 * nao o log inteiro: o snapshot geral continua no Hub, que e onde se pensa a campanha.
 *
 * Nao aparece para jogador: o snapshot carrega objetivo oculto e recompensa travada.
 *
 * @param {object} model The quest details view model.
 * @returns {string} HTML.
 */
function renderSnapshotIcon(model) {
  if (!model.isGM) return "";
  return `<button type="button" class="mq-icon-button mq-snapshot-icon" data-action="snapshot-quest"
      title="Snapshot desta quest" aria-label="Snapshot desta quest">
      <i class="fa-solid fa-camera" inert></i></button>`;
}

/**
 * @param {object} model The quest details view model.
 * @returns {string} HTML.
 */
function renderSnapshotFooter(model) {
  if (!model.isGM) return "";
  return `<footer class="mq-details-footer">
      <button type="button" class="mq-snapshot-button" data-action="snapshot-quest"
        title="Baixar o estado desta quest e das subquests em JSON">
        <i class="fa-solid fa-camera" inert></i><span>Snapshot</span></button>
    </footer>`;
}

function renderObjectives(model) {
  const items = model.objectives.length
    ? model.objectives.map((objective) => renderObjective(objective, model)).join("")
    : renderEmpty("Nenhum objetivo ainda.");

  const addButton = model.canEdit
    ? `<button type="button" class="mq-add" data-action="add-objective"><i class="fa-solid fa-plus" inert></i> Objetivo</button>`
    : "";

  return `
    <section class="mq-objectives">
      <header><h2>Objetivos</h2>${addButton}</header>
      <ul class="mq-box">${items}</ul>
    </section>
  `;
}

function renderObjective(objective, model) {
  const state = model.canEdit
    ? `<button type="button" class="mq-state" data-action="cycle-objective" data-objective-id="${esc(objective.id)}"
        title="${esc(objective.stateLabel)}"><i class="fa-solid fa-${esc(objective.state)}" inert></i></button>`
    : `<span class="mq-state" title="${esc(objective.stateLabel)}"><i class="fa-solid fa-${esc(objective.state)}" inert></i></span>`;

  const actions = model.canEdit
    ? `<div class="mq-row-actions">
        <i class="mq-handle fa-solid fa-grip-vertical" title="Arraste para reordenar" inert></i>
        <button type="button" class="mq-icon-button" data-action="toggle-objective-hidden" data-objective-id="${esc(objective.id)}"
          title="${objective.hidden ? "Oculto dos jogadores" : "Visível aos jogadores"}">
          <i class="fa-solid ${objective.hidden ? "fa-eye-slash" : "fa-eye"}" inert></i></button>
        <button type="button" class="mq-icon-button mq-danger" data-action="delete-objective" data-objective-id="${esc(objective.id)}"
          title="Excluir objetivo"><i class="fa-solid fa-trash" inert></i></button>
      </div>`
    : "";

  return `
    <li class="${cls("mq-objective", objective.hidden && "is-hidden")}" data-entry-id="${esc(objective.id)}"
        ${model.canEdit ? 'draggable="true"' : ""}>
      ${state}
      <p class="mq-objective-name" ${model.canEdit ? `contenteditable="true" data-objective-name="${esc(objective.id)}"` : ""}>${esc(objective.name)}</p>
      ${actions}
    </li>
  `;
}

function renderRewards(model) {
  const items = model.rewards.length
    ? model.rewards.map((reward) => renderReward(reward, model)).join("")
    : renderEmpty("Nenhuma recompensa ainda.");

  const bulk = model.canEdit && model.rewards.length
    ? `<button type="button" class="mq-bulk" data-action="${model.allRewardsVisible ? "hide-all-rewards" : "show-all-rewards"}">
         <i class="fa-solid ${model.allRewardsVisible ? "fa-eye-slash" : "fa-eye"}" inert></i>
         ${model.allRewardsVisible ? "Ocultar todas" : "Mostrar todas"}</button>
       <button type="button" class="mq-bulk" data-action="${model.allRewardsUnlocked ? "lock-all-rewards" : "unlock-all-rewards"}">
         <i class="fa-solid ${model.allRewardsUnlocked ? "fa-lock" : "fa-unlock"}" inert></i>
         ${model.allRewardsUnlocked ? "Travar todas" : "Destravar todas"}</button>`
    : "";

  const addButton = model.canEdit
    ? `<button type="button" class="mq-add" data-action="add-reward"><i class="fa-solid fa-plus" inert></i> Recompensa</button>`
    : "";

  return `
    <section class="mq-rewards">
      <header><h2>Recompensas</h2>${bulk}${addButton}</header>
      <ul class="mq-box">${items}</ul>
    </section>
  `;
}

function renderReward(reward, model) {
  const image = reward.img
    ? `<div class="mq-reward-img" style="background-image:url('${escUrl(reward.img)}')"></div>`
    : `<div class="mq-reward-img mq-reward-img-empty"><i class="fa-solid fa-gift" inert></i></div>`;

  const name = reward.revealed ? esc(reward.name) : "Recompensa não revelada";

  const actions = model.canEdit
    ? `<div class="mq-row-actions">
        <i class="mq-handle fa-solid fa-grip-vertical" title="Arraste para reordenar" inert></i>
        <button type="button" class="mq-icon-button" data-action="toggle-reward-hidden" data-reward-id="${esc(reward.id)}"
          title="${reward.hidden ? "Oculta dos jogadores" : "Visível aos jogadores"}">
          <i class="fa-solid ${reward.hidden ? "fa-eye-slash" : "fa-eye"}" inert></i></button>
        <button type="button" class="mq-icon-button" data-action="toggle-reward-locked" data-reward-id="${esc(reward.id)}"
          title="${reward.locked ? "Travada" : "Destravada"}">
          <i class="fa-solid ${reward.locked ? "fa-lock" : "fa-unlock"}" inert></i></button>
        <button type="button" class="mq-icon-button mq-danger" data-action="delete-reward" data-reward-id="${esc(reward.id)}"
          title="Excluir recompensa"><i class="fa-solid fa-trash" inert></i></button>
      </div>`
    : "";

  return `
    <li class="${cls("mq-reward", reward.hidden && "is-hidden", reward.locked && "is-locked")}"
        data-entry-id="${esc(reward.id)}" ${model.canEdit ? 'draggable="true"' : ""}>
      ${image}
      <p class="mq-reward-name" ${model.canEdit ? `contenteditable="true" data-reward-name="${esc(reward.id)}"` : ""}>${name}</p>
      ${actions}
    </li>
  `;
}

/**
 * Aba de texto rico.
 *
 * Quem pode editar recebe o <prose-mirror> do proprio Foundry: `value` carrega a FONTE
 * (`@UUID[...]` intacto) e o conteudo interno carrega o HTML enriquecido que ele mostra
 * enquanto fechado. `toggled` faz o ciclo ler/editar. Quem nao pode editar recebe HTML
 * enriquecido e nada mais — nenhuma superficie de escrita.
 */
function renderNotesTab(model, field, label) {
  const enriched = model.enriched?.[field] ?? safeHtml(model[field] ?? "");
  // So o fasciculo recebe a tipografia de documento. GM Notes e rascunho: fica com a
  // caixa comum, porque tratar rabisco de mesa como pagina impressa mente sobre o que ele e.
  const isPanel = field === "gmnotes";

  const body = model.canEdit
    ? `<prose-mirror class="${cls("mq-notes-read", isPanel && "mq-panel-doc")}"
        name="${esc(field)}" data-mq-field="${esc(field)}"
        value="${esc(model[field] ?? "")}" toggled="true">${
        enriched || ""
      }</prose-mirror>`
    : `<div class="${cls("mq-readonly-html", "mq-notes-read", isPanel && "mq-panel-doc")}">${
        enriched || `<p class="mq-empty">Nothing here yet.</p>`
      }</div>`;

  return `
    <section class="${cls("mq-notes", isPanel && "mq-gm-panel")}">
      <header class="mq-notes-header">
        <h2>${esc(label)}</h2>
      </header>
      ${body}
    </section>
  `;
}

function renderManagementTab(model) {
  const subquests = model.subquests.length
    ? model.subquests
        .map(
          (sub) => `<li class="mq-subquest-item">
            ${sub.isPrimary ? '<i class="mq-badge mq-primary fa-solid fa-star" inert></i>' : ""}
            <h3 data-action="open-quest" data-quest-id="${esc(sub.id)}">${esc(sub.name)}</h3>
            <span class="mq-status mq-status-${esc(sub.status)}">${esc(sub.statusLabel)}</span>
            <button type="button" class="mq-icon-button" data-action="unlink-subquest" data-quest-id="${esc(sub.id)}"
              title="Desvincular subquest"><i class="fa-solid fa-link-slash" inert></i></button>
          </li>`
        )
        .join("")
    : renderEmpty("Nenhuma subquest.");

  const splash = model.splash
    ? `<div class="mq-splash" style="background-image:url('${escUrl(model.splash)}');background-position:${esc(model.splashPos)}"></div>`
    : `<div class="mq-splash mq-splash-empty"><span>Sem splash art</span></div>`;

  return `
    <div class="mq-management">
      <section>
        <h2>Configurações</h2>
        <button type="button" class="mq-bulk" data-action="configure-ownership">
          <i class="fa-solid fa-lock" inert></i> Configurar permissões</button>
        <label class="mq-field">
          <span>Splash art</span>
          <span class="mq-file-field">
            <input type="text" data-field="splash" value="${esc(model.splash)}" placeholder="caminho/da/imagem.webp">
            <button type="button" class="mq-browse" data-action="pick-image" data-target-field="splash"
              title="Procurar no diretório do Foundry"><i class="fa-solid fa-folder-open" inert></i></button>
          </span>
        </label>
        ${splash}
      </section>

      <section class="mq-subquests">
        <header>
          <h2>Ramificação</h2>
          <button type="button" class="mq-add" data-action="add-subquest">
            <i class="fa-solid fa-plus" inert></i> Subquest</button>
        </header>
        <ul class="mq-box">${subquests}</ul>
      </section>
    </div>
  `;
}

/**
 * The quest image, shown above the description and settable from either tab.
 *
 * There is one image per quest — the `splash` field. Surfacing it in Detalhes as well as
 * in Gerenciar gives two places to set the same thing, rather than a second image field
 * with unclear semantics.
 *
 * @param {object} model The quest details view model.
 * @param {string} where Which tab is rendering, used to scope the control ids.
 * @returns {string} HTML.
 */
export function renderQuestImage(model, where = "details") {
  if (!model.splash && !model.canEdit) return "";

  const picture = model.splash
    ? `<div class="mq-quest-image" style="background-image:url('${escUrl(model.splash)}');background-position:${esc(model.splashPos)}"></div>`
    : `<div class="mq-quest-image mq-quest-image-empty"><span>Sem imagem</span></div>`;

  const control = model.canEdit
    ? `<button type="button" class="mq-browse mq-quest-image-pick" data-action="pick-image" data-target-field="splash"
        data-where="${esc(where)}">
        <i class="fa-solid fa-image" inert></i> ${model.splash ? "Trocar imagem" : "Escolher imagem"}</button>`
    : "";

  return `<figure class="mq-quest-image-wrap">${picture}${control}</figure>`;
}
