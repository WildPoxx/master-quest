import { applySeedSuggestions, masterQuestDraftToSeed } from "../authoring/master-quest-authoring.js";
import { MODULE_ID } from "../constants.js";
import { notifyError, notifyInfo, notifyWarning } from "../foundry/environment.js";
import { applyInterfaceSkin } from "../foundry/skin-settings.js";

let ActiveReviewClass = null;
let activeReview = null;

// Read-only Adventure Review window (backlog item 5).
// Opens from a saved MasterQuest draft and presents the whole adventure as a
// structured GM planning document. Edit/suggestion actions and quest generation
// are later backlog steps; this layer never writes to the Foundry world.
export async function openMasterQuestAdventureReview({
  api,
  draft,
  game = globalThis.game,
  ui = globalThis.ui,
  applicationClass = globalThis.foundry?.applications?.api?.ApplicationV2,
  forceNew = false
} = {}) {
  if (!isReviewableDraft(draft)) {
    notifyWarning("MasterQuest Adventure Review precisa de um draft salvo.", ui);
    return { opened: false, reason: "missing-draft" };
  }

  if (!applicationClass) {
    notifyWarning("MasterQuest Adventure Review requer Foundry ApplicationV2.", ui);
    return { opened: false, reason: "missing-application-v2" };
  }

  if (!ActiveReviewClass || Object.getPrototypeOf(ActiveReviewClass.prototype) !== applicationClass.prototype) {
    ActiveReviewClass = createMasterQuestAdventureReviewClass(applicationClass);
    activeReview = null;
  }

  if (forceNew || !activeReview?.rendered) {
    activeReview = new ActiveReviewClass({ api, draft, game, ui });
  } else {
    activeReview.setDraft(draft);
  }

  await activeReview.render(true);
  return activeReview;
}

