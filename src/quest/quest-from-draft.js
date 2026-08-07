/**
 * Bridge from the Authoring Console to the Quest Log.
 *
 * The authoring draft and the quest are two different shapes for two different moments.
 * The draft is preparation: premise, scenes, threats, clues, secrets, clocks. The quest
 * is table management: name, status, objectives, rewards. Everything funnels into the
 * Quest Log, so saving a draft must also register a quest — otherwise the GM authors
 * something that exists in the Journal but is invisible where it is actually run.
 *
 * The quest lands as `inactive`, which is the GM-only tab: authored, not yet handed to
 * the table. Promoting it to `available` or `active` is a deliberate act in the Log.
 */

import { QUEST_STATUS, normalizeQuest } from "./quest-schema.js";
import { AUTHORED_BY_DRAFT, mergeQuest } from "./merge-quest.js";

/**
 * Convert an authoring draft into a Quest Log quest.
 *
 * @param {object} draft A MasterQuest authoring draft.
 * @param {object} [options]
 * @param {string} [options.status] Landing status. Defaults to `inactive`.
 * @returns {object} A normalized quest.
 */
export function draftToQuest(draft = {}, { status = QUEST_STATUS.inactive } = {}) {
  const data = isRecord(draft) ? draft : {};

  return normalizeQuest({
    name: text(data.title) || "Nova Quest",
    status,
    description: buildDescription(data),
    gmnotes: buildGmNotes(data),
    playernotes: "",
    objectives: toArray(data.objectives).map(toObjective).filter((o) => o.name !== ""),
    rewards: toArray(data.rewards).map(toReward).filter((r) => r.name !== ""),
    source: "master-quest-authoring"
  });
}

/**
 * Merge a draft into an existing quest without destroying table state.
 *
 * Re-saving a draft must not uncheck objectives the table already completed, nor demote
 * a quest the table is currently running. Only authored text is refreshed; status and
 * per-objective progress stay as the Log left them.
 *
 * @param {object|null} current The quest currently stored on the JournalEntry.
 * @param {object} draft The authoring draft being saved.
 * @returns {object} A normalized quest.
 */
export function mergeDraftIntoQuest(current, draft) {
  return mergeDraftIntoQuestWithOrphans(current, draft).quest;
}

/**
 * Como `mergeDraftIntoQuest`, mas devolve tambem os orfaos.
 *
 * 0.25: ate a 0.23 este caminho fazia `const { quest } = mergeQuest(...)` e DESCARTAVA o
 * segundo campo — salvar um rascunho revisado por cima de uma quest viva nao produzia
 * relatorio nenhum de divergencia. O item continuava preservado (o merge sempre o
 * preservou); o que faltava era a noticia.
 *
 * @param {object|null} current A quest gravada.
 * @param {object} draft O rascunho de autoria.
 * @returns {{quest: object, orphans: object}} A quest mesclada e os orfaos por colecao.
 */
export function mergeDraftIntoQuestWithOrphans(current, draft) {
  const authored = draftToQuest(draft, { status: current?.status ?? QUEST_STATUS.inactive });
  return mergeQuest(current, authored, {
    authoredBy: AUTHORED_BY_DRAFT,
    // O rascunho de autoria nao tem id estavel por item: casa por nome normalizado.
    matchBy: "name"
  });
}

function buildDescription(draft) {
  const summary = text(draft.playerSafeSummary);
  if (summary) return `<p>${escapeHtml(summary)}</p>`;

  const premise = text(draft.premise);
  return premise ? `<p>${escapeHtml(premise)}</p>` : "";
}

function buildGmNotes(draft) {
  const sections = [
    ["Resumo do Mestre", [text(draft.gmSummary)].filter(Boolean)],
    ["Questão dramática", [text(draft.dramaticQuestion)].filter(Boolean)],
    ["Cenas", labels(draft.scenes)],
    ["Ameaças", labels(draft.threats)],
    ["Pistas", labels(draft.clues)],
    ["Segredos", labels(draft.gmSecrets)],
    ["Relógios", labels(draft.clocks)]
  ].filter(([, items]) => items.length > 0);

  if (!sections.length) return "";

  return sections
    .map(([heading, items]) => {
      const list = items.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
      return `<h3>${escapeHtml(heading)}</h3><ul>${list}</ul>`;
    })
    .join("");
}

function toObjective(entry) {
  const data = isRecord(entry) ? entry : {};
  return {
    id: text(data.id),
    name: text(data.title) || text(data.label),
    completed: false,
    failed: false,
    // DEC-006 + DEC-031: na duvida, oculto. So visibilidade declarada como "player"
    // nasce visivel — revelar sem contexto narrativo e spoiler.
    hidden: data.visibility !== "player"
  };
}

function toReward(entry) {
  const data = isRecord(entry) ? entry : {};
  return {
    id: text(data.id),
    name: text(data.title) || text(data.label),
    // DEC-031: na duvida, oculta. So visibilidade declarada como "player" nasce visivel.
    hidden: data.visibility !== "player",
    granted: false
  };
}

function labels(list) {
  return toArray(list)
    .map((item) => (isRecord(item) ? text(item.label) || text(item.title) : text(item)))
    .filter(Boolean);
}

function normalizeKey(value) {
  return text(value).toLocaleLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
