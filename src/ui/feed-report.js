/**
 * MasterQuest Feed Report: o gesto de PREPARACAO.
 *
 * O Mestre abre a mesa antes da sessao e o modulo devolve, sem que ele peca item por item,
 * o que ja ficou estabelecido — para que a urna continue de cristal.
 *
 * DUAS REGRAS GOVERNAM ESTA TELA, e nenhuma delas e negociavel:
 *
 * 1. **Ela NAO ESCREVE** (DEC-004). Nenhuma quest e alterada, nenhum campo e gravado,
 *    nenhuma sugestao e aplicada. O Feed mostra; quem decide e o Mestre. Nao existe neste
 *    arquivo uma unica chamada de escrita, e isso e guardado por teste.
 *
 * 2. **Ela NAO ADIVINHA** (DEC-066). Rubrica que a 1.x nao sabe computar aparece vazia e
 *    honesta, nunca preenchida por inferencia. O terceiro bloco existe justamente para
 *    abrigar o que o modulo SUSPEITA sem afirmar — e ele nunca propoe correcao automatica:
 *    mostra as duas versoes e para por ai.
 *
 * A maquina de leitura ja existia e estava DESLIGADA: `readContinuityReportState` (o parser
 * dos relatorios do FQL) e `aggregateContinuityState` (o cruzamento com o estado vivo)
 * estavam no repositorio, testados, sem nenhum chamador na interface. Esta tela e o fio.
 */

import { MODULE_ID } from "../constants.js";
import { applyInterfaceSkin } from "../foundry/skin-settings.js";
import { filterHeaderControls } from "../foundry/window-controls.js";
import { notifyError, notifyWarning } from "../foundry/environment.js";
import { readContinuityReportState } from "../continuity/read-continuity-report.js";
import { aggregateContinuityState } from "../continuity/aggregate-continuity-state.js";
import { readAllQuests } from "../quest/quest-store.js";
import { cls, esc } from "./render-utils.js";

let FeedReportClass = null;
let activeFeed = null;

/**
 * Open (or focus) the Feed Report window.
 *
 * @param {object} [options]
 * @param {object} [options.api] The MasterQuest API.
 * @param {object} [options.game] The Foundry game object.
 * @param {object} [options.ui] The Foundry ui object.
 * @param {Function} [options.applicationClass] ApplicationV2, injectable for tests.
 * @returns {Promise<object>} The application instance, or a failure descriptor.
 */
export async function openFeedReport({
  api = null,
  game = globalThis.game,
  ui = globalThis.ui,
  applicationClass = globalThis.foundry?.applications?.api?.ApplicationV2
} = {}) {
  if (!applicationClass) {
    notifyWarning("O MasterQuest requer Foundry ApplicationV2.", ui);
    return { opened: false, reason: "missing-application-v2" };
  }

  // O Feed cruza relatorio com o estado VIVO de todas as quests, inclusive as ocultas ao
  // jogador. Nao e tela de mesa: e tela de preparacao, e so o Mestre entra.
  if (game?.user?.isGM !== true) {
    notifyWarning("O Feed Report e do Mestre.", ui);
    return { opened: false, reason: "not-gm" };
  }

  if (!FeedReportClass || Object.getPrototypeOf(FeedReportClass.prototype) !== applicationClass.prototype) {
    FeedReportClass = createFeedReportClass(applicationClass);
  }

  if (!activeFeed?.rendered) activeFeed = new FeedReportClass({ api, game, ui });

  try {
    await activeFeed.render({ force: true });
  } catch (error) {
    console.error(`${MODULE_ID} | falha ao abrir o Feed Report`, error);
    notifyError(`MasterQuest não conseguiu abrir o Feed Report: ${error?.message ?? error}`, ui);
    activeFeed = null;
    return { opened: false, reason: "render-failed", error };
  }

  return activeFeed;
}

/**
 * Build the Feed Report application class.
 *
 * @param {Function} ApplicationV2 The base class.
 * @returns {Function} The Feed Report class.
 */