export function createMasterQuestAdventureReviewClass(ApplicationV2) {
  return class MasterQuestAdventureReview extends ApplicationV2 {
    static applicationBase = ApplicationV2;

    static DEFAULT_OPTIONS = {
      id: `${MODULE_ID}-adventure-review`,
      classes: ["masterquest", "masterquest-adventure-review"],
      tag: "section",
      window: {
        title: "MasterQuest - Adventure Review",
        icon: "fas fa-book-open",
        resizable: true
      },
      position: {
        width: 920,
        height: 760
      }
    };

    constructor({ api, draft, game = globalThis.game, ui = globalThis.ui, ...options } = {}) {
      super(options);
      this.api = api;
      this.draft = draft;
      this.game = game;
      this.ui = ui;
    }

    setDraft(draft) {
      this.draft = draft;
    }

    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      return {
        ...context,
        draft: this.draft,
        systemProfile: this.draft?.systemProfile ?? null
      };
    }

    async _renderHTML(context) {
      const element = document.createElement("div");
      element.className = "masterquest-console masterquest-review-doc";
      element.innerHTML = renderAdventureReview(context);
      return element;
    }

    _replaceHTML(result, content) {
      applyInterfaceSkin(content, { game: this.game });
      content.replaceChildren(result);
      this.activateListeners(result);
    }

    activateListeners(element) {
      element.querySelector("[data-action='close-review']")?.addEventListener("click", (event) => {
        event.preventDefault();
        this.close?.();
      });

      element.querySelector("[data-action='back-to-draft']")?.addEventListener("click", (event) => {
        event.preventDefault();
        this.backToDraft();
      });

      element.querySelector("[data-action='send-to-quest-log']")?.addEventListener("click", async (event) => {
        event.preventDefault();
        await this.sendToQuestLog();
      });

      element.querySelectorAll("[data-action='suggest']").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          this.suggestAndEdit(button.dataset.target || "complete");
        });
      });
    }

    /**
     * Close the funnel: the planned adventure becomes a quest in the Quest Log.
     *
     * Saving the draft is what registers the quest — the storage layer writes both the
     * draft and the quest flag onto the same JournalEntry — so this reuses that path
     * instead of inventing a second way to create a quest.
     *
     * @returns {Promise<object>} The save result.
     */
    async sendToQuestLog() {
      const save = this.api?.masterQuest?.saveDraftToJournal;
      if (typeof save !== "function") {
        notifyWarning("Saving to Journal is not available in this build.", this.ui);
        return { status: "unavailable" };
      }

      try {
        const result = await save(this.draft, { game: this.game });
        if (result?.status !== "created" && result?.status !== "updated") {
          notifyWarning(`MasterQuest could not save the adventure (${result?.status ?? "no status"}).`, this.ui);
          return result;
        }

        notifyInfo(
          `MasterQuest: "${this.draft?.title ?? "aventura"}" enviada ao Quest Log como quest inativa.`,
          this.ui
        );
        await this.api?.masterQuest?.openQuestLog?.({ game: this.game, ui: this.ui });
        return result;
      } catch (error) {
        console.error("master-quest | falha ao enviar para o Quest Log", error);
        notifyError(`MasterQuest could not send to the Quest Log: ${error?.message ?? error}`, this.ui);
        return { status: "failed", error: String(error?.message ?? error) };
      }
    }

    // The Adventure Review stays read-only. Editing happens by reopening the
    // Authoring Console with the current content (delegation model), so there is
    // no second write path here.
    openConsoleWithSeed(seed) {
      if (!this.api?.masterQuest?.openAuthoringConsole) {
        notifyWarning("The Authoring Console is not available in this build.", this.ui);
        return undefined;
      }

      const result = this.api.masterQuest.openAuthoringConsole({
        seed,
        game: this.game,
        ui: this.ui,
        forceNew: true,
        applicationClass: this.constructor.applicationBase
      });
      this.close?.();
      return result;
    }

    backToDraft() {
      return this.openConsoleWithSeed(masterQuestDraftToSeed(this.draft));
    }

    suggestAndEdit(target) {
      const seed = masterQuestDraftToSeed(this.draft);
      let nextSeed = seed;

      if (this.api?.masterQuest?.suggestElements) {
        const suggestion = this.api.masterQuest.suggestElements(seed, { target, game: this.game });
        nextSeed = applySeedSuggestions(seed, suggestion?.fieldSuggestions ?? {});
      }

      return this.openConsoleWithSeed(nextSeed);
    }
  };
}

export function renderAdventureReview(context) {
  const draft = context?.draft ?? {};
  const systemProfile = context?.systemProfile ?? draft.systemProfile ?? null;
  const systemLabel = systemProfile
    ? `${systemProfile.label}${systemProfile.version ? ` ${systemProfile.version}` : ""}`
    : "Agnostic";

  return `
    <header class="mq-header">
      <div>
        <h1>Adventure Review</h1>
        <p>${escapeHtml(draft.title)}</p>
      </div>
      <div class="mq-status">
        <span class="mq-pill">${escapeHtml(systemLabel)}</span>
        <span class="mq-pill">Somente leitura</span>
        <button type="button" data-action="close-review"><i class="fas fa-xmark"></i> Fechar</button>
      </div>
    </header>

    <section class="mq-panel mq-review-actions">
      <button type="button" data-action="back-to-draft"><i class="fas fa-pen"></i> Voltar ao Draft</button>
      <button type="button" data-action="suggest" data-target="objectives"><i class="fas fa-wand-magic-sparkles"></i> Sugerir Objetivos</button>
      <button type="button" data-action="suggest" data-target="clues"><i class="fas fa-wand-magic-sparkles"></i> Suggest clues</button>
      <button type="button" data-action="suggest" data-target="rewards"><i class="fas fa-wand-magic-sparkles"></i> Suggest rewards</button>
      <button type="button" class="mq-primary-action" data-action="send-to-quest-log"><i class="fas fa-list-check"></i> Send to Quest Log</button>
    </section>

    <section class="mq-panel mq-review-doc">
      ${textBlock("Premise", draft.premise)}
      ${textBlock("Dramatic question", draft.dramaticQuestion)}
      ${textBlock("GM summary", draft.gmSummary)}
      ${textBlock("Player-safe summary", draft.playerSafeSummary)}

      ${listBlock("Objectives", draft.objectives, formatObjective)}
      ${listBlock("Scenes", draft.scenes, formatScene)}
      ${listBlock("Opposition", draft.threats, (threat) => formatThreat(threat, systemProfile))}
      ${listBlock("Clues", draft.clues, formatClue)}
      ${listBlock("Rewards", draft.rewards, formatReward)}
      ${listBlock("Clocks", draft.clocks, formatClock)}
      ${listBlock("Locations", draft.locations, formatLabelRecord)}
      ${listBlock("Factions", draft.factions, formatLabelRecord)}
      ${listBlock("GM secrets", draft.gmSecrets, formatSecret)}
      ${listBlock("Party anchors", draft.partyAnchors, formatAnchor)}
      ${listBlock("Story anchors", draft.storyAnchors, formatAnchor)}
    </section>
  `;
}

