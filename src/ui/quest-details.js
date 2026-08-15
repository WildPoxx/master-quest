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
import { diffQuestForLog, logToMarkdown, sessionHeading, sessionOpenedEntry } from "../quest/quest-log-diff.js";
import { appendUnderSection, sectionHeading } from "../notes/session-sections.js";
import { sessionsToSeal, toggleWrapUp } from "../quest/quest-wrapup.js";
import { SEVERITIES, currentSession, makeId, normalizeClue, normalizeComplication, normalizeDilemma, normalizeLogEntry, normalizeObjective, normalizeOutcome, normalizeReward, normalizeSession, reorderById } from "../quest/quest-schema.js";
import { readAllQuests } from "../quest/quest-store.js";
// DEC-038 (0.25): as notas do jogador moram no Journal; a aba as espelha e aponta.
import {
  LEGACY_PAGE_NAME,
  appendToSessionPage,
  applyPageOwnership,
  ensurePlayerNotesEntry,
  ensureSessionPage,
  openJournalByUuid,
  pagesNeedingOwnership,
  planPlayerNotes,
  readSessionSummaries,
  sessionPageName
} from "../journal/player-notes.js";
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

      // 0.29: a morada do caderno depende da arvore de pastas do mundo, que so existe
      // aqui — os renderizadores abaixo sao puros e nao consultam o Foundry. Calculado uma
      // vez por render e entregue pronto ao desenho, como o enriquecimento acima.
      model.notesFolder = planPlayerNotes({ quest, game: this.game });

      // 0.30: o painel passa a mostrar o que ESTA na pagina, e nao so o link para ela.
      // Lido aqui, do proprio documento, e nunca gravado: sumario gravado envelheceria a
      // cada edicao do jogador, e o painel voltaria a mentir. Lido, acompanha sozinho.
      model.sessionNotes = await readSessionSummaries({ quest, fromUuid: globalThis.fromUuid });

      // Quantas paginas ainda estao fora do desenho de permissao. So o Mestre ve, e so
      // aparece quando ha o que consertar.
      model.notesOwnershipPending = 0;
      if (isGM && quest.playerNotesUuid) {
        const entry = await (globalThis.fromUuid?.(quest.playerNotesUuid) ?? null);
        if (entry) model.notesOwnershipPending = pagesNeedingOwnership(entry);
      }

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

    /**
     * 0.25: preservar a posicao de rolagem entre renders.
     *
     * Todo gesto na Details passa por `commit()` -> `render()` -> aqui, e este metodo
     * troca o conteudo INTEIRO da janela. Os nos antigos deixam de existir, entao o
     * navegador zera o scroll: clicar numa pill de severidade no fim da coluna jogava o
     * Mestre de volta ao topo (relatado em mesa por Mario, 2026-08-06 — o pior atrito da
     * 0.23). A correcao mede antes e restaura depois, em cada superficie rolavel:
     * o proprio `content` e os dois paineis internos que tem rolagem propria.
     *
     * `requestAnimationFrame` porque a altura so existe depois do layout — restaurar no
     * mesmo tick escreveria num elemento que ainda mede zero e o valor seria descartado.
     */
    _replaceHTML(result, content) {
      const marks = captureScrollMarks(content);
      content.replaceChildren(result);
      this.activateListeners(result);
      restoreScrollMarks(content, marks);
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
            // 0.30.1: `innerText`, nao `textContent`. Ao apertar Enter o navegador poe um
            // `<br>` (ou um `<div>`) dentro do campo; `textContent` os ignora e a quebra
            // MORRE na gravacao. Mario descreveu o sintoma com precisao: "quebro linhas e
            // a janela se ajeita, mas assim que tiro o mouse do campo ela volta a se
            // estender". Era isso: com o campo em foco quem quebrava era o `<br>` do
            // navegador; ao sair, gravava-se texto corrido e o desenho voltava ao que era.
            // `innerText` le o texto como ele APARECE, com as quebras, e o `pre-wrap` do
            // CSS as devolve na tela.
            const value = (node.innerText ?? node.textContent ?? "").trim();
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
            const item = (this.quest?.log ?? []).find((x) => x.id === id);
            if (!item) return;

            // 0.25: a linha diz de que ESPECIE e o item ("Clue found: ..."), porque
            // "found" sozinho nao informa quem o le tres dias depois (apontado por Mario
            // no teste de mesa de 2026-08-06).
            const written = describeLogLine(item);

            // DEC-038: quando a quest ja tem caderno de Journal, o destino do push e a
            // PAGINA da sessao — HTML limpo, um <p> por linha, sem duplicar o que ja foi
            // enviado. O campo da aba so recebe o texto quando ainda nao ha caderno.
            if (field === "playernotes" && this.quest?.playerNotesUuid) {
              const sent = await this.pushToPlayerNotesJournal(item, written);

              // 0.30.1: falha deixa de se disfarcar de sucesso. Ate aqui, QUALQUER status
              // diferente de "appended" — caderno apagado do mundo, pagina que nao nasce,
              // entrada inalcancavel — era anunciado como "Already in the players' note".
              // O Mestre via uma mensagem tranquilizadora e o texto nao existia em lugar
              // nenhum. Aviso que mente sobre gravacao e pior que aviso nenhum.
              if (sent.status === "appended") notifyInfo("Sent to the players' note.", this.ui);
              else if (sent.status === "nothing-to-append") notifyInfo("Already in the players' note.", this.ui);
              else notifyWarning(`MasterQuest could not write to the players' note (${sent.status}).`, this.ui);
              return;
            }

            // 0.28 (Mario, teste de mesa da 0.27.0): a linha empurrada entra na SECAO da
            // sessao — cabecalho `<h4>` e regua —, e nao mais como paragrafo solto com a
            // sessao em italico no comeco. A forma e o exemplo que o proprio Mario deixou
            // no mundo e que o Quest Devs recolheu como especificacao (Pedido 3).
            const session = (this.quest?.sessions ?? []).find((s) => s.number === item.session) ?? null;
            await this.commit((draft) => ({
              ...draft,
              [field]: appendUnderSection(draft[field] ?? "", { session, line: written })
            }));
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
          const session = normalizeSession({ number: next, date: today, title: "" });
          // 0.27 (Mario, 2026-08-07): abrir sessao GERA linha de Log. Ver a nota de
          // fronteira com a DEC-032 em `sessionOpenedEntry`.
          return {
            ...draft,
            sessions: [...(draft.sessions ?? []), session],
            log: [...(draft.log ?? []), sessionOpenedEntry(session)]
          };
        });
      });

      // O "pronto" da tira: commita o que estiver sendo digitado e fecha a entrada.
      // Nao grava nada por conta propria — o blur de cada campo ja gravou. Ver
      // `renderSessionConfirm` para por que nao existe rascunho aqui.
      root.querySelector("[data-action='session-confirm']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const active = root.ownerDocument?.activeElement;
        if (active?.blur) active.blur();
        await this.render({ force: false });
      });

      // 0.30: um gesto por tarefa. Criar, mudar de pasta, acertar permissao e limpar o
      // campo antigo sao quatro coisas diferentes, e cada uma diz na tampa o que faz —
      // botao que faz mais do que anuncia foi o que produziu a "Session 0" inesperada.
      root.querySelector("[data-action='player-notes-create']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.createPlayerNotes({ migrate: true });
      });

      root.querySelector("[data-action='player-notes-move']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.createPlayerNotes({ migrate: false });
      });

      root.querySelector("[data-action='player-notes-fix-ownership']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.fixPlayerNotesOwnership();
      });

      root.querySelector("[data-action='player-notes-clear-legacy']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.clearLegacyPlayerNotes();
      });

      root.querySelectorAll("[data-action='log-clear']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          const raw = node.dataset.session;
          await this.clearLog({ session: raw === undefined || raw === "" ? null : Number(raw) });
        });
      });

      // 0.25: selar/dessellar sessao. A trava e contra gesto EM MASSA (Clear log geral),
      // nunca contra a mao do Mestre — por isso e um toggle simples, sem confirmacao.
      root.querySelectorAll("[data-action='session-seal']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          const number = Number(node.dataset.sessionNumber);
          await this.commit((draft) => ({
            ...draft,
            sessions: (draft.sessions ?? []).map((s) =>
              s.number === number ? { ...s, sealed: !s.sealed } : s
            )
          }));
        });
      });

      // Apagar sessao (Mario, 2026-08-07). So chega aqui quem esta desselado: o botao nao
      // se desenha em sessao selada (renderSessionDelete). O gesto leva a sessao e as
      // linhas de Log dela; nao toca na pagina de Journal; e nao precisa mexer na sessao
      // corrente, porque `currentSession` e a de maior numero e recua sozinha. Ver
      // `deleteSession` para o porque de cada uma das tres.
      root.querySelectorAll("[data-action='session-delete']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          await this.deleteSession({ number: Number(node.dataset.sessionNumber) });
        });
      });

      // DEC-038: abre a pagina de Journal da sessao. O modulo aponta; o conteudo mora la.
      root.querySelectorAll("[data-action='open-session-page']").forEach((node) => {
        node.addEventListener("click", async (event) => {
          event.preventDefault();
          await openJournalByUuid(node.dataset.uuid, { ui: this.ui });
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
     * DEC-038: cria o caderno de Journal desta quest, com previa (DEC-004).
     *
     * O que a previa mostra: onde a entrada nasce, com que nome, quais paginas e QUEM FICA
     * DONO DO QUE (DEC-042 — permissao e a parte irreversivel-por-descuido). O que a
     * criacao faz: entrada Owner dos jogadores na pasta `MasterQuest / Player Notes`, uma
     * pagina por sessao com o jogador daquela sessao como dono e os demais em leitura, e a
     * prosa que ja estava no campo migrada para "Before session records" — nada se apaga.
     */
    async createPlayerNotes({ migrate = true } = {}) {
      const quest = this.quest;
      if (!quest) return { status: "no-quest" };

      const plan = planPlayerNotes({ quest, game: this.game });
      const confirmed = await confirmPlan({ ...plan, migrate }, { game: this.game });
      if (!confirmed) return { status: "cancelled" };

      const { status, entry, uuid } = await ensurePlayerNotesEntry({ quest, game: this.game });
      if (!entry) {
        notifyWarning("MasterQuest could not create the players' note.", this.ui);
        return { status };
      }

      // Jogadores marcados por nome, alem do `default: OWNER` da pagina. Redundante por
      // desenho: a permissao nao depende mais desta lista (0.30), mas registra-la mantem
      // legivel, no proprio documento, quem a mesa era quando o caderno nasceu.
      const owners = playerUserIds(this.game);

      // 0.30 (Mario, 2026-08-10): a migracao do texto antigo acontece SO na criacao. Ela
      // rodava tambem no gesto de mudar de pasta, e Mario clicou em "mover" e ganhou uma
      // pagina nova que nao tinha pedido. Mover move; mais nada.
      const legacy = migrate ? (quest.playernotes ?? "").trim() : "";
      if (legacy) {
        // O nome vem da constante que a PREVIA anuncia. Antes saia "Session 0", porque a
        // rotina generica derivava o nome do numero — a previa prometia uma coisa e o
        // modulo criava outra, e previa que mente deixa de ser previa.
        await ensureSessionPage({
          entry,
          session: { number: 0, date: "", title: "" },
          name: LEGACY_PAGE_NAME,
          owners,
          content: legacy
        });
      }

      const pages = new Map();
      for (const session of quest.sessions ?? []) {
        const page = await ensureSessionPage({ entry, session, owners });
        if (page.uuid) pages.set(session.number, page.uuid);
      }

      await this.commit((draft) => ({
        ...draft,
        playerNotesUuid: uuid,
        sessions: (draft.sessions ?? []).map((s) =>
          pages.has(s.number) ? { ...s, pageUuid: pages.get(s.number) } : s
        )
      }));

      notifyInfo(
        status === "moved" ? "Players' note moved." : "Players' note created in the Journal.",
        this.ui
      );
      return { status: status === "moved" ? "moved" : "created", uuid };
    }

    /**
     * Poe as paginas que ja existem no desenho de permissao vigente.
     *
     * Gesto proprio, e nao efeito colateral de outro, porque permissao e a parte que nao
     * se desfaz por descuido: entra com previa dizendo quantas paginas mudam e o que isso
     * libera (DEC-004).
     */
    async fixPlayerNotesOwnership() {
      const quest = this.quest;
      const uuid = quest?.playerNotesUuid;
      if (!uuid) return { status: "no-entry" };

      const entry = await (globalThis.fromUuid?.(uuid) ?? null);
      if (!entry) return { status: "missing-entry" };

      const pending = pagesNeedingOwnership(entry);
      if (!pending) {
        notifyInfo("Every page is already owned by the players.", this.ui);
        return { status: "nothing-to-do" };
      }

      const confirmed = await confirmDialog({
        game: this.game,
        title: "Give the players ownership",
        content: `<p><strong>${pending}</strong> page(s) of this note will change permission to
          <strong>Owner for all players</strong> — today they can only read them.</p>
          <p>From then on any player can write in, and also erase from, any page of this note.
          It is the shared notebook of the table, and that is deliberate. Nothing is deleted by
          this operation; only the permission changes.</p>`
      });
      if (!confirmed) return { status: "cancelled" };

      const result = await applyPageOwnership({ entry });
      notifyInfo(`${result.fixed} page(s) now owned by the players.`, this.ui);
      this.render();
      return result;
    }

    /**
     * Limpa o campo antigo de notas, depois de o conteudo ja viver no Journal.
     *
     * Nao apaga documento nenhum — apaga a COPIA que sobrou no flag da quest depois da
     * migracao. A previa diz onde o texto continua, para o gesto nao parecer perda.
     */
    async clearLegacyPlayerNotes() {
      const quest = this.quest;
      const legacy = (quest?.playernotes ?? "").trim();
      if (!legacy) return { status: "nothing-to-clear" };

      const migrated = Boolean(quest?.playerNotesUuid);
      const confirmed = await confirmDialog({
        game: this.game,
        title: "Clear the old free prose",
        content: `<p>This clears the leftover text from the quest's own field.</p>
          ${migrated
            ? `<p>The same text already lives in the note's page <em>${esc(LEGACY_PAGE_NAME)}</em>
               (older notes may still call it <em>Session 0</em>), so nothing is lost — this only
               removes the second copy.</p>`
            : `<p><strong>There is no Journal note yet</strong>, so this text exists only here.
               Clearing it now loses it. Create the note first if you want to keep it.</p>`}`
      });
      if (!confirmed) return { status: "cancelled" };

      await this.commit((draft) => ({ ...draft, playernotes: "" }));
      notifyInfo("Old free prose cleared.", this.ui);
      return { status: "cleared" };
    }

    /**
     * DEC-038: manda uma linha do Log para a pagina da sessao, no Journal.
     *
     * Cria a pagina se a sessao ainda nao tiver uma — o Mestre pode ter aberto a sessao
     * depois de criar o caderno. Idempotente pelo id da entrada de log.
     */
    async pushToPlayerNotesJournal(item, written) {
      const quest = this.quest;
      const uuid = quest?.playerNotesUuid;
      if (!uuid) return { status: "no-entry" };

      const entry = await (globalThis.fromUuid?.(uuid) ?? null);
      if (!entry) return { status: "missing-entry" };

      const number = item.session ?? currentSession(quest)?.number ?? null;
      const session = (quest.sessions ?? []).find((s) => s.number === number)
        ?? { number: number ?? 1, date: "", title: "" };

      // DEC-042: a pagina criada pelo push nasce com os mesmos donos da criada pelo
      // caderno. Antes ia com lista vazia — sob `INHERIT` isso passava despercebido, mas
      // com `default: OBSERVER` explicito a pagina nasceria sem dono nenhum e o jogador
      // nao poderia escrever nela, que e exatamente o problema que a DEC-038 resolve.
      const page = await ensureSessionPage({ entry, session, owners: playerUserIds(this.game) });
      if (!page.page) return { status: "no-page" };

      const result = await appendToSessionPage({
        page: page.page,
        lines: [{ id: item.id, html: written }]
      });

      // Primeira gravacao nesta sessao: guarda o ponteiro da pagina na quest.
      if (page.uuid && !session.pageUuid) {
        await this.commit((draft) => ({
          ...draft,
          sessions: (draft.sessions ?? []).map((s) =>
            s.number === session.number ? { ...s, pageUuid: page.uuid } : s
          )
        }));
      }

      return result;
    }

    /**
     * Apagar uma sessao (Mario, 2026-08-07).
     *
     * A guarda e o SELO, e ela e dupla: o botao nao se desenha em sessao selada
     * (`renderSessionDelete`), e este metodo recusa a operacao se for chamado assim mesmo.
     * Nao ha dialogo de confirmacao por decisao expressa de Mario — desselar ja e o gesto
     * deliberado, e pedir um segundo gesto logo depois e cerimonia, nao salvaguarda (mesmo
     * raciocinio que a DEC-043 aplicou ao Wrap Up).
     *
     * A sessao leva junto AS LINHAS DE LOG dela (Mario, 2026-08-07, escolhendo entre as
     * tres formas possiveis). Apagar apaga, sem historico de exclusao — e o mesmo criterio
     * que a DEC-039 ja fixara para o Clear log. O que segura a mao do Mestre e o SELO,
     * antes do gesto, nao um arrependimento depois dele.
     *
     * Isso tambem fecha um buraco: "New session" numera por `maior + 1`, entao uma linha
     * orfa deixada por uma sessao apagada seria ADOTADA pela proxima sessao a reusar o
     * numero. Levando as linhas junto, nao sobra orfa para ser readotada.
     *
     * O que este metodo nunca toca: o documento de Journal da sessao. `pageUuid` some, a
     * pagina fica — nenhum caminho do modulo apaga documento de conteudo (DEC-038).
     */
    async deleteSession({ number } = {}) {
      const quest = this.quest;
      if (!quest) return { status: "no-quest" };

      const target = (quest.sessions ?? []).find((s) => s.number === number);
      if (!target) return { status: "no-session" };
      if (target.sealed) {
        notifyInfo(`Session ${number} is sealed — unseal it first.`, this.ui);
        return { status: "sealed" };
      }

      const doomedEntries = (quest.log ?? []).filter((entry) => entry.session === number).length;
      const keptPage = Boolean(target.pageUuid);

      await this.commit((draft) => ({
        ...draft,
        sessions: (draft.sessions ?? []).filter((s) => s.number !== number),
        log: (draft.log ?? []).filter((entry) => entry.session !== number)
      }));

      // Sem dialogo — o desselar ja foi o gesto deliberado —, mas com numeros: o Mestre
      // precisa saber quanto se foi junto, e o que sobreviveu apesar do gesto.
      const parts = [];
      if (doomedEntries) parts.push(`${doomedEntries} log ${doomedEntries === 1 ? "entry" : "entries"} deleted`);
      if (keptPage) parts.push("the players' page kept");
      notifyInfo(
        parts.length ? `Session ${number} deleted — ${parts.join(", ")}.` : `Session ${number} deleted.`,
        this.ui
      );
      return { status: "deleted", deletedEntries: doomedEntries, keptPage };
    }

    /**
     * 0.25: Clear log — total ou de uma sessao.
     *
     * Pedido de Mario (2026-08-06): apagar linha a linha nao escala quando o acervo velho
     * incomoda. Duas travas: confirmacao explicita, e sessao SELADA nao e varrida pelo
     * gesto geral. Apagar uma linha especifica continua livre pela lixeira — o selo
     * protege do gesto em massa, nao da mao do Mestre.
     */
    async clearLog({ session = null } = {}) {
      const quest = this.quest;
      if (!quest) return { status: "no-quest" };

      const sealed = new Set((quest.sessions ?? []).filter((s) => s.sealed).map((s) => s.number));
      const doomed = (quest.log ?? []).filter((entry) =>
        session === null ? !sealed.has(entry.session) : entry.session === session
      );

      if (!doomed.length) {
        notifyInfo("Nothing to clear — every entry is in a sealed session.", this.ui);
        return { status: "nothing-to-clear" };
      }

      const scope = session === null ? "the whole log" : `session ${session}`;
      const confirmed = await confirmDialog({
        game: this.game,
        title: "Clear log",
        content: `<p>Delete <strong>${doomed.length}</strong> entry(ies) from ${esc(scope)}?</p>
          <p>Sealed sessions are never touched by this. This cannot be undone.</p>`
      });
      if (!confirmed) return { status: "cancelled" };

      const kept = new Set(doomed.map((entry) => entry.id));
      await this.commit((draft) => ({ ...draft, log: (draft.log ?? []).filter((entry) => !kept.has(entry.id)) }));
      notifyInfo(`${doomed.length} entry(ies) cleared.`, this.ui);
      return { status: "cleared", removed: doomed.length };
    }

    /**
     * 0.23: o encerramento editorial. `wrappedUp` e flag da mesa, reversivel, e NAO toca
     * o status — status e a ficcao; Wrap Up e fechar o caderno. Com o caderno fechado, o
     * botao de relatorio gera a ata consolidada em Markdown (leitura pura, como o
     * snapshot).
     *
     * 0.26 (DEC-043): fechar o caderno SELA todas as sessoes; reabrir nao desselar. A
     * regra inteira mora em `toggleWrapUp` — aqui so se avisa quantas sessoes o gesto
     * alcancou, porque um efeito colateral silencioso em cima de outro documento e
     * exatamente o que a DEC-004 existe para impedir.
     */
    activateWrapupHandlers(root) {
      root.querySelector("[data-action='toggle-wrapup']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        const sealing = sessionsToSeal(this.quest);
        await this.commit((draft) => toggleWrapUp(draft));
        if (sealing > 0) notifyInfo(`${sealing} session(s) sealed with the wrap-up.`, this.ui);
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
        ${renderSessionConfirm(model, session)}
        ${renderSessionDelete(model, session)}
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
    ${renderSessionList(model)}
  `;
}

/**
 * O "pronto" da tira de entrada (Mario, 2026-08-07, teste de mesa da 0.26.0).
 *
 * Mario pediu um gesto de confirmacao ao lado da lixeira, para separar a AREA DE ENTRADA
 * dos REGISTROS que se acumulam abaixo. Este botao cumpre esse papel — e **nao** cria um
 * estado de rascunho.
 *
 * A distincao importa e fica escrita: sessao nova ja nasce gravada, no clique do
 * "New session", como sempre foi; numero, data e subtitulo gravam no blur de cada campo.
 * Um rascunho de verdade — que so existisse ao ser confirmado — introduziria a unica coisa
 * que hoje nao pode acontecer neste modulo: perder o que se digitou ao fechar a janela.
 * O botao commita a edicao pendente e fecha a entrada; nada fica pendurado esperando por
 * ele. Quem nunca clicar nele nao perde nada.
 */
function renderSessionConfirm(model, session) {
  if (!model.canEdit || !session) return "";
  return `<button type="button" class="mq-icon-button mq-session-confirm" data-action="session-confirm"
      title="Done — the session is already saved and listed below"><i class="fa-solid fa-check" inert></i></button>`;
}

/**
 * A lixeira da sessao (Mario, 2026-08-07). Ate a 0.25.0 havia como ABRIR sessao e nenhum
 * jeito de remover a que fosse aberta por engano.
 *
 * Regra inteira, nas palavras de Mario: "um icone de lixo que funciona para deletar, mas
 * ela apenas fica ativa quando esta destravado". O botao NAO EXISTE em sessao selada — o
 * gesto de desselar e a confirmacao, e por isso nao ha dialogo. Isto estende o selo da
 * DEC-039 sem contradiz-la: aquela decisao poupou a mao do Mestre item a item, e apagar a
 * sessao inteira nao e gesto item a item, e remover o continente de um grupo do Log.
 *
 * A lixeira aparece nos dois lugares em que uma sessao se apresenta — a tira da corrente e
 * a lista — porque a lista so se desenha a partir de duas sessoes, e a sessao unica aberta
 * por engano e justamente o caso que originou o pedido.
 */
function renderSessionDelete(model, session) {
  if (!model.canEdit || !session || session.sealed) return "";
  return `<button type="button" class="mq-icon-button mq-danger" data-action="session-delete"
      data-session-number="${session.number}"
      title="Delete this session and its log entries — the players' page is kept"><i class="fa-solid fa-trash" inert></i></button>`;
}

/**
 * 0.25 (Mario, 2026-08-06): a lista das sessoes anteriores, sob a corrente.
 *
 * Ate a 0.23 a Details desenhava SO a sessao corrente, e a impressao em mesa foi de que
 * as anteriores tinham sido perdidas — nao tinham: `sessions[]` guardava as tres, o
 * relatorio de Wrap Up as listava, e so a tela nao as mostrava. Aqui elas aparecem no
 * mesmo idioma de linha das outras colecoes: uma por linha, editaveis, com o selo.
 *
 * O selo (`sealed`, 0.25) protege a sessao de gesto EM MASSA — Clear Log geral pula o que
 * esta selado. Nao congela a mao do Mestre: apagar linha a linha segue livre.
 */
function renderSessionList(model) {
  if (!model.isGM) return "";
  const sessions = Array.isArray(model.sessions) ? model.sessions : [];
  if (!sessions.length) return "";

  // 0.27 (Mario, 2026-08-07, teste de mesa): a lista aparece SEMPRE, desde a primeira
  // sessao. Antes ela so se desenhava a partir de duas — atalho meu, com a desculpa de
  // que "a corrente ja esta desenhada acima". O efeito em mesa foi outro: com uma sessao
  // so, Mario via apenas a tira, lia a tira como formulario, e concluia que a sessao NAO
  // tinha sido gravada. Ela estava gravada desde o clique; faltava o registro aparecer.
  // Licao: economia de pixel que esconde confirmacao nao economiza nada.
  //
  // Ordem CRESCENTE (decisao de Mario na mesma rodada): a sessao 1 em cima, a ultima
  // embaixo — o caderno se le na ordem em que se jogou.
  const rows = [...sessions]
    .sort((a, b) => a.number - b.number)
    .map((session) => {
      const isCurrent = session.number === model.session?.number;
      const seal = model.canEdit
        ? `<button type="button" class="mq-icon-button" data-action="session-seal" data-session-number="${session.number}"
            title="${session.sealed ? "Sealed — protected from Clear log" : "Seal this session"}">
            <i class="fa-solid ${session.sealed ? "fa-lock" : "fa-lock-open"}" inert></i></button>`
        : "";
      const link = session.pageUuid
        ? `<button type="button" class="mq-icon-button" data-action="open-session-page" data-uuid="${esc(session.pageUuid)}"
            title="Open this session's page in the players' notes"><i class="fa-solid fa-book-open" inert></i></button>`
        : "";
      return `
        <li class="${cls("mq-session-row", isCurrent && "is-current", session.sealed && "is-sealed")}">
          <span class="mq-session-number" ${model.canEdit && !session.sealed ? `contenteditable="true" data-session-field="number" data-session-number="${session.number}"` : ""}>${session.number}</span>
          <span class="mq-session-date" ${model.canEdit && !session.sealed ? `contenteditable="true" data-session-field="date" data-session-number="${session.number}"` : ""}>${esc(session.date)}</span>
          <span class="${cls("mq-session-title", !session.title && "is-pending")}" ${model.canEdit && !session.sealed ? `contenteditable="true" data-session-field="title" data-session-number="${session.number}"` : ""}>${esc(session.title)}</span>
          <span class="mq-session-row-actions">${link}${seal}${renderSessionDelete(model, session)}</span>
        </li>`;
    })
    .join("");

  return `<ul class="mq-session-list" aria-label="Sessions">${rows}</ul>`;
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
        title="${clue.found ? "The party found this clue" : "Not found yet"}">
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
  const journal = field === "playernotes" ? renderPlayerNotesJournalBar(model) : "";
  const index = field === "playernotes" ? renderSessionNotesIndex(model) : "";

  // 0.29: com indice, o campo livre deixa de ser o CORPO da aba e vira o que ele ja era na
  // pratica desde a DEC-038 — um espaco de prosa solta, que nenhum push escreve. Ele
  // continua existindo e editavel; o que muda e a moldura, que passa a dizer o que ele e.
  // Caixa grande, vazia e sem rotulo foi exatamente o que fez Mario concluir, em mesa, que
  // a aba estava quebrada quando o dado estava intacto.
  //
  // Para quem nao edita, campo vazio simplesmente nao se desenha: o jogador nao tem o que
  // fazer com uma caixa que diz "Nothing here yet".
  // 0.30 (Mario, 2026-08-10): *"lembrar de tirar aquele residuo de baixo do Player Notes,
  // que essa parte de baixo ai nao funciona mais"*. Com caderno criado, nada escreve neste
  // campo — nem o push, nem o modulo. Ele deixa de ser superficie de trabalho e passa a ser
  // o que sobrou da migracao: aparece SO se tiver texto, dito com todas as letras, e com o
  // gesto de limpar ao lado. Campo vazio nao se desenha, porque caixa vazia sem funcao foi
  // exatamente o que fez a aba parecer quebrada quando o dado estava intacto.
  const hasProse = Boolean(String(model[field] ?? "").trim());
  const aside = !index
    ? body
    : hasProse
      ? `<div class="mq-notes-aside">
           <div class="mq-notes-aside-head">
             <span class="mq-hint">Old free prose, kept from before this note moved to the Journal.
             Nothing writes here anymore.</span>
             ${model.canEdit
               ? `<button type="button" class="mq-bulk" data-action="player-notes-clear-legacy">
                    <i class="fa-solid fa-broom" inert></i> Clear</button>`
               : ""}
           </div>
           ${body}
         </div>`
      : "";

  return `
    <section class="${cls("mq-notes", isPanel && "mq-gm-panel")}">
      <header class="mq-notes-header">
        <h2>${esc(label)}</h2>
      </header>
      ${toc}
      ${derived}
      ${journal}
      ${index}
      ${aside}
    </section>
  `;
}

/**
 * DEC-038: a ponte entre a aba e o caderno de Journal.
 *
 * 0.29 (Mario, teste de mesa da 0.28.0): a tira FIXA saiu. Ela repetia, presa no topo, o
 * link da sessao corrente — *"esse botao preso la em cima (...) e totalmente desnecessario
 * e acho que so complica mais"*. Quem abre a aba tres semanas depois quer a sessao 2, nao
 * a corrente; o indice abaixo da todas.
 *
 * Sobra para esta tira o que so ela pode fazer: criar o caderno quando ele nao existe, e
 * oferecer a MUDANCA DE MORADA quando o caderno existe fora do lugar novo. Sem esta
 * segunda metade, um caderno criado antes da 0.29 nunca teria como se mudar.
 */
function renderPlayerNotesJournalBar(model) {
  if (!model.isGM) return "";

  if (!model.playerNotesUuid) {
    return `
      <div class="mq-notes-journal">
        <span class="mq-hint">The players write in a Journal of their own — MasterQuest only points to it.</span>
        <button type="button" class="mq-bulk" data-action="player-notes-create">
          <i class="fa-solid fa-book-medical" inert></i> Create table note</button>
      </div>`;
  }

  const chores = [];

  if (model.notesFolder?.willMove) {
    chores.push(`
      <button type="button" class="mq-bulk" data-action="player-notes-move">
        <i class="fa-solid fa-folder-tree" inert></i> Move to ${esc(model.notesFolder.folderPath)}</button>`);
  }

  // 0.30: so aparece quando ha o que consertar, e diz o numero. Botao permanente que nao
  // faz nada na maioria dos cliques ensina o Mestre a ignora-lo.
  if (model.notesOwnershipPending > 0) {
    chores.push(`
      <button type="button" class="mq-bulk" data-action="player-notes-fix-ownership">
        <i class="fa-solid fa-user-pen" inert></i> Give the players ownership (${model.notesOwnershipPending})</button>`);
  }

  if (!chores.length) return "";

  return `<div class="mq-notes-journal">${chores.join("")}</div>`;
}

/**
 * O indice de sessoes da aba de notas (Mario, 2026-08-08, desenhado por ele em maquete).
 *
 * Cada sessao vira uma secao: o cabecalho que `sectionHeading` ja produz para o Log e para
 * o push, uma regua, e o LINK para a pagina daquela sessao — nao o texto dela. O texto
 * mora no Journal desde a DEC-038; repeti-lo aqui criaria duas verdades sobre a mesma
 * prosa.
 *
 * **Este bloco e DERIVADO e nunca gravado**, pelas mesmas tres razoes que valem para o
 * sumario do GM Panel: renumerar ou apagar uma sessao deixaria link morto dentro de texto
 * gravado; o ProseMirror reescreve marcacao que o Mestre nao digitou; e foi marcacao
 * artesanal em campo de texto que produziu a perda de 3.804 caracteres em 2026-08-03.
 *
 * Sessao sem pagina aparece assim mesmo, dizendo por que esta vazia — a licao da 0.27.0,
 * onde esconder a sessao unica fez Mario concluir que ela nao tinha sido gravada.
 */
function renderSessionNotesIndex(model) {
  if (!model.playerNotesUuid) return "";

  const sessions = [...(model.sessions ?? [])].sort((a, b) => (a.number ?? 0) - (b.number ?? 0));

  // Caderno sem sessao nenhuma seria um beco sem saida: nao ha secao, logo nao ha link, e
  // a aba nao teria como abrir o caderno. Aqui, e so aqui, o link e o da entrada inteira.
  if (!sessions.length) {
    return `
      <div class="mq-notes-index">
        <p class="mq-note-empty">No session opened yet — open one in the Details tab and it shows up here.</p>
        <button type="button" class="mq-note-link" data-action="open-session-page" data-uuid="${esc(model.playerNotesUuid)}">
          <i class="fa-solid fa-book-open" inert></i> Open the note</button>
      </div>`;
  }

  const blocks = sessions.map((session) => {
    if (!session.pageUuid) {
      return `<section class="mq-note-section">
        <h4>${esc(sectionHeading(session))}</h4><hr>
        <p class="mq-note-empty">No page yet — it is created on the first push from the Log.</p>
      </section>`;
    }

    // 0.30 (Mario, 2026-08-10): as linhas que ele empurra sao resumos curtos, e ele quer
    // le-las AQUI, sem abrir o documento — *"seria interessante que essas coisas
    // aparecessem no texto do painel de visualizacao"*. Vem da propria pagina, entao o
    // painel nunca discorda dela.
    const summary = model.sessionNotes?.[session.number];
    const lines = (summary?.lines ?? []).map((line) => `<p class="mq-note-line">${safeHtml(line)}</p>`).join("");
    const more = summary?.more
      ? `<p class="mq-note-empty">and ${summary.more} more — open the page to read it all.</p>`
      : "";
    const empty = !lines && !more ? `<p class="mq-note-empty">Nothing written in this session yet.</p>` : "";

    return `<section class="mq-note-section">
      <h4>${esc(sectionHeading(session))}</h4><hr>
      ${lines}${more}${empty}
      <button type="button" class="mq-note-link" data-action="open-session-page" data-uuid="${esc(session.pageUuid)}">
        <i class="fa-solid fa-file-lines" inert></i> ${esc(sessionPageName(session))}</button>
    </section>`;
  });

  return `<div class="mq-notes-index">${blocks.join("")}</div>`;
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

  // 0.27 (Mario, 2026-08-07): os grupos nascem das SESSOES, nao das linhas. Antes, sessao
  // sem nada registrado simplesmente nao existia nesta aba — Mario abriu duas sessoes e viu
  // "Nothing logged yet", o que faz o caderno parecer nao ter recebido nada. Agora toda
  // sessao tem seu cabecalho aqui desde que e aberta, com ou sem linhas embaixo.
  // Ordem CRESCENTE, como na lista da Details; "Before session records" vem primeiro,
  // porque e o que antecede a sessao 1.
  const numbers = [...(model.sessions ?? [])].map((s) => s.number).sort((a, b) => a - b);
  const stray = [...new Set(log.map((item) => item.session ?? null))]
    .filter((n) => n !== null && !numbers.includes(n))
    .sort((a, b) => a - b);
  const hasLoose = log.some((item) => (item.session ?? null) === null);

  const groups = [...(hasLoose ? [null] : []), ...numbers, ...stray].map((session) => ({
    session,
    items: log.filter((item) => (item.session ?? null) === session)
  }));

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

  // 0.25: cada grupo ganha o proprio gesto de limpeza, e o selo aparece no cabecalho.
  // Sessao selada nao mostra o botao: o selo existe justamente para tirar aquela sessao
  // do alcance do gesto em massa (e o de sessao e um gesto em massa, em escala menor).
  const groupActions = (number) => {
    if (!model.canEdit || number == null) return "";
    const session = byNumber.get(number);
    if (session?.sealed) {
      return `<span class="mq-log-sealed" title="Sealed — protected from Clear log"><i class="fa-solid fa-lock" inert></i></span>`;
    }
    return `<button type="button" class="mq-icon-button mq-danger" data-action="log-clear" data-session="${number}"
      title="Clear this session's entries"><i class="fa-solid fa-eraser" inert></i></button>`;
  };

  const body = groups.length
    ? groups
        .map(
          (group) => `
        <h3 class="mq-log-session">${heading(group.session)}${groupActions(group.session)}</h3>
        ${group.items.length
          ? `<table class="mq-log-table"><tbody>${group.items.map(row).join("")}</tbody></table>`
          : `<p class="mq-log-empty-group">Nothing recorded in this session yet.</p>`}`
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
      ${model.canEdit ? `<button type="button" class="mq-bulk mq-danger" data-action="log-clear"><i class="fa-solid fa-eraser" inert></i> Clear log</button>` : ""}
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
 * completed/granted e clues found+known; nada e gravado em playernotes — derivado que
 * se grava vira duplicata na proxima edicao. Elemento oculto nunca entra, mesmo que
 * seu estado de ficcao tenha avancado. Bloco vazio nao se desenha.
 */
function renderDerivedProgress(model) {
  const objectives = model.objectives.filter((o) => o.completed && !o.hidden);
  const rewards = model.rewards.filter((r) => r.granted && !r.hidden);
  // `found` diz que a mesa obteve a pista; `known` garante que os PCs podem le-la no
  // painel. Sao eixos distintos por DEC-035, entao nao basta qualquer um isoladamente.
  const clues = model.clues.filter((c) => c.found && c.known && !c.hidden);
  if (!objectives.length && !rewards.length && !clues.length) return "";

  const sections = [
    {
      title: "Objectives",
      rows: objectives.map((o) => `<li><i class="fa-solid fa-check" inert></i> ${esc(o.name)}</li>`)
    },
    {
      title: "Rewards",
      rows: rewards.map((r) => `<li><i class="fa-solid fa-trophy" inert></i> ${esc(r.name)}</li>`)
    },
    {
      title: "Clues",
      rows: clues.map((c) => `<li><i class="fa-solid fa-magnifying-glass-plus" inert></i> ${esc(c.name)}</li>`)
    }
  ].filter((section) => section.rows.length);

  const content = sections
    .map((section) => `
      <section class="mq-derived-section">
        <h4 class="mq-derived-section-title">${section.title}</h4>
        <ul class="mq-derived-list">${section.rows.join("")}</ul>
      </section>
    `)
    .join("");

  return `
    <aside class="mq-derived" aria-label="Progress so far">
      <h3>Progress so far</h3>
      ${content}
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

/* ---------------------------------------------------------------------------------- *
 * Preservacao de rolagem entre renders (0.25)
 * ---------------------------------------------------------------------------------- */

/** Superficies que rolam por conta propria dentro da janela de Quest. */
const SCROLLABLE_SELECTORS = [".mq-details-body", ".mq-notes-read", ".mq-panel-doc"];

/**
 * Le a posicao de rolagem do container e de cada superficie interna, ANTES de trocar o
 * DOM. Chave: o seletor mais o indice de ocorrencia — estavel entre renders porque a
 * estrutura da aba nao muda de um commit para o outro.
 *
 * @param {HTMLElement} content O elemento que hospeda o conteudo da janela.
 * @returns {{root: number, parts: Array<[string, number]>}} As marcas medidas.
 */
export function captureScrollMarks(content) {
  const marks = { root: 0, parts: [] };
  if (!content) return marks;
  marks.root = content.scrollTop ?? 0;
  for (const selector of SCROLLABLE_SELECTORS) {
    const nodes = content.querySelectorAll?.(selector) ?? [];
    Array.from(nodes).forEach((node, index) => {
      if (node.scrollTop) marks.parts.push([`${selector}:${index}`, node.scrollTop]);
    });
  }
  return marks;
}

/**
 * Devolve cada posicao medida ao elemento correspondente do DOM novo. Roda depois do
 * layout (`requestAnimationFrame`): escrever `scrollTop` num elemento que ainda mede zero
 * de altura e um no-op silencioso, e foi assim que a primeira tentativa falhou.
 *
 * @param {HTMLElement} content O elemento que hospeda o conteudo da janela.
 * @param {{root: number, parts: Array<[string, number]>}} marks As marcas de captura.
 */
export function restoreScrollMarks(content, marks) {
  if (!content || !marks) return;
  const apply = () => {
    if (marks.root) content.scrollTop = marks.root;
    for (const [key, value] of marks.parts ?? []) {
      const [selector, index] = key.split(":");
      const node = content.querySelectorAll?.(selector)?.[Number(index)];
      if (node) node.scrollTop = value;
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(apply);
  else apply();
}


/* ---------------------------------------------------------------------------------- *
 * Dialogos e rotulos (0.25)
 * ---------------------------------------------------------------------------------- */

/**
 * Rotulo legivel de uma linha do Log: diz a ESPECIE do item antes do que mudou.
 *
 * "found" sozinho nao informa; "Clue found: Os sonhos indicam o caminho..." informa.
 * Apontado por Mario ao conferir o push nas notas (2026-08-06).
 *
 * @param {object} item Uma entrada do log.
 * @returns {string} HTML escapado da linha.
 */
export function describeLogLine(item) {
  const kind = LOG_KIND_LABEL[item?.targetType] ?? "";
  const head = kind ? `${kind} ${item.change}` : item?.change ?? "";
  const reason = item?.reason ? ` — ${esc(item.reason)}` : "";
  return `<strong>${esc(head)}</strong>: ${esc(item?.target ?? "")}${reason}`;
}

const LOG_KIND_LABEL = Object.freeze({
  objective: "Objective",
  reward: "Reward",
  clue: "Clue",
  dilemma: "Dilemma",
  complication: "Complication",
  outcome: "Outcome",
  quest: "Quest",
  note: "Note"
});

/**
 * Confirmacao simples, com degradacao: sem o Dialog do core (teste, headless), assume
 * NAO. Gesto destrutivo nunca prossegue por ausencia de interface.
 *
 * @param {object} options
 * @returns {Promise<boolean>} Se o usuario confirmou.
 */
export async function confirmDialog({ game = globalThis.game, title = "", content = "" } = {}) {
  const DialogV2 = globalThis.foundry?.applications?.api?.DialogV2;
  if (DialogV2?.confirm) return DialogV2.confirm({ window: { title }, content, modal: true });
  const Dialog = globalThis.Dialog;
  if (Dialog?.confirm) return Dialog.confirm({ title, content });
  return false;
}

/**
 * Ids dos usuarios que sao JOGADORES — os que recebem OWNER na propria pagina (DEC-042).
 *
 * O Mestre fica de fora por ser GM: ele ja alcanca tudo, e inscreve-lo explicitamente so
 * criaria uma segunda fonte de verdade sobre a permissao dele. Conta sem funcao
 * (`role: NONE`) tambem fica de fora; qualquer outro estado conta como jogador, esteja
 * ele conectado ou nao.
 *
 * Existe como funcao propria porque DOIS caminhos criam pagina — o botao do caderno e o
 * push do Log — e ate a 0.25.0 eles discordavam: o segundo passava lista vazia.
 *
 * @param {object} [game] O game do Foundry.
 * @returns {string[]} Os ids.
 */
export function playerUserIds(game = globalThis.game) {
  // 0.30 — CORRECAO. A versao anterior filtrava por `user.active !== false`, e no Foundry
  // `active` significa CONECTADO AGORA, nao "conta habilitada". O efeito, verificado no
  // mundo de Mario em 2026-08-10: caderno criado com a mesa offline nascia com lista de
  // donos VAZIA, e os cinco jogadores ficavam em Observer, sem conseguir escrever. Quem
  // decide quem e jogador e a funcao (`role`), nao a presenca no servidor.
  return Array.from(game?.users ?? [])
    .filter((user) => user?.isGM !== true && (user?.role ?? 1) > 0)
    .map((user) => user?.id)
    .filter(Boolean);
}

/**
 * Previa da criacao do caderno (DEC-004): nada e escrito antes desta confirmacao.
 *
 * @param {object} plan O resultado de `planPlayerNotes`.
 * @returns {Promise<boolean>} Se o Mestre confirmou.
 */
export async function confirmPlan(plan, { game = globalThis.game } = {}) {
  if (!plan || plan.status === "no-quest") return false;
  const pages = plan.pages.length
    ? `<ul>${plan.pages.map((page) => `<li>${esc(page.name)}</li>`).join("")}</ul>`
    : `<p class="mq-hint">No session opened yet — the note starts empty.</p>`;
  // 0.29: a morada mudou (Mario, 2026-08-08) e pode implicar MOVER um caderno que ja
  // existe. Mover e mudanca de estado; previa que a omite nao cumpre a DEC-004 — mesma
  // razao pela qual a previa passou a dizer quem fica dono do que, na 0.26.
  const move = plan.willMove
    ? `<p><strong>The existing note will MOVE</strong> from <em>${esc(plan.moveFrom || "the Journal root")}</em>
       to <em>${esc(plan.folderPath)}</em>. Moving changes the folder only: the document keeps
       its id, so every link to it — including this tab's — keeps working. Nothing is copied
       and nothing is deleted; the old folder stays where it is.</p>`
    : "";

  const fallback = plan.folderMode === "module-root"
    ? `<p class="mq-hint">This quest is not inside a folder, so the note falls back to the
       module's own folder.</p>`
    : plan.folderMode === "adventure-flat"
      ? `<p class="mq-hint">The adventure folder is already at the maximum depth Foundry
         allows, so the note is created directly inside it, without a subfolder.</p>`
      : "";

  return confirmDialog({
    game,
    title: plan.willMove ? "Move the players' note" : "Create the players' note",
    content: `<p>A Journal entry named <strong>${esc(plan.entryName)}</strong> will live in
      <em>${esc(plan.folderPath)}</em>, with these pages:</p>${pages}${move}${fallback}
      <p><strong>Who owns what:</strong> the entry and every page are owned by the players —
      this is the shared notebook of the table, so any of them can write in it, and also erase
      from it. Nothing is deleted by MasterQuest, ever.</p>`
  });
}