export function createFeedReportClass(ApplicationV2) {
  return class MasterQuestFeedReport extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["masterquest", "masterquest-feed-report"],
      tag: "section",
      window: { title: "Feed Report", icon: "fa-solid fa-file-arrow-up", resizable: true },
      // Mesma largura da janela de quest (1.1.1): a prevía tem tres blocos com procedencia
      // em cada item, e procedencia e texto longo.
      position: { width: 1160, height: 800 }
    };

    constructor({ api = null, game = globalThis.game, ui = globalThis.ui } = {}) {
      super();
      this.api = api;
      this.game = game;
      this.ui = ui;
      /** @type {Array<object>} Relatorios ja lidos nesta sessao da janela. */
      this.reports = [];
      /** @type {object|null} O consolidado, ou null enquanto nada foi carregado. */
      this.state = null;
      /** @type {Array<{name: string, error: string}>} Arquivos que nao puderam ser lidos. */
      this.rejected = [];
    }

    _getHeaderControls() {
      return filterHeaderControls(super._getHeaderControls?.() ?? [], { game: this.game });
    }

    async _renderHTML() {
      return renderFeedReport({
        reports: this.reports,
        state: this.state,
        rejected: this.rejected
      });
    }

    async _replaceHTML(result, content) {
      content.innerHTML = result;
      applyInterfaceSkin(content, { game: this.game });
      this.#activate(content);
    }

    /**
     * Read the chosen files, parse each one and aggregate against the live world.
     *
     * Um arquivo ilegivel NAO derruba os outros: ele vai para `rejected` e aparece na tela,
     * nomeado. Silenciar um arquivo que nao entrou seria pior do que nao ler nenhum — o
     * Mestre veria um consolidado incompleto acreditando que esta completo.
     *
     * @param {Array<File>} files The files chosen by the GM.
     * @returns {Promise<void>}
     */
    async ingest(files) {
      const rejected = [];
      const parsed = [];

      for (const file of files) {
        try {
          const text = await file.text();
          const report = readContinuityReportState(text, { sourcePath: file.name });
          if (!report?.questTitle && !report?.reportTitle) {
            rejected.push({ name: file.name, error: "não parece um relatório de continuidade" });
            continue;
          }
          parsed.push(report);
        } catch (error) {
          rejected.push({ name: file.name, error: String(error?.message ?? error) });
        }
      }

      this.reports = [...this.reports, ...parsed];
      this.rejected = rejected;
      this.state = aggregateContinuityState({
        questStates: readAllQuests({ game: this.game }),
        continuityReports: this.reports,
        journalIndex: journalIndexOf(this.game)
      });

      await this.render({ force: false });
    }

    #activate(root) {
      const input = root.querySelector("[data-action='pick-reports']");
      input?.addEventListener("change", async (event) => {
        const files = Array.from(event.target?.files ?? []);
        if (!files.length) return;
        try {
          await this.ingest(files);
        } catch (error) {
          console.error(`${MODULE_ID} | falha ao ler os relatórios`, error);
          notifyError(`MasterQuest não conseguiu ler os relatórios: ${error?.message ?? error}`, this.ui);
        }
      });

      root.querySelector("[data-action='clear-feed']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        this.reports = [];
        this.rejected = [];
        this.state = null;
        await this.render({ force: false });
      });
    }
  };
}

/**
 * A lista de entradas do Journal, usada pelo agregador para dizer quando um relatório fala
 * de uma quest que o mundo não tem (e vice-versa).
 *
 * @param {object} game The Foundry game object.
 * @returns {Array<object>} `{id, name, uuid}` por entrada.
 */
function journalIndexOf(game) {
  const journal = game?.journal;
  const entries = typeof journal?.map === "function" ? Array.from(journal) : [];
  return entries.map((entry) => ({
    id: entry?.id ?? null,
    name: entry?.name ?? "",
    uuid: entry?.uuid ?? null
  }));
}

/**
 * Render the Feed Report body.
 *
 * @param {object} context `{reports, state, rejected}`.
 * @returns {string} HTML.
 */
