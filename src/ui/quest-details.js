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
import { diffQuestForLog, logToMarkdown, sessionHeading } from "../quest/quest-log-diff.js";
import { SEVERITIES, currentSession, makeId, normalizeClue, normalizeComplication, normalizeDilemma, normalizeLogEntry, normalizeObjective, normalizeOutcome, normalizeReward, normalizeSession, reorderById } from "../quest/quest-schema.js";
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
    notifyWarning("MasterQuest quest details require Foundry ApplicationV2.", ui);
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

      // Sumario do painel: derivado do HTML de exibicao, nunca gravado (ver buildPanelToc).
      const paneled = buildPanelToc(model.enriched.gmnotes);
      model.enriched.gmnotes = paneled.html;
      model.gmnotesToc = paneled.toc;

      return { ...context, model };
    }

    async _renderHTML(context) {
      const element = document.createElement("div");
      element.className = "mq-details";
      element.innerHTML = context.model
        ? renderQuestDetails(context.model)
        : `<p class="mq-empty">This quest no longer exists.</p>`;
      return element;
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
      this.activateListeners(result);
    }

    /**
     * Persist a change and refresh both this window and the log.
     *
     * DEC-032: toda mutacao passa por aqui, entao o diff do Log mora AQUI — nenhum
     * handler precisa lembrar de logar, nenhum handler esquece. A razao nasce vazia.
     */
    async commit(mutate) {
      const quest = this.quest;
      if (!quest) return;

      let next = mutate({ ...quest });
      // 0.23: cada linha nasce carimbada com a sessao corrente — e assim que a aba Log
      // agrupa por sessao sem precisar adivinhar depois.
      const session = currentSession(quest)?.number ?? null;
      const entries = diffQuestForLog(quest, next, Date.now(), session);
      if (entries.length) next = { ...next, log: [...(next.log ?? []), ...entries] };

      await saveQuest(next);
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

      this.activateLogHandlers(root);
      this.activateSessionHandlers(root);
      this.activateWrapupHandlers(root);

      root.querySelectorAll("[data-action='toc-jump']").forEach((node) => {
        node.addEventListener("click", (event) => {
          // Salto local por scrollIntoView, nunca por href: âncora de URL dentro de uma
          // janela do Foundry navegaria a aplicação inteira.
          event.preventDefault();
          root.querySelector(`#${CSS.escape(node.dataset.target)}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      });

      this.activateSnapshotHandlers(root);
    }

    /**
     * 0.23: o Log e do Mestre — registro de ficcao, nao trilha de auditoria. Toda linha
     * e editavel (alvo, mudanca, razao), apagavel, e ha inclusao manual. A pesquisa de
     * 2026-08-06 confirmou: nenhuma ferramenta do dominio faz log append-only; a
     * soberania editorial do Mestre e universal. `origin` so distingue quem escreveu
     * primeiro — o modulo ou a mao.
     */
    activateLogHandlers(root) {
      for (const [selector, field] of [
        ["[data-log-reason]", "reason"],
        ["[data-log-target]", "target"],
        ["[data-log-change]", "change"]
      ]) {
        root.querySelectorAll(selector).forEach((node) => {
          node.addEventListener("blur", async () => {
            const id = node.dataset.logReason ?? node.dataset.logTarget ?? node.dataset.logChange;
            const value = node.textContent.trim();
            await this.commit((draft) => ({
              ...draft,
              log: (draft.log ?? []).map((item) => (item.id === id ? { ...item, [field]: value } : item))
            }));
          });
        });
      }

      root.querySelectorAll("[data-action='log-delete']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          const id = node.dataset.itemId;
          await this.commit((draft) => ({
            ...draft,
            log: (draft.log ?? []).filter((item) => item.id !== id)
          }));
        });
      });

      root.querySelector("[data-action='log-add-manual']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.commit((draft) => ({
          ...draft,
          log: [...(draft.log ?? []), normalizeLogEntry({
            id: makeId(),
            at: Date.now(),
            target: "New entry",
            targetType: "note",
            change: "",
            session: currentSession(draft)?.number ?? null,
            origin: "manual"
          })]
        }));
      });

      // Push-to-notes (0.23): herdar do Log e gesto DELIBERADO, linha a linha — nunca
      // sincronizacao automatica. O esqueleto vem do gerenciado; o texto final e do
      // Mestre, que edita o paragrafo no proprio campo depois. Precedente: drop-link
      // da 0.17.0 — o modulo escreve um paragrafo simples no fim do campo, nada mais.
      for (const [action, field] of [
        ["log-push-gm", "gmcomments"],
        ["log-push-player", "playernotes"]
      ]) {
        root.querySelectorAll(`[data-action='${action}']`).forEach((node) => {
          node.addEventListener("click", async (event) => {
            event.preventDefault();
            const id = node.dataset.itemId;
            await this.commit((draft) => {
              const item = (draft.log ?? []).find((x) => x.id === id);
              if (!item) return draft;
              const stamp = item.session != null ? `Session ${item.session}: ` : "";
              const line = `<p><em>${stamp}</em>${esc(item.target)} — ${esc(item.change)}${item.reason ? ` — ${esc(item.reason)}` : ""}</p>`;
              return { ...draft, [field]: `${draft[field] ?? ""}${line}` };
            });
            notifyInfo(field === "gmcomments" ? "Sent to GM Notes." : "Sent to Player Notes.", this.ui);
          });
        });
      }

      root.querySelector("[data-action='log-copy-markdown']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const quest = this.quest;
        await navigator.clipboard?.writeText(logToMarkdown(quest?.name ?? "", quest?.log ?? [], quest?.sessions ?? []));
        notifyInfo("Log copied as Markdown.", this.ui);
      });

      root.querySelector("[data-action='log-copy-json']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const quest = this.quest;
        await navigator.clipboard?.writeText(JSON.stringify(quest?.log ?? [], null, 2));
        notifyInfo("Log copied as JSON.", this.ui);
      });
    }

    /**
     * 0.23: sessao de jogo — o marcador de tempo de mesa. "New session" abre a proxima
     * (numero + 1, data de hoje); numero, data e subtitulo sao editaveis em linha. A
     * sessao corrente e sempre a de maior numero; o commit() carimba cada linha nova do
     * Log com ela.
     */
    activateSessionHandlers(root) {
      root.querySelector("[data-action='session-new']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.commit((draft) => {
          const next = (currentSession(draft)?.number ?? 0) + 1;
          const today = new Date().toISOString().slice(0, 10);
          return {
            ...draft,
            sessions: [...(draft.sessions ?? []), normalizeSession({ number: next, date: today, title: "" })]
          };
        });
      });

      root.querySelectorAll("[data-session-field]").forEach((node) => {
        node.addEventListener("blur", async () => {
          const field = node.dataset.sessionField;
          const number = Number(node.dataset.sessionNumber);
          const value = node.textContent.trim();
          await this.commit((draft) => ({
            ...draft,
            sessions: (draft.sessions ?? []).map((s) =>
              s.number === number ? normalizeSession({ ...s, [field]: field === "number" ? Number(value) || s.number : value }) : s
            )
          }));
        });
      });
    }

    /**
     * 0.23: o encerramento editorial. `wrappedUp` e flag da mesa, reversivel, e NAO toca
     * o status — status e a ficcao; Wrap Up e fechar o caderno. Com o caderno fechado, o
     * botao de relatorio gera a ata consolidada em Markdown (leitura pura, como o
     * snapshot).
     */
    activateWrapupHandlers(root) {
      root.querySelector("[data-action='toggle-wrapup']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.commit((draft) => ({ ...draft, wrappedUp: draft.wrappedUp !== true }));
      });

      root.querySelector("[data-action='wrapup-report']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const { downloadWrapupReport } = await import("../reports/quest-wrapup-report.js");
        try {
          const result = downloadWrapupReport(this.quest);
          notifyInfo(`MasterQuest: wrap-up report generated (${result.filename}).`, this.ui);
        } catch (error) {
          console.error(`${MODULE_ID} | falha ao gerar o relatorio de wrap-up`, error);
          notifyWarning(`MasterQuest could not build the wrap-up report: ${error?.message ?? error}`, this.ui);
        }
      });
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
              `MasterQuest: snapshot of ${result.questCount} quest(s) generated (${result.filename}).`,
              this.ui
            );
          } catch (error) {
            console.error(`${MODULE_ID} | falha ao gerar o snapshot da quest`, error);
            notifyWarning(
              `MasterQuest could not generate the snapshot: ${error?.message ?? error}`,
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
              "The Foundry file browser is not available in this build; use the path field.",
              this.ui
            );
            return;
          }

          const current = this.quest?.[key] ?? "";
          const picked = await pickFilePath({ type: "image", current, title: "Quest image" });
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
            normalizeObjective({ id: makeId(), name: "New objective", hidden: true })
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

      root.querySelectorAll("[data-action='toggle-objective-known']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          const id = node.dataset.objectiveId;
          await this.commit((draft) => ({
            ...draft,
            objectives: draft.objectives.map((o) => (o.id === id ? { ...o, known: !o.known } : o))
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
          rewards: [...draft.rewards, normalizeReward({ id: makeId(), type: "abstract", name: "New reward" })]
        }));
      });

      for (const [action, patch] of [
        ["toggle-reward-hidden", (reward) => ({ ...reward, hidden: !reward.hidden })],
        ["toggle-reward-granted", (reward) => ({ ...reward, granted: !reward.granted })],
        ["toggle-reward-known", (reward) => ({ ...reward, known: !reward.known })]
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

      // ------- DEC-035: dilemmas, complications, clues, outcomes -------
      root.querySelector("[data-action='add-dilemma']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.commit((draft) => ({
          ...draft,
          dilemmas: [...(draft.dilemmas ?? []), normalizeDilemma({ id: makeId(), name: "New dilemma" })]
        }));
      });

      root.querySelector("[data-action='add-clue']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.commit((draft) => ({
          ...draft,
          clues: [...(draft.clues ?? []), normalizeClue({ id: makeId(), name: "New clue" })]
        }));
      });

      root.querySelector("[data-action='add-outcome']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.commit((draft) => ({
          ...draft,
          outcomes: [...(draft.outcomes ?? []), normalizeOutcome({ id: makeId(), name: "New outcome" })]
        }));
      });

      root.querySelector("[data-action='add-complication']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.commit((draft) => ({
          ...draft,
          complications: [...(draft.complications ?? []), normalizeComplication({ id: makeId(), name: "New complication" })]
        }));
      });

      for (const [action, collection, patch] of [
        ["toggle-dilemma-hidden", "dilemmas", (item) => ({ ...item, hidden: !item.hidden })],
        ["toggle-dilemma-known", "dilemmas", (item) => ({ ...item, known: !item.known })],
        // Problema nao tem checkbox: resolve-se. O gesto e reversivel — reabrir preserva
        // o texto do desfecho ja escrito.
        ["toggle-dilemma-state", "dilemmas", (item) => ({ ...item, state: item.state === "resolved" ? "open" : "resolved" })],
        ["toggle-complication-hidden", "complications", (item) => ({ ...item, hidden: !item.hidden })],
        ["toggle-complication-known", "complications", (item) => ({ ...item, known: !item.known })],
        ["toggle-complication-fired", "complications", (item) => ({ ...item, fired: !item.fired })],
        ["toggle-clue-hidden", "clues", (item) => ({ ...item, hidden: !item.hidden })],
        ["toggle-clue-known", "clues", (item) => ({ ...item, known: !item.known })],
        ["toggle-clue-found", "clues", (item) => ({ ...item, found: !item.found })],
        ["toggle-outcome-hidden", "outcomes", (item) => ({ ...item, hidden: !item.hidden })],
        ["toggle-outcome-known", "outcomes", (item) => ({ ...item, known: !item.known })],
        ["toggle-outcome-occurred", "outcomes", (item) => ({ ...item, occurred: !item.occurred })],
        ["cycle-complication-severity", "complications", (item) => ({
          ...item,
          severity: SEVERITIES[(SEVERITIES.indexOf(item.severity) + 1) % SEVERITIES.length]
        })],
        // 0.23: dilema ganha a mesma escada leve/grave/severa (Mario, 2026-08-06).
        ["cycle-dilemma-severity", "dilemmas", (item) => ({
          ...item,
          severity: SEVERITIES[(SEVERITIES.indexOf(item.severity) + 1) % SEVERITIES.length]
        })]
      ]) {
        root.querySelectorAll(`[data-action='${action}']`).forEach((node) => {
          node.addEventListener("click", async (event) => {
            event.preventDefault();
            const id = node.dataset.itemId;
            await this.commit((draft) => ({
              ...draft,
              [collection]: (draft[collection] ?? []).map((item) => (item.id === id ? patch(item) : item))
            }));
          });
        });
      }

      for (const [action, collection] of [
        ["delete-dilemma", "dilemmas"],
        ["delete-complication", "complications"],
        ["delete-clue", "clues"],
        ["delete-outcome", "outcomes"]
      ]) {
        root.querySelectorAll(`[data-action='${action}']`).forEach((node) => {
          node.addEventListener("click", async (event) => {
            event.preventDefault();
            const id = node.dataset.itemId;
            await this.commit((draft) => ({
              ...draft,
              [collection]: (draft[collection] ?? []).filter((item) => item.id !== id)
            }));
          });
        });
      }

      for (const [selector, collection, field] of [
        ["[data-dilemma-name]", "dilemmas", "name"],
        ["[data-dilemma-resolution]", "dilemmas", "resolution"],
        ["[data-complication-name]", "complications", "name"],
        ["[data-clue-name]", "clues", "name"],
        ["[data-outcome-name]", "outcomes", "name"],
        ["[data-outcome-record]", "outcomes", "record"]
      ]) {
        root.querySelectorAll(selector).forEach((node) => {
          node.addEventListener("blur", async () => {
            const id = node.dataset.dilemmaName ?? node.dataset.dilemmaResolution ?? node.dataset.complicationName ?? node.dataset.clueName ?? node.dataset.outcomeName ?? node.dataset.outcomeRecord;
            const value = node.textContent.trim();
            await this.commit((draft) => ({
              ...draft,
              [collection]: (draft[collection] ?? []).map((item) => (item.id === id ? { ...item, [field]: value } : item))
            }));
          });
        });
      }

      for (const [action, patch] of [
        ["show-all-rewards", (reward) => ({ ...reward, hidden: false })],
        ["hide-all-rewards", (reward) => ({ ...reward, hidden: true })],
        ["grant-all-rewards", (reward) => ({ ...reward, granted: true })],
        ["ungrant-all-rewards", (reward) => ({ ...reward, granted: false })]
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
        await createQuest({ name: "New subquest" }, { game: this.game, parentId: this.questId });
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
          notifyWarning("Permission configuration is unavailable in this build.", this.ui);
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
        title="${model.isPrimary ? "Unset as primary" : "Set as primary"}">
        <i class="${model.isPrimary ? "fa-solid" : "fa-regular"} fa-star" inert></i></button>`
    : "";

  const bodies = {
    details: renderDetailsTab(model),
    playernotes: renderNotesTab(model, "playernotes", "Player Notes"),
    gmnotes: renderNotesTab(model, "gmnotes", "GM Panel"),
    gmcomments: renderNotesTab(model, "gmcomments", "GM Notes"),
    log: renderLogTab(model),
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
        Subquest of ${esc(model.parentName)} <i class="fa-solid fa-link" inert></i></p>`
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
        <p class="mq-status mq-status-${esc(model.status)}">${esc(model.statusLabel)}${
          model.isGM && model.wrappedUp ? ` <span class="mq-pill mq-wrapped-pill" title="Records closed — reopen from the footer">wrapped up</span>` : ""
        }</p>
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
        <h2>Description</h2>
        ${description}
        ${renderSessionControl(model)}
      </section>

      <div class="mq-details-right">
        ${renderDilemmas(model)}
        ${renderObjectives(model)}
        ${renderClues(model)}
        ${renderRewards(model)}
        ${renderComplications(model)}
        ${renderOutcomes(model)}
      </div>
    </div>

    ${renderSnapshotFooter(model)}
  `;
}

/**
 * 0.23 (Mario, 2026-08-06): a sessao corrente, logo abaixo da Description. Numero, data
 * e subtitulo editaveis em linha; "New session" abre a proxima. So o Mestre ve — sessao
 * e instrumento de conducao, e o Log agrupa por ela.
 */
function renderSessionControl(model) {
  if (!model.isGM) return "";
  const session = model.session;

  const current = session
    ? `<span class="mq-session-current">
        <i class="fa-solid fa-clapperboard" inert></i>
        <span class="mq-session-label">Session</span>
        <span class="mq-session-number" ${model.canEdit ? `contenteditable="true" data-session-field="number" data-session-number="${session.number}"` : ""}>${session.number}</span>
        <span class="mq-session-date" ${model.canEdit ? `contenteditable="true" data-session-field="date" data-session-number="${session.number}"` : ""}>${esc(session.date)}</span>
        <span class="${cls("mq-session-title", !session.title && "is-pending")}" ${model.canEdit ? `contenteditable="true" data-session-field="title" data-session-number="${session.number}"` : ""}>${esc(session.title)}</span>
      </span>`
    : `<span class="mq-session-current mq-session-none">No session opened yet.</span>`;

  const newButton = model.canEdit
    ? `<button type="button" class="mq-bulk" data-action="session-new"><i class="fa-solid fa-plus" inert></i> New session</button>`
    : "";

  return `
    <div class="mq-session" aria-label="Current session">
      ${current}
      ${newButton}
    </div>
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
      title="Snapshot of this quest" aria-label="Snapshot of this quest">
      <i class="fa-solid fa-camera" inert></i></button>`;
}

/**
 * @param {object} model The quest details view model.
 * @returns {string} HTML.
 */
function renderSnapshotFooter(model) {
  if (!model.isGM) return "";

  // 0.23: o encerramento editorial, a esquerda do Snapshot (Mario, 2026-08-06).
  // Reversivel; com o caderno fechado aparece o botao da ata consolidada.
  const wrapup = `<button type="button" class="${cls("mq-snapshot-button", "mq-wrapup-button", model.wrappedUp && "is-wrapped")}" data-action="toggle-wrapup"
      title="${model.wrappedUp ? "Reopen this quest's records" : "Close the book on this quest"}">
      <i class="fa-solid ${model.wrappedUp ? "fa-book" : "fa-book-open"}" inert></i><span>${model.wrappedUp ? "Reopen" : "Wrap Up"}</span></button>`;

  const report = model.wrappedUp
    ? `<button type="button" class="mq-snapshot-button mq-wrapup-report" data-action="wrapup-report"
        title="Download the consolidated wrap-up report (Markdown)">
        <i class="fa-solid fa-file-lines" inert></i><span>Report</span></button>`
    : "";

  return `<footer class="mq-details-footer">
      ${wrapup}${report}
      <button type="button" class="mq-snapshot-button" data-action="snapshot-quest"
        title="Download this quest and its subquests as JSON">
        <i class="fa-solid fa-camera" inert></i><span>Snapshot</span></button>
    </footer>`;
}


/**
 * DEC-035. Problema nao tem checkbox: nao se cumpre, RESOLVE-SE, e a saida e um texto.
 * A linha usa marcador proprio (losango) e o gesto "Resolve" abre espaco para o desfecho —
 * se a linha parecesse objetivo, o Mestre tentaria marca-la como concluida.
 */

/**
 * Pistas (Mario, 2026-08-05): informacao que aponta o caminho. Nao e posse — vem antes de
 * Rewards na ordem canonica porque e o que LEVA a elas. A lupa registra "a mesa achou".
 */
function renderClues(model) {
  if (!model.isGM && !model.clues.length) return "";

  const items = model.clues.length
    ? model.clues.map((clue) => renderClue(clue, model)).join("")
    : renderEmpty("No clues yet.");

  const addButton = model.canEdit
    ? `<button type="button" class="mq-add" data-action="add-clue"><i class="fa-solid fa-plus" inert></i> Clue</button>`
    : "";

  return `
    <section class="mq-clues">
      <header><h2>Clues</h2>${addButton}</header>
      <ul class="mq-box">${items}</ul>
    </section>
  `;
}

function renderClue(clue, model) {
  const known = model.isGM
    ? model.canEdit
      ? `<button type="button" class="${cls("mq-known", clue.known && "is-known")}" data-action="toggle-clue-known" data-item-id="${esc(clue.id)}"
          title="${clue.known ? "The PCs know of this, in fiction" : "The PCs do not know of this yet"}">
          <i class="${clue.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></button>`
      : `<span class="${cls("mq-known", clue.known && "is-known")}"><i class="${clue.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></span>`
    : "";

  const found = model.canEdit
    ? `<button type="button" class="${cls("mq-icon-button", "mq-found", clue.found && "is-found")}" data-action="toggle-clue-found" data-item-id="${esc(clue.id)}"
        title="${clue.found ? "The party has this clue" : "Not found yet"}">
        <i class="fa-solid ${clue.found ? "fa-magnifying-glass-plus" : "fa-magnifying-glass"}" inert></i></button>`
    : `<span class="${cls("mq-icon-button", "mq-found", clue.found && "is-found")}"><i class="fa-solid ${clue.found ? "fa-magnifying-glass-plus" : "fa-magnifying-glass"}" inert></i></span>`;

  const actions = model.canEdit
    ? `<div class="mq-row-actions">
        <button type="button" class="mq-icon-button" data-action="toggle-clue-hidden" data-item-id="${esc(clue.id)}"
          title="${clue.hidden ? "Hidden from players" : "Visible to players"}">
          <i class="fa-solid ${clue.hidden ? "fa-eye-slash" : "fa-eye"}" inert></i></button>
        <button type="button" class="mq-icon-button mq-danger" data-action="delete-clue" data-item-id="${esc(clue.id)}"
          title="Delete clue"><i class="fa-solid fa-trash" inert></i></button>
      </div>`
    : "";

  return `
    <li class="${cls("mq-clue", clue.hidden && "is-hidden", clue.found && "is-found", model.isGM && clue.spoiler && "is-spoiler")}" data-entry-id="${esc(clue.id)}">
      <div class="mq-knot-row">
        ${known}${found}
        <p class="mq-knot-name" ${model.canEdit ? `contenteditable="true" data-clue-name="${esc(clue.id)}"` : ""}>${esc(clue.name)}</p>
        ${actions}
      </div>
    </li>
  `;
}

/**
 * Outcomes (Mario, 2026-08-05): como a quest pode terminar — e como terminou. Secao FINAL
 * da Details, sempre. Outcome nao e recompensa: posse e registro sao categorias
 * diferentes. `occurred` marca o acontecido; `record` guarda o que de fato se deu.
 */
function renderOutcomes(model) {
  if (!model.isGM && !model.outcomes.length) return "";

  const items = model.outcomes.length
    ? model.outcomes.map((outcome) => renderOutcome(outcome, model)).join("")
    : renderEmpty("No outcomes yet.");

  const addButton = model.canEdit
    ? `<button type="button" class="mq-add" data-action="add-outcome"><i class="fa-solid fa-plus" inert></i> Outcome</button>`
    : "";

  return `
    <section class="mq-outcomes">
      <header><h2>Outcomes</h2>${addButton}</header>
      <ul class="mq-box">${items}</ul>
    </section>
  `;
}

function renderOutcome(outcome, model) {
  const known = model.isGM
    ? model.canEdit
      ? `<button type="button" class="${cls("mq-known", outcome.known && "is-known")}" data-action="toggle-outcome-known" data-item-id="${esc(outcome.id)}"
          title="${outcome.known ? "The PCs know this ending is possible" : "The PCs do not know of this yet"}">
          <i class="${outcome.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></button>`
      : `<span class="${cls("mq-known", outcome.known && "is-known")}"><i class="${outcome.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></span>`
    : "";

  const marker = `<span class="${cls("mq-knot-marker", outcome.occurred && "is-resolved")}" title="${outcome.occurred ? "Occurred" : "Possible"}">
      <i class="fa-solid ${outcome.occurred ? "fa-flag-checkered" : "fa-flag"}" inert></i></span>`;

  const record = outcome.occurred
    ? `<p class="mq-knot-text" ${model.canEdit ? `contenteditable="true" data-outcome-record="${esc(outcome.id)}"` : ""}>${
        esc(outcome.record) || (model.canEdit ? "What actually happened? Write the record." : "")
      }</p>`
    : "";

  const table = outcome.table
    ? `<span class="mq-knot-ref" title="Outcome table"><i class="fa-solid fa-dice" inert></i> ${esc(outcome.table)}</span>`
    : "";

  const actions = model.canEdit
    ? `<div class="mq-row-actions">
        <button type="button" class="mq-bulk mq-resolve" data-action="toggle-outcome-occurred" data-item-id="${esc(outcome.id)}">${outcome.occurred ? "Undo" : "It happened"}</button>
        <button type="button" class="mq-icon-button" data-action="toggle-outcome-hidden" data-item-id="${esc(outcome.id)}"
          title="${outcome.hidden ? "Hidden from players" : "Visible to players"}">
          <i class="fa-solid ${outcome.hidden ? "fa-eye-slash" : "fa-eye"}" inert></i></button>
        <button type="button" class="mq-icon-button mq-danger" data-action="delete-outcome" data-item-id="${esc(outcome.id)}"
          title="Delete outcome"><i class="fa-solid fa-trash" inert></i></button>
      </div>`
    : "";

  return `
    <li class="${cls("mq-outcome", outcome.hidden && "is-hidden", outcome.occurred && "is-resolved", model.isGM && outcome.spoiler && "is-spoiler")}" data-entry-id="${esc(outcome.id)}">
      <div class="mq-knot-row">
        ${known}${marker}
        <p class="mq-knot-name" ${model.canEdit ? `contenteditable="true" data-outcome-name="${esc(outcome.id)}"` : ""}>${esc(outcome.name)}</p>
        ${table}
        ${actions}
      </div>
      ${record}
    </li>
  `;
}

function renderDilemmas(model) {
  if (!model.isGM && !model.dilemmas.length) return "";

  const items = model.dilemmas.length
    ? model.dilemmas.map((dilemma) => renderDilemma(dilemma, model)).join("")
    : renderEmpty("No dilemmas yet.");

  const addButton = model.canEdit
    ? `<button type="button" class="mq-add" data-action="add-dilemma"><i class="fa-solid fa-plus" inert></i> Dilemma</button>`
    : "";

  return `
    <section class="mq-dilemmas">
      <header><h2>Dilemmas</h2>${addButton}</header>
      <ul class="mq-box">${items}</ul>
    </section>
  `;
}

function renderDilemma(dilemma, model) {
  const known = model.isGM
    ? model.canEdit
      ? `<button type="button" class="${cls("mq-known", dilemma.known && "is-known")}" data-action="toggle-dilemma-known" data-item-id="${esc(dilemma.id)}"
          title="${dilemma.known ? "The PCs know of this, in fiction" : "The PCs do not know of this yet"}">
          <i class="${dilemma.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></button>`
      : `<span class="${cls("mq-known", dilemma.known && "is-known")}"><i class="${dilemma.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></span>`
    : "";

  const resolved = dilemma.state === "resolved";
  const marker = `<span class="${cls("mq-knot-marker", resolved && "is-resolved")}" title="${resolved ? "Resolved" : "Open"}">
      <i class="fa-solid ${resolved ? "fa-diamond" : "fa-diamond-exclamation"}" inert></i></span>`;

  // 0.23: a mesma escada leve/grave/severa da complicacao — quanto pesa a pergunta.
  const severity = model.canEdit
    ? `<button type="button" class="mq-pill mq-severity mq-severity-${esc(dilemma.severity)}" data-action="cycle-dilemma-severity"
        data-item-id="${esc(dilemma.id)}" title="Severity — click to cycle">${esc(dilemma.severity)}</button>`
    : `<span class="mq-pill mq-severity mq-severity-${esc(dilemma.severity)}">${esc(dilemma.severity)}</span>`;

  const resolution = resolved
    ? `<p class="mq-knot-text" ${model.canEdit ? `contenteditable="true" data-dilemma-resolution="${esc(dilemma.id)}"` : ""}>${
        esc(dilemma.resolution) || (model.canEdit ? "How did it resolve? Write the outcome." : "")
      }</p>`
    : "";

  const table = dilemma.table
    ? `<span class="mq-knot-ref" title="Outcome table"><i class="fa-solid fa-dice" inert></i> ${esc(dilemma.table)}</span>`
    : "";

  const actions = model.canEdit
    ? `<div class="mq-row-actions">
        <button type="button" class="mq-bulk mq-resolve" data-action="toggle-dilemma-state" data-item-id="${esc(dilemma.id)}">${resolved ? "Reopen" : "Resolve"}</button>
        <button type="button" class="mq-icon-button" data-action="toggle-dilemma-hidden" data-item-id="${esc(dilemma.id)}"
          title="${dilemma.hidden ? "Hidden from players" : "Visible to players"}">
          <i class="fa-solid ${dilemma.hidden ? "fa-eye-slash" : "fa-eye"}" inert></i></button>
        <button type="button" class="mq-icon-button mq-danger" data-action="delete-dilemma" data-item-id="${esc(dilemma.id)}"
          title="Delete dilemma"><i class="fa-solid fa-trash" inert></i></button>
      </div>`
    : "";

  return `
    <li class="${cls("mq-dilemma", dilemma.hidden && "is-hidden", resolved && "is-resolved", model.isGM && dilemma.spoiler && "is-spoiler")}" data-entry-id="${esc(dilemma.id)}">
      <div class="mq-knot-row">
        ${known}${marker}${severity}
        <p class="mq-knot-name" ${model.canEdit ? `contenteditable="true" data-dilemma-name="${esc(dilemma.id)}"` : ""}>${esc(dilemma.name)}</p>
        ${table}
        ${actions}
      </div>
      ${resolution}
    </li>
  `;
}

/**
 * DEC-035. Complicacao nao se resolve: INCIDE. `fired` registra que o gatilho aconteceu
 * em ficcao — registro, nunca disparo. Severidade cicla pelo vocabulario fixado.
 */
function renderComplications(model) {
  if (!model.isGM && !model.complications.length) return "";

  const items = model.complications.length
    ? model.complications.map((complication) => renderComplication(complication, model)).join("")
    : renderEmpty("No complications yet.");

  const addButton = model.canEdit
    ? `<button type="button" class="mq-add" data-action="add-complication"><i class="fa-solid fa-plus" inert></i> Complication</button>`
    : "";

  return `
    <section class="mq-complications">
      <header><h2>Complications</h2>${addButton}</header>
      <ul class="mq-box">${items}</ul>
    </section>
  `;
}

function renderComplication(complication, model) {
  const known = model.isGM
    ? model.canEdit
      ? `<button type="button" class="${cls("mq-known", complication.known && "is-known")}" data-action="toggle-complication-known" data-item-id="${esc(complication.id)}"
          title="${complication.known ? "The PCs know of this, in fiction" : "The PCs do not know of this yet"}">
          <i class="${complication.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></button>`
      : `<span class="${cls("mq-known", complication.known && "is-known")}"><i class="${complication.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></span>`
    : "";

  const severity = model.canEdit
    ? `<button type="button" class="mq-pill mq-severity mq-severity-${esc(complication.severity)}" data-action="cycle-complication-severity"
        data-item-id="${esc(complication.id)}" title="Severity — click to cycle">${esc(complication.severity)}</button>`
    : `<span class="mq-pill mq-severity mq-severity-${esc(complication.severity)}">${esc(complication.severity)}</span>`;

  const trigger = complication.trigger
    ? `<span class="mq-complication-trigger" title="Trigger"><i class="fa-solid fa-bolt-lightning" inert></i> ${esc(complication.trigger)}</span>`
    : "";

  const actions = model.canEdit
    ? `<div class="mq-row-actions">
        <button type="button" class="${cls("mq-icon-button", complication.fired && "is-fired")}" data-action="toggle-complication-fired" data-item-id="${esc(complication.id)}"
          title="${complication.fired ? "Trigger has fired, in fiction" : "Trigger has not fired yet"}">
          <i class="${complication.fired ? "fa-solid" : "fa-regular"} fa-circle-bolt" inert></i></button>
        <button type="button" class="mq-icon-button" data-action="toggle-complication-hidden" data-item-id="${esc(complication.id)}"
          title="${complication.hidden ? "Hidden from players" : "Visible to players"}">
          <i class="fa-solid ${complication.hidden ? "fa-eye-slash" : "fa-eye"}" inert></i></button>
        <button type="button" class="mq-icon-button mq-danger" data-action="delete-complication" data-item-id="${esc(complication.id)}"
          title="Delete complication"><i class="fa-solid fa-trash" inert></i></button>
      </div>`
    : "";

  return `
    <li class="${cls("mq-complication", complication.hidden && "is-hidden", complication.fired && "is-fired", model.isGM && complication.spoiler && "is-spoiler")}" data-entry-id="${esc(complication.id)}">
      <div class="mq-knot-row">
        ${known}${severity}
        <p class="mq-knot-name" ${model.canEdit ? `contenteditable="true" data-complication-name="${esc(complication.id)}"` : ""}>${esc(complication.name)}</p>
        ${trigger}
        ${actions}
      </div>
    </li>
  `;
}

function renderObjectives(model) {
  const items = model.objectives.length
    ? model.objectives.map((objective) => renderObjective(objective, model)).join("")
    : renderEmpty("No objectives yet.");

  const addButton = model.canEdit
    ? `<button type="button" class="mq-add" data-action="add-objective"><i class="fa-solid fa-plus" inert></i> Objective</button>`
    : "";

  return `
    <section class="mq-objectives">
      <header><h2>Objectives</h2>${addButton}</header>
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
        <i class="mq-handle fa-solid fa-grip-vertical" title="Drag to reorder" inert></i>
        <button type="button" class="mq-icon-button" data-action="toggle-objective-hidden" data-objective-id="${esc(objective.id)}"
          title="${objective.hidden ? "Hidden from players" : "Visible to players"}">
          <i class="fa-solid ${objective.hidden ? "fa-eye-slash" : "fa-eye"}" inert></i></button>
        <button type="button" class="mq-icon-button mq-danger" data-action="delete-objective" data-objective-id="${esc(objective.id)}"
          title="Delete objective"><i class="fa-solid fa-trash" inert></i></button>
      </div>`
    : "";

  const known = model.isGM
    ? model.canEdit
      ? `<button type="button" class="${cls("mq-known", objective.known && "is-known")}" data-action="toggle-objective-known" data-objective-id="${esc(objective.id)}"
          title="${objective.known ? "The PCs know of this, in fiction" : "The PCs do not know of this yet"}">
          <i class="${objective.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></button>`
      : `<span class="${cls("mq-known", objective.known && "is-known")}"><i class="${objective.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></span>`
    : "";

  return `
    <li class="${cls("mq-objective", objective.hidden && "is-hidden", model.isGM && objective.spoiler && "is-spoiler")}" data-entry-id="${esc(objective.id)}"
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
    : renderEmpty("No rewards yet.");

  const bulk = model.canEdit && model.rewards.length
    ? `<button type="button" class="mq-bulk" data-action="${model.allRewardsVisible ? "hide-all-rewards" : "show-all-rewards"}">
         <i class="fa-solid ${model.allRewardsVisible ? "fa-eye-slash" : "fa-eye"}" inert></i>
         ${model.allRewardsVisible ? "Hide all" : "Reveal all"}</button>
       <button type="button" class="mq-bulk" data-action="${model.allRewardsGranted ? "ungrant-all-rewards" : "grant-all-rewards"}">
         <i class="fa-solid fa-trophy" inert></i>
         ${model.allRewardsGranted ? "Ungrant all" : "Grant all"}</button>`
    : "";

  const addButton = model.canEdit
    ? `<button type="button" class="mq-add" data-action="add-reward"><i class="fa-solid fa-plus" inert></i> Reward</button>`
    : "";

  return `
    <section class="mq-rewards">
      <header><h2>Rewards</h2>${bulk}${addButton}</header>
      <ul class="mq-box">${items}</ul>
    </section>
  `;
}

function renderReward(reward, model) {
  const image = reward.img
    ? `<div class="mq-reward-img" style="background-image:url('${escUrl(reward.img)}')"></div>`
    : `<div class="mq-reward-img mq-reward-img-empty"><i class="fa-solid fa-treasure-chest" inert></i></div>`;

  // DEC-031: nao existe mais meio-termo. Recompensa oculta simplesmente nao chega ao
  // jogador (o view model ja a filtra); a que chega, chega com o nome aberto.
  const name = esc(reward.name);

  const known = model.isGM
    ? model.canEdit
      ? `<button type="button" class="${cls("mq-known", reward.known && "is-known")}" data-action="toggle-reward-known" data-reward-id="${esc(reward.id)}"
          title="${reward.known ? "The PCs know of this, in fiction" : "The PCs do not know of this yet"}">
          <i class="${reward.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></button>`
      : `<span class="${cls("mq-known", reward.known && "is-known")}"><i class="${reward.known ? "fa-solid" : "fa-regular"} fa-lightbulb" inert></i></span>`
    : "";

  const actions = model.canEdit
    ? `<div class="mq-row-actions">
        <i class="mq-handle fa-solid fa-grip-vertical" title="Drag to reorder" inert></i>
        <button type="button" class="mq-icon-button" data-action="toggle-reward-hidden" data-reward-id="${esc(reward.id)}"
          title="${reward.hidden ? "Hidden from players" : "Visible to players"}">
          <i class="fa-solid ${reward.hidden ? "fa-eye-slash" : "fa-eye"}" inert></i></button>
        <button type="button" class="mq-icon-button" data-action="toggle-reward-granted" data-reward-id="${esc(reward.id)}"
          title="${reward.granted ? "Granted to the party" : "Not granted yet"}">
          <i class="${reward.granted ? "fa-solid" : "fa-regular"} fa-trophy" inert></i></button>
        <button type="button" class="mq-icon-button mq-danger" data-action="delete-reward" data-reward-id="${esc(reward.id)}"
          title="Delete reward"><i class="fa-solid fa-trash" inert></i></button>
      </div>`
    : "";

  return `
    <li class="${cls("mq-reward", reward.hidden && "is-hidden", reward.granted && "is-granted", model.isGM && reward.spoiler && "is-spoiler")}"
        data-entry-id="${esc(reward.id)}" ${model.canEdit ? 'draggable="true"' : ""}>
      ${known}${image}
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

/**
 * Sumario navegavel do GM Panel, derivado a cada render.
 *
 * O painel da Q1-P chegou a 66 KB de HTML numa aba so (medido no snapshot de
 * 2026-08-05); sem indice, rodar em mesa vira rolagem. Este TOC e DERIVADO: le os <h2>
 * do HTML ja enriquecido, injeta ids neles e monta a barra de atalhos. NADA e escrito no
 * campo — a fonte que o <prose-mirror> edita e grava e `value`, que segue intocada. E a
 * mesma invariante do bloco derivado da DEC-031: se fosse gravado, a proxima edicao do
 * Mestre o duplicaria.
 *
 * @param {string} html O HTML enriquecido do painel.
 * @returns {{html: string, toc: Array<{id: string, label: string}>}}
 */
export function buildPanelToc(html) {
  const toc = [];
  if (!html) return { html: html ?? "", toc };

  const seen = new Map();
  const out = html.replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/gi, (full, attrs, inner) => {
    const label = inner.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (!label) return full;

    let id = "mq-sec-" + (label.toLocaleLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 40) || "secao");
    const bump = seen.get(id) ?? 0;
    seen.set(id, bump + 1);
    if (bump) id = `${id}-${bump + 1}`;

    toc.push({ id, label });
    // id novo por render; um id ja presente no conteudo e respeitado e sobrescrito aqui
    // apenas no HTML de exibicao — a fonte nunca ve estes ids.
    const cleaned = attrs.replace(/\s+id="[^"]*"/i, "");
    return `<h2 id="${id}"${cleaned}>${inner}</h2>`;
  });

  return { html: out, toc };
}

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

  // A barra vive FORA do corpo editavel: nao entra no prose-mirror, nao chega perto do
  // que se grava. Menos de tres secoes nao paga o espaco da barra.
  const toc =
    isPanel && (model.gmnotesToc?.length ?? 0) >= 3
      ? `<nav class="mq-toc" aria-label="Sections">${model.gmnotesToc
          .map(
            (item) =>
              `<button type="button" class="mq-toc-link" data-action="toc-jump" data-target="${esc(item.id)}">${esc(item.label)}</button>`
          )
          .join("")}</nav>`
      : "";

  const derived = field === "playernotes" ? renderDerivedProgress(model) : "";

  return `
    <section class="${cls("mq-notes", isPanel && "mq-gm-panel")}">
      <header class="mq-notes-header">
        <h2>${esc(label)}</h2>
      </header>
      ${toc}
      ${derived}
      ${body}
    </section>
  `;
}


/**
 * DEC-032, revista na 0.23. O Log registra o CONSOLIDADO — mudancas de ficcao — e e
 * integralmente do Mestre: cada linha edita-se em qualquer coluna, apaga-se, e ha
 * inclusao manual ("+ Entry"). Agrupado por SESSAO (numero, data e subtitulo editaveis
 * na propria heading); entradas sem carimbo caem no grupo inicial. A razao segue
 * tracejada enquanto vazia — linha sem razao e fato sem sentido, e o export para IA
 * depende do sentido. Cada linha empurra-se, por gesto deliberado, para o GM Notes ou
 * o Player Notes.
 */
function renderLogTab(model) {
  const log = [...(model.log ?? [])].reverse();
  const byNumber = new Map((model.sessions ?? []).map((s) => [s.number, s]));

  const groups = [];
  let key;
  let first = true;
  for (const item of log) {
    const k = item.session ?? null;
    if (first || k !== key) {
      key = k;
      first = false;
      groups.push({ session: k, items: [] });
    }
    groups[groups.length - 1].items.push(item);
  }

  const heading = (number) => {
    const session = byNumber.get(number);
    if (number == null || !model.canEdit) return esc(sessionHeading(number, session));
    // Heading editavel: data e subtitulo da sessao gravam direto em sessions[].
    return `Session ${number} —
      <span class="mq-log-session-date" contenteditable="true" data-session-field="date" data-session-number="${number}">${esc(session?.date ?? "")}</span> —
      <span class="${cls("mq-log-session-title", !session?.title && "is-pending")}" contenteditable="true" data-session-field="title" data-session-number="${number}">${esc(session?.title ?? "")}</span>`;
  };

  const row = (item) => {
    const editable = (field, dataAttr, value) => model.canEdit
      ? `<span class="${cls(`mq-log-${field}-text`, !value && "is-pending")}" contenteditable="true" ${dataAttr}="${esc(item.id)}">${esc(value)}</span>`
      : esc(value);
    const del = model.canEdit
      ? `<button type="button" class="mq-icon-button mq-danger" data-action="log-delete" data-item-id="${esc(item.id)}"
          title="Delete entry"><i class="fa-solid fa-trash" inert></i></button>`
      : "";
    const push = model.canEdit
      ? `<button type="button" class="mq-icon-button" data-action="log-push-gm" data-item-id="${esc(item.id)}"
          title="Send to GM Notes"><i class="fa-solid fa-clipboard" inert></i></button>
        <button type="button" class="mq-icon-button" data-action="log-push-player" data-item-id="${esc(item.id)}"
          title="Send to Player Notes"><i class="fa-solid fa-users" inert></i></button>`
      : "";
    return `<tr class="${cls(item.origin === "manual" && "mq-log-manual")}">
      <td class="mq-log-target">${editable("target", "data-log-target", item.target)}<span class="mq-log-type">${esc(item.targetType)}</span></td>
      <td class="mq-log-change">${editable("change", "data-log-change", item.change)}</td>
      <td class="mq-log-reason">${editable("reason", "data-log-reason", item.reason)}</td>
      <td class="mq-log-row-actions">${push}${del}</td>
    </tr>`;
  };

  const body = groups.length
    ? groups
        .map(
          (group) => `
        <h3 class="mq-log-session">${heading(group.session)}</h3>
        <table class="mq-log-table"><tbody>
          ${group.items.map(row).join("")}
        </tbody></table>`
        )
        .join("")
    : renderEmpty("Nothing logged yet. Fiction changes land here on their own.");

  const addEntry = model.canEdit
    ? `<button type="button" class="mq-bulk" data-action="log-add-manual"><i class="fa-solid fa-plus" inert></i> Entry</button>`
    : "";

  const exportBar = `
    <div class="mq-log-actions">
      ${addEntry}
      <button type="button" class="mq-bulk" data-action="log-copy-markdown"><i class="fa-brands fa-markdown" inert></i> Copy Markdown</button>
      <button type="button" class="mq-bulk" data-action="log-copy-json"><i class="fa-solid fa-code" inert></i> Copy JSON</button>
    </div>`;

  return `
    <section class="mq-notes mq-log">
      <header class="mq-notes-header">
        <h2>Log</h2>
        ${exportBar}
      </header>
      <div class="mq-log-body">${body}</div>
    </section>
  `;
}

/**
 * DEC-031: o bloco derivado do Player Notes. Montado a CADA render a partir de
 * completed/granted; nada e gravado em playernotes — derivado que se grava vira
 * duplicata na proxima edicao. Objetivo oculto nunca entra, mesmo completo. Bloco
 * vazio nao se desenha.
 */
function renderDerivedProgress(model) {
  const objectives = model.objectives.filter((o) => o.completed && !o.hidden);
  const rewards = model.rewards.filter((r) => r.granted && !r.hidden);
  if (!objectives.length && !rewards.length) return "";

  const rows = [
    ...objectives.map((o) => `<li><i class="fa-solid fa-check" inert></i> ${esc(o.name)}</li>`),
    ...rewards.map((r) => `<li><i class="fa-solid fa-trophy" inert></i> ${esc(r.name)}</li>`)
  ].join("");

  return `
    <aside class="mq-derived" aria-label="Progress so far">
      <h3>Progress so far</h3>
      <ul>${rows}</ul>
    </aside>
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
              title="Unlink subquest"><i class="fa-solid fa-link-slash" inert></i></button>
          </li>`
        )
        .join("")
    : renderEmpty("No subquests.");

  const splash = model.splash
    ? `<div class="mq-splash" style="background-image:url('${escUrl(model.splash)}');background-position:${esc(model.splashPos)}"></div>`
    : `<div class="mq-splash mq-splash-empty"><span>No splash art</span></div>`;

  return `
    <div class="mq-management">
      <section>
        <h2>Settings</h2>
        <button type="button" class="mq-bulk" data-action="configure-ownership">
          <i class="fa-solid fa-lock" inert></i> Configure permissions</button>
        <label class="mq-field">
          <span>Splash art</span>
          <span class="mq-file-field">
            <input type="text" data-field="splash" value="${esc(model.splash)}" placeholder="path/to/image.webp">
            <button type="button" class="mq-browse" data-action="pick-image" data-target-field="splash"
              title="Browse the Foundry directory"><i class="fa-solid fa-folder-open" inert></i></button>
          </span>
        </label>
        ${splash}
      </section>

      <section class="mq-subquests">
        <header>
          <h2>Branching</h2>
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
    : `<div class="mq-quest-image mq-quest-image-empty"><span>No image</span></div>`;

  const control = model.canEdit
    ? `<button type="button" class="mq-browse mq-quest-image-pick" data-action="pick-image" data-target-field="splash"
        data-where="${esc(where)}">
        <i class="fa-solid fa-image" inert></i> ${model.splash ? "Change image" : "Choose image"}</button>`
    : "";

  return `<figure class="mq-quest-image-wrap">${picture}${control}</figure>`;
}
