import { MODULE_ID } from "../constants.js";
import { notifyError, notifyInfo, notifyWarning } from "../foundry/environment.js";

let ActiveConsoleClass = null;
let activeConsole = null;

export async function openMasterQuestAuthoringConsole({
  api,
  game = globalThis.game,
  ui = globalThis.ui,
  applicationClass = globalThis.foundry?.applications?.api?.ApplicationV2,
  forceNew = false,
  seed = null
} = {}) {
  if (!api?.masterQuest) {
    throw new Error("MasterQuest API is required to open the authoring console.");
  }

  if (!applicationClass) {
    notifyWarning("MasterQuest Authoring Console requires Foundry ApplicationV2.", ui);
    return {
      opened: false,
      reason: "missing-application-v2"
    };
  }

  if (!ActiveConsoleClass || Object.getPrototypeOf(ActiveConsoleClass.prototype) !== applicationClass.prototype) {
    ActiveConsoleClass = createMasterQuestAuthoringConsoleClass(applicationClass);
  }

  if (forceNew || !activeConsole?.rendered) {
    activeConsole = new ActiveConsoleClass({ api, game, ui, seed });
  }

  await activeConsole.render(true);
  return activeConsole;
}

export function createMasterQuestAuthoringConsoleClass(ApplicationV2) {
  return class MasterQuestAuthoringConsole extends ApplicationV2 {
    static applicationBase = ApplicationV2;

    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-authoring-console`,
      classes: ["masterquest", "masterquest-authoring-console"],
      tag: "section",
      window: {
        title: "MasterQuest",
        icon: "fas fa-scroll",
        resizable: true
      },
      position: {
        width: 1040,
        height: 760
      }
    };

    constructor({ api, game = globalThis.game, ui = globalThis.ui, seed = null, ...options } = {}) {
      super(options);
      this.api = api;
      this.game = game;
      this.ui = ui;
      this.seed = seed ? { ...makeBlankSeed(), ...seed } : makeBlankSeed();
      this.session = this.buildSession();
      this.lastCopied = "";
      this.savedDraft = null;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      return {
        ...context,
        seed: this.seed,
        session: this.session,
        systemProfile: this.session.draft.systemProfile,
        assessment: this.session.assessment,
        questions: this.session.questions,
        gmPreview: this.session.previews.gm,
        playerPreview: this.session.previews.playerSafe,
        exportPreview: this.session.previews.foundryExport,
        lastCopied: this.lastCopied,
        savedDraft: this.savedDraft
      };
    }

    async _renderHTML(context) {
      const element = document.createElement("div");
      element.className = "masterquest-console";
      element.innerHTML = renderConsole(context);
      return element;
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
      this.activateListeners(result);
    }

    activateListeners(element) {
      const form = element.querySelector("[data-masterquest-authoring-form]");
      form?.addEventListener("submit", (event) => {
        event.preventDefault();
        this.seed = collectSeedFromForm(form);
        this.session = this.buildSession();
        this.savedDraft = null;
        notifyInfo("MasterQuest draft refreshed.", this.ui);
        this.render({ force: true });
      });

      element.querySelector("[data-action='reset']").addEventListener("click", () => {
        this.seed = makeBlankSeed();
        this.session = this.buildSession();
        this.lastCopied = "";
        this.savedDraft = null;
        this.render({ force: true });
      });

      element.querySelectorAll("[data-action='suggest']").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          if (!form) return;

          if (!this.api.masterQuest.suggestElements) {
            notifyWarning("MasterQuest suggestion assistant is not available in this build.", this.ui);
            return;
          }

          const target = button.dataset.target || "complete";
          this.seed = collectSeedFromForm(form);
          const suggestion = this.api.masterQuest.suggestElements(this.seed, {
            target,
            game: this.game
          });
          this.seed = mergeSeedWithSuggestions(this.seed, suggestion.fieldSuggestions);
          this.session = this.buildSession();
          this.savedDraft = null;
          notifyInfo(`MasterQuest suggestions applied: ${formatSuggestionTarget(target)}.`, this.ui);
          this.render({ force: true });
        });
      });

      element.querySelector("[data-action='save-journal']").addEventListener("click", async (event) => {
        event.preventDefault();
        if (!form) return;
        await this.saveCurrentDraftToJournal(form);
      });

      element.querySelector("[data-action='advance']")?.addEventListener("click", (event) => {
        event.preventDefault();
        this.advanceToAdventureReview();
      });

      element.querySelector("[data-action='copy-gm']").addEventListener("click", () =>
        this.copyText(this.session.previews.gm.markdown, "Preview do GM copiado para a área de transferência.")
      );

      element.querySelector("[data-action='copy-player']").addEventListener("click", () =>
        this.copyText(this.session.previews.playerSafe.markdown, "Preview player-safe copiado para a área de transferência.")
      );

      element.querySelector("[data-action='copy-json']").addEventListener("click", () =>
        this.copyText(JSON.stringify(this.session.draft, null, 2), "Dados do draft copiados para a área de transferência.")
      );
    }

    buildSession() {
      return this.api.masterQuest.startAuthoringWizard(this.seed, { game: this.game });
    }

    async saveCurrentDraftToJournal(form) {
      if (!this.api.masterQuest.saveDraftToJournal) {
        notifyWarning("MasterQuest Journal storage is not available in this build.", this.ui);
        return;
      }

      this.seed = collectSeedFromForm(form);
      this.session = this.buildSession();
      const result = await this.api.masterQuest.saveDraftToJournal(this.session.draft, {
        game: this.game
      });

      if (result.status === "created" || result.status === "updated") {
        const action = result.status === "created" ? "created" : "updated";
        this.lastCopied = `Journal draft ${action}: ${result.journalEntryName}`;
        this.savedDraft = {
          status: result.status,
          journalEntryName: result.journalEntryName,
          journalEntryId: result.journalEntryId ?? null,
          journalEntryUuid: result.journalEntryUuid ?? null
        };
        notifyInfo(`MasterQuest: ${this.lastCopied}`, this.ui);
        this.render({ force: true });
        return;
      }

      const message = result.error || result.reason || "Journal draft was not saved.";
      notifyError(`MasterQuest: ${message}`, this.ui);
      this.lastCopied = message;
      this.savedDraft = null;
      this.render({ force: true });
    }

    advanceToAdventureReview() {
      if (!this.savedDraft) {
        notifyWarning("Salve o draft em Journal antes de avançar.", this.ui);
        return;
      }

      if (!this.api.masterQuest.openAdventureReview) {
        notifyWarning("Adventure Review não está disponível neste build.", this.ui);
        return;
      }

      // Abre a janela read-only com o draft atual (que corresponde ao Journal salvo,
      // pois qualquer edicao posterior invalida savedDraft).
      return this.api.masterQuest.openAdventureReview({
        draft: this.session.draft,
        game: this.game,
        ui: this.ui,
        applicationClass: this.constructor.applicationBase
      });
    }

    async copyText(text, message) {
      const value = String(text ?? "");
      if (globalThis.navigator?.clipboard?.writeText) {
        await globalThis.navigator.clipboard.writeText(value);
      }
      this.lastCopied = message;
      notifyInfo(`MasterQuest: ${message}`, this.ui);
      this.render({ force: true });
    }
  };
}

function renderConsole(context) {
  const { seed, session, assessment, questions, gmPreview, playerPreview, exportPreview, systemProfile, lastCopied, savedDraft } = context;
  const readyClass = assessment.readyForPreview ? "ready" : "needs-work";
  const systemLabel = systemProfile
    ? `${systemProfile.label}${systemProfile.version ? ` ${systemProfile.version}` : ""}`
    : "Agnostic";

  return `
    <header class="mq-header">
      <div>
        <h1>MasterQuest</h1>
        <p>${escapeHtml(session.draft.title)}</p>
      </div>
      <div class="mq-status">
        <span class="mq-pill ${readyClass}">${assessment.readyForPreview ? "Preview ready" : "Drafting"}</span>
        <span class="mq-pill">${escapeHtml(systemLabel)}</span>
        <span class="mq-pill">Manual save</span>
      </div>
    </header>

    <section class="mq-panel mq-assistant-bar">
      <div>
        <h2>Assistente</h2>
      </div>
      <button type="button" data-action="suggest" data-target="complete">
        <i class="fas fa-wand-magic-sparkles"></i> Sugerir derivados
      </button>
    </section>

    <div class="mq-grid">
      <form data-masterquest-authoring-form class="mq-panel mq-form">
        <div class="mq-field">
          <label for="mq-title">Titulo</label>
          <input id="mq-title" name="title" type="text" value="${escapeAttribute(seed.title)}">
        </div>

        <div class="mq-field">
          <label for="mq-premise">Premissa</label>
          <textarea id="mq-premise" name="premise" rows="4">${escapeHtml(seed.premise)}</textarea>
        </div>

        <div class="mq-field">
          <label for="mq-dramatic-question">Pergunta dramatica</label>
          <textarea id="mq-dramatic-question" name="dramaticQuestion" rows="2">${escapeHtml(seed.dramaticQuestion)}</textarea>
        </div>

        <div class="mq-field">
          <label for="mq-player-summary">Resumo player-safe</label>
          <textarea id="mq-player-summary" name="playerSafeSummary" rows="2">${escapeHtml(seed.playerSafeSummary)}</textarea>
        </div>

        <div class="mq-two">
          ${renderTextarea("objectives", "Objetivos", seed.objectives, { suggest: true })}
          ${renderTextarea("threats", "Oposicao", seed.threats, { suggest: true })}
          ${renderTextarea("scenes", "Cenas", seed.scenes, { suggest: true })}
          ${renderTextarea("clues", "Pistas", seed.clues, { suggest: true })}
          ${renderTextarea("rewards", "Recompensas", seed.rewards, { suggest: true })}
          ${renderTextarea("gmSecrets", "Segredos GM", seed.gmSecrets, { suggest: true })}
          ${renderTextarea("locations", "Locais", seed.locations, { suggest: true })}
          ${renderTextarea("factions", "Factions", seed.factions, { suggest: true })}
          ${renderTextarea("clocks", "Relogios", seed.clocks, { suggest: true })}
          ${renderTextarea("riskNotes", "Riscos", seed.riskNotes, { suggest: true })}
        </div>

        <div class="mq-two">
          ${renderTextarea("partyAnchors", "Âncoras de Party", seed.partyAnchors, { hint: "Liga a quest aos PCs e aos interesses da party. Uma âncora por linha." })}
          ${renderTextarea("storyAnchors", "Âncoras de História", seed.storyAnchors, { hint: "Liga a quest à continuidade: NPCs, facções, locais, itens, pontas soltas. Uma âncora por linha." })}
        </div>

        <footer class="mq-actions">
          <button type="submit"><i class="fas fa-wand-magic-sparkles"></i> Atualizar</button>
          <button type="button" data-action="save-journal"><i class="fas fa-book"></i> Salvar em Journal</button>
          ${savedDraft ? `<button type="button" data-action="advance" title="Abrir a revisão da aventura a partir do draft salvo"><i class="fas fa-arrow-right"></i> Avançar</button>` : ""}
          <button type="button" data-action="reset"><i class="fas fa-rotate-left"></i> Limpar</button>
        </footer>
      </form>

      <aside class="mq-panel mq-review">
        <section>
          <h2>Lacunas</h2>
          ${renderQuestions(questions)}
        </section>

        <section>
          <h2>Contagem</h2>
          ${renderCounts(assessment.counts)}
        </section>

        <section>
          <h2>Export preview</h2>
          <dl class="mq-kv">
            <dt>Write mode</dt><dd>${escapeHtml(exportPreview.writeMode)}</dd>
            <dt>Ready</dt><dd>${exportPreview.readyForExportPlan ? "yes" : "no"}</dd>
            <dt>Blockers</dt><dd>${exportPreview.blockers.length}</dd>
          </dl>
        </section>

        ${lastCopied ? `<p class="mq-copy-state">${escapeHtml(lastCopied)}</p>` : ""}
      </aside>
    </div>

    <section class="mq-panel mq-previews">
      <div class="mq-preview-toolbar">
        <h2>Previews</h2>
        <div class="mq-copy-actions">
          <button type="button" data-action="copy-gm" title="Copiar o preview do GM para a área de transferência"><i class="fas fa-copy"></i> Copiar GM</button>
          <button type="button" data-action="copy-player" title="Copiar o preview player-safe para a área de transferência"><i class="fas fa-copy"></i> Copiar Player</button>
          <button type="button" data-action="copy-json" title="Copiar os dados do draft (JSON) para a área de transferência"><i class="fas fa-code"></i> Copiar Dados</button>
        </div>
      </div>
      <p class="mq-copy-note">Estes botões copiam para a área de transferência. Para salvar o rascunho, use <strong>Salvar em Journal</strong>.</p>
      <div class="mq-preview-grid">
        <article>
          <h3>GM</h3>
          <pre>${escapeHtml(gmPreview.markdown)}</pre>
        </article>
        <article>
          <h3>Player-safe</h3>
          <pre>${escapeHtml(playerPreview.markdown)}</pre>
        </article>
      </div>
    </section>
  `;
}

function renderTextarea(name, label, value, options = {}) {
  const suggestButton = options.suggest
    ? `<button type="button" class="mq-suggest-button" data-action="suggest" data-target="${escapeAttribute(name)}" title="Sugerir ${escapeAttribute(label)}"><i class="fas fa-wand-magic-sparkles"></i> Sugerir</button>`
    : "";

  return `
    <div class="mq-field">
      <div class="mq-field-label-row">
        <label for="mq-${escapeAttribute(name)}">${escapeHtml(label)}</label>
        ${suggestButton}
      </div>
      <textarea id="mq-${escapeAttribute(name)}" name="${escapeAttribute(name)}" rows="3"${options.hint ? ` title="${escapeAttribute(options.hint)}"` : ""}>${escapeHtml(listToText(value))}</textarea>
    </div>
  `;
}

function renderQuestions(questions) {
  if (!questions.length) {
    return "<p class=\"mq-empty\">Nenhuma lacuna critica.</p>";
  }

  return `
    <ol class="mq-question-list">
      ${questions.map((question) => `
        <li>
          <strong>${escapeHtml(question.prompt)}</strong>
          <span>${escapeHtml(question.whyItMatters)}</span>
        </li>
      `).join("")}
    </ol>
  `;
}

function renderCounts(counts) {
  return `
    <dl class="mq-counts">
      ${Object.entries(counts).map(([key, value]) => `
        <dt>${escapeHtml(key)}</dt>
        <dd>${Number(value)}</dd>
      `).join("")}
    </dl>
  `;
}

function collectSeedFromForm(form) {
  const data = new FormData(form);
  return {
    title: cleanText(data.get("title")),
    premise: cleanText(data.get("premise")),
    dramaticQuestion: cleanText(data.get("dramaticQuestion")),
    playerSafeSummary: cleanText(data.get("playerSafeSummary")),
    objectives: textToList(data.get("objectives")),
    threats: textToList(data.get("threats")),
    scenes: textToList(data.get("scenes")),
    clues: textToList(data.get("clues")),
    rewards: textToList(data.get("rewards")),
    gmSecrets: textToList(data.get("gmSecrets")),
    locations: textToList(data.get("locations")),
    factions: textToList(data.get("factions")),
    clocks: textToList(data.get("clocks")),
    riskNotes: textToList(data.get("riskNotes")),
    partyAnchors: textToList(data.get("partyAnchors")),
    storyAnchors: textToList(data.get("storyAnchors"))
  };
}

function mergeSeedWithSuggestions(seed, fieldSuggestions = {}) {
  const next = { ...seed };

  for (const [field, suggestions] of Object.entries(fieldSuggestions)) {
    next[field] = mergeLists(next[field], suggestions);
  }

  return next;
}

function mergeLists(current, suggestions) {
  const merged = [];
  const seen = new Set();

  for (const entry of [...toList(current), ...toList(suggestions)]) {
    const value = cleanText(entry);
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;

    seen.add(key);
    merged.push(value);
  }

  return merged;
}

function toList(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value == null) {
    return [];
  }

  return textToList(value);
}

function formatSuggestionTarget(target) {
  const labels = {
    complete: "campos derivados",
    objectives: "objetivos",
    threats: "oposicao",
    scenes: "cenas",
    clues: "pistas",
    rewards: "recompensas",
    gmSecrets: "segredos GM",
    locations: "locais",
    factions: "factions",
    clocks: "relogios",
    riskNotes: "riscos"
  };

  return labels[target] ?? target;
}

function makeBlankSeed() {
  return {
    title: "",
    premise: "",
    dramaticQuestion: "",
    playerSafeSummary: "",
    objectives: [],
    threats: [],
    scenes: [],
    clues: [],
    rewards: [],
    gmSecrets: [],
    locations: [],
    factions: [],
    clocks: [],
    riskNotes: [],
    partyAnchors: [],
    storyAnchors: []
  };
}

function textToList(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => cleanText(line).replace(/^[-*]\s+/, ""))
    .filter(Boolean);
}

function listToText(value) {
  return Array.isArray(value) ? value.join("\n") : cleanText(value);
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