function textBlock(title, value) {
  const text = cleanText(value);
  return `
    <section class="mq-doc-block">
      <h2>${escapeHtml(title)}</h2>
      <p${text ? "" : " class=\"mq-empty\""}>${escapeHtml(text || "Nada planejado ainda.")}</p>
    </section>
  `;
}

function listBlock(title, entries, formatter) {
  const items = Array.isArray(entries) ? entries : [];
  const body = items.length
    ? `<ul class="mq-doc-list">${items.map((entry) => `<li>${escapeHtml(formatter(entry))}</li>`).join("")}</ul>`
    : `<p class="mq-empty">Nada planejado ainda.</p>`;

  return `
    <section class="mq-doc-block">
      <h2>${escapeHtml(title)} <span class="mq-doc-count">${items.length}</span></h2>
      ${body}
    </section>
  `;
}

function joinParts(parts) {
  return parts.map(cleanText).filter(Boolean).join(" — ");
}

function formatObjective(objective) {
  return joinParts([
    objective.title,
    objective.kind,
    objective.visibility,
    objective.successCriteria,
    objective.failureConsequence ? `falha: ${objective.failureConsequence}` : ""
  ]);
}

function formatScene(scene) {
  return joinParts([
    scene.title,
    scene.purpose,
    scene.locationRef,
    scene.challengeType && scene.challengeType !== "unknown" ? scene.challengeType : "",
    scene.gmNotes ? `GM: ${scene.gmNotes}` : ""
  ]);
}

function formatThreat(threat, systemProfile) {
  return joinParts([
    threat.label,
    threat.kind,
    threat.role,
    threat.agenda ? `agenda: ${threat.agenda}` : "",
    systemProfile?.id === "swade" && threat.swadeRole ? `SWADE: ${threat.swadeRole}` : "",
    systemProfile && systemProfile.id !== "swade" && threat.systemRole ? `papel: ${threat.systemRole}` : ""
  ]);
}

function formatClue(clue) {
  return joinParts([
    clue.label,
    clue.summary,
    Array.isArray(clue.reveals) && clue.reveals.length ? `revela: ${clue.reveals.join(", ")}` : ""
  ]);
}

function formatReward(reward) {
  return joinParts([reward.title, reward.kind, reward.unlockCondition]);
}

function formatClock(clock) {
  return joinParts([`${cleanText(clock.label)} (${clock.current}/${clock.max})`, clock.consequence]);
}

function formatLabelRecord(record) {
  return joinParts([record.label, record.role, record.notes]);
}

function formatSecret(secret) {
  return joinParts([secret.label, secret.notes]);
}

function formatAnchor(anchor) {
  return joinParts([anchor.label, anchor.kind, anchor.role, anchor.importance]);
}

function isReviewableDraft(draft) {
  return draft !== null
    && typeof draft === "object"
    && !Array.isArray(draft)
    && typeof draft.title === "string";
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