export function renderFeedReport({ reports = [], state = null, rejected = [] } = {}) {
  const picker = `
    <div class="mq-feed-picker">
      <label class="mq-bulk" for="mq-feed-input">
        <i class="fa-solid fa-folder-open" inert></i> Choose continuity reports</label>
      <input type="file" id="mq-feed-input" accept=".md,.markdown,.txt" multiple
        data-action="pick-reports" class="mq-feed-input">
      ${reports.length
        ? `<button type="button" class="mq-bulk" data-action="clear-feed">
             <i class="fa-solid fa-eraser" inert></i> Clear</button>`
        : ""}
      <span class="mq-hint">${esc(reports.length)} report(s) read. Nothing is written to any quest.</span>
    </div>`;

  const rejectedBlock = rejected.length
    ? `<section class="mq-feed-rejected">
        <h2><i class="fa-solid fa-triangle-exclamation" inert></i> Not read</h2>
        <ul class="mq-box">${rejected
          .map((r) => `<li><strong>${esc(r.name)}</strong> — ${esc(r.error)}</li>`)
          .join("")}</ul>
      </section>`
    : "";

  if (!state) {
    return `
      <div class="mq-feed">
        <header class="mq-feed-header">
          <div class="mq-hub-heading">
            <h1>Feed Report</h1>
            <p>Reads what past sessions established. It never changes a quest.</p>
          </div>
        </header>
        ${picker}
        ${rejectedBlock}
        <p class="mq-empty">Choose one or more continuity reports to begin.</p>
      </div>`;
  }

  return `
    <div class="mq-feed">
      <header class="mq-feed-header">
        <div class="mq-hub-heading">
          <h1>Feed Report</h1>
          <p>${esc(state.reportCount)} report(s) against ${esc(state.questCount)} quest(s) in this world.</p>
        </div>
      </header>
      ${picker}
      ${rejectedBlock}
      <div class="mq-feed-blocks">
        ${block("What is established", "fa-anchor", state.facts, factLine)}
        ${block("What is still hanging", "fa-hourglass-half", state.openThreads, threadLine)}
        ${block("What the module is unsure about", "fa-circle-question", state.uncertainties, uncertaintyLine)}
      </div>
    </div>`;
}

/**
 * Um bloco da prévia.
 *
 * Bloco vazio NAO desaparece: ele aparece dizendo que está vazio. Um bloco ausente parece
 * "não apurado"; um bloco vazio e rotulado diz "apurado, e não há nada" — e essa diferença
 * é o que separa uma prévia honesta de uma prévia tranquilizadora.
 *
 * @param {string} title The block title.
 * @param {string} icon The Font Awesome icon class.
 * @param {Array<object>} items The items.
 * @param {Function} lineOf Renders one item.
 * @returns {string} HTML.
 */
function block(title, icon, items, lineOf) {
  const list = items?.length
    ? `<ul class="mq-box">${items.map((item) => `<li>${lineOf(item)}</li>`).join("")}</ul>`
    : `<p class="mq-empty">Nothing found — and that is a reading, not a gap.</p>`;

  return `
    <section class="mq-feed-block">
      <header><h2><i class="fa-solid ${esc(icon)}" inert></i> ${esc(title)}</h2>
        <span class="mq-feed-count">${esc(items?.length ?? 0)}</span></header>
      ${list}
    </section>`;
}

/**
 * A procedência de um item — a parte que impede o Feed de virar palpite.
 *
 * @param {object} item An aggregated item.
 * @returns {string} HTML.
 */
function provenance(item) {
  const parts = [];
  if (item?.sourcePath) parts.push(item.sourcePath);
  else if (item?.sourceKind === "quest") parts.push("live world");
  if (item?.reportDateLabel ?? item?.sourceDateLabel) {
    parts.push(String(item.reportDateLabel ?? item.sourceDateLabel));
  }
  if (!parts.length) return "";
  return `<span class="mq-feed-source">${esc(parts.join(" · "))}</span>`;
}

function factLine(fact) {
  const head = `<strong>${esc(fact?.title ?? "—")}</strong>`;
  const body = fact?.text
    ? esc(fact.text)
    : fact?.status
      ? `status: ${esc(fact.status)}`
      : esc(fact?.type ?? "");
  return `${head} ${body} ${provenance(fact)}`;
}

function threadLine(thread) {
  const head = thread?.title ? `<strong>${esc(thread.title)}</strong> ` : "";
  return `${head}${esc(thread?.text ?? thread?.label ?? "")} ${provenance(thread)}`;
}

/**
 * A incerteza mostra AS DUAS VERSOES e para. Ela nunca propõe correção.
 *
 * @param {object} item An uncertainty.
 * @returns {string} HTML.
 */
function uncertaintyLine(item) {
  const head = item?.title ? `<strong>${esc(item.title)}</strong> ` : "";
  const versions = item?.reported && item?.current
    ? `<span class="${cls("mq-feed-versions")}">report: ${esc(item.reported)} · world: ${esc(item.current)}</span>`
    : "";
  return `${head}${esc(item?.text ?? item?.reason ?? item?.type ?? "")} ${versions} ${provenance(item)}`;
}
