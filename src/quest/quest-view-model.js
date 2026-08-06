/**
 * Pure view models for the Quest Log and Quest Details windows.
 *
 * Everything here is a plain function over plain data: no Foundry calls, no DOM. That
 * keeps the interesting decisions — what a player may see, which status buttons are
 * offered, how a subquest is labelled — testable without a running world.
 */

import {
  QUEST_STATUS,
  QUEST_STATUS_LABEL,
  QUEST_STATUS_ORDER,
  GM_ONLY_STATUS,
  countObjectives,
  currentSession
} from "./quest-schema.js";

/**
 * Status transitions offered for a quest, in the order they should be rendered.
 * Mirrors the small action buttons FQL shows on the right of each log row.
 */
const STATUS_ACTIONS = Object.freeze({
  available: ["active", "completed", "failed", "inactive"],
  active: ["completed", "failed", "inactive", "available"],
  completed: ["active", "failed", "inactive"],
  failed: ["active", "completed", "inactive"],
  inactive: ["available", "active"]
});

const STATUS_ACTION_META = Object.freeze({
  available: { icon: "fa-solid fa-circle-half-stroke", label: "Mark as available" },
  active: { icon: "fa-solid fa-circle-play", label: "Mark in progress" },
  completed: { icon: "fa-solid fa-circle-check", label: "Mark as completed" },
  failed: { icon: "fa-solid fa-circle-xmark", label: "Mark as failed" },
  inactive: { icon: "fa-solid fa-circle-minus", label: "Mover para inativas" }
});

/**
 * Build the full Quest Log view model, grouped by status tab.
 *
 * @param {object[]} quests All quests readable by the acting user.
 * @param {object} [options]
 * @param {boolean} [options.isGM] Whether the acting user is a GM.
 * @param {string|null} [options.primaryQuestId] Current primary quest.
 * @param {boolean} [options.countHidden] Count hidden objectives in the badges.
 * @param {string} [options.activeTab] Tab to mark as selected.
 * @returns {object} `{tabs, quests, counts, activeTab, isGM}`.
 */
export function buildQuestLogViewModel(quests, {
  isGM = false,
  primaryQuestId = null,
  countHidden = true,
  activeTab = QUEST_STATUS.active
} = {}) {
  const index = indexById(quests);
  const visible = toArray(quests).filter((quest) => isGM || !isQuestHidden(quest));

  const rows = visible
    .map((quest) => buildQuestRow(quest, { isGM, primaryQuestId, countHidden, index }))
    .sort(byPriorityThenName);

  const tabs = QUEST_STATUS_ORDER
    .filter((status) => isGM || !GM_ONLY_STATUS.includes(status))
    .map((status) => ({
      id: status,
      label: QUEST_STATUS_LABEL[status],
      count: rows.filter((row) => row.status === status).length,
      active: status === activeTab
    }));

  const grouped = {};
  for (const status of QUEST_STATUS_ORDER) {
    grouped[status] = rows.filter((row) => row.status === status);
  }

  return {
    isGM,
    activeTab: tabs.some((tab) => tab.active) ? activeTab : tabs[0]?.id ?? QUEST_STATUS.active,
    tabs,
    quests: grouped,
    counts: Object.fromEntries(tabs.map((tab) => [tab.id, tab.count]))
  };
}

/**
 * Build a single row of the Quest Log.
 *
 * @param {object} quest A normalized quest.
 * @param {object} [options] Rendering context.
 * @returns {object} The row view model.
 */
export function buildQuestRow(quest, {
  isGM = false,
  primaryQuestId = null,
  countHidden = true,
  index = new Map()
} = {}) {
  const objectives = countObjectives(quest, { countHidden });
  const parent = quest.parent ? index.get(quest.parent) ?? null : null;

  return {
    id: quest.id,
    name: quest.name,
    status: quest.status,
    statusLabel: QUEST_STATUS_LABEL[quest.status] ?? quest.status,
    isPrimary: Boolean(primaryQuestId) && quest.id === primaryQuestId,
    isHidden: isQuestHidden(quest),
    isSubquest: Boolean(quest.parent),
    parentId: quest.parent ?? null,
    parentName: parent?.name ?? "",
    subquestCount: toArray(quest.subquests).length,
    img: questIcon(quest),
    giverName: quest.giverName || quest.giverData?.name || "",
    objectives,
    objectiveBadge: `${objectives.done}/${objectives.total}`,
    priority: quest.priority ?? 0,
    statusActions: isGM ? statusActionsFor(quest.status) : []
  };
}

/**
 * Build the Quest Details view model.
 *
 * @param {object} quest A normalized quest.
 * @param {object} [options]
 * @param {boolean} [options.isGM] Whether the acting user is a GM.
 * @param {boolean} [options.canEdit] Whether the user may edit this quest.
 * @param {string|null} [options.primaryQuestId] Current primary quest.
 * @param {object[]} [options.allQuests] Every quest, used to resolve parent and subquests.
 * @param {string} [options.activeTab] Tab to mark as selected.
 * @returns {object} The details view model.
 */
export function buildQuestDetailsViewModel(quest, {
  isGM = false,
  canEdit = false,
  primaryQuestId = null,
  allQuests = [],
  activeTab = "details"
} = {}) {
  const index = indexById(allQuests);
  const parent = quest.parent ? index.get(quest.parent) ?? null : null;

  const subquests = toArray(quest.subquests)
    .map((id) => index.get(id))
    .filter(Boolean)
    .filter((sub) => isGM || !isQuestHidden(sub))
    .map((sub) => buildQuestRow(sub, { isGM, primaryQuestId, index }));

  const objectives = toArray(quest.objectives)
    .filter((objective) => isGM || !objective.hidden)
    .map((objective) => ({
      ...objective,
      state: objective.completed ? "check" : objective.failed ? "times" : "square",
      stateLabel: objective.completed ? "Completed" : objective.failed ? "Failed" : "Open",
      spoiler: !objective.hidden && !objective.known
    }));

  const rewards = toArray(quest.rewards)
    .filter((reward) => isGM || !reward.hidden)
    .map((reward) => ({
      ...reward,
      // DEC-035: "nao sabe mas VE" e o painel entregando spoiler — a unica combinacao
      // sinalizada. "Sabe mas nao ve" e legitima e frequente; nao se marca.
      spoiler: !reward.hidden && !reward.known
    }));

  const dilemmas = toArray(quest.dilemmas)
    .filter((dilemma) => isGM || !dilemma.hidden)
    .map((dilemma) => ({ ...dilemma, spoiler: !dilemma.hidden && !dilemma.known }));

  const clues = toArray(quest.clues)
    .filter((clue) => isGM || !clue.hidden)
    .map((clue) => ({ ...clue, spoiler: !clue.hidden && !clue.known }));

  const outcomes = toArray(quest.outcomes)
    .filter((outcome) => isGM || !outcome.hidden)
    .map((outcome) => ({ ...outcome, spoiler: !outcome.hidden && !outcome.known }));

  const complications = toArray(quest.complications)
    .filter((complication) => isGM || !complication.hidden)
    .map((complication) => ({ ...complication, spoiler: !complication.hidden && !complication.known }));

  // A ordem e deliberada: GM Panel em SEGUNDO, logo depois de Details, porque e de onde o
  // Mestre conduz a quest na mesa (DIR-05); GM Notes vem colado nele porque e o rascunho
  // do mesmo trabalho. Os dois sao um par, e nenhum dos dois existe para o jogador — a
  // guarda isGM abaixo e a mesma invariante de visibilidade de sempre.
  const tabs = [{ id: "details", label: "Details", active: activeTab === "details" }];
  if (isGM) {
    tabs.push({ id: "gmnotes", label: "GM Panel", active: activeTab === "gmnotes" });
    tabs.push({ id: "gmcomments", label: "GM Notes", active: activeTab === "gmcomments" });
  }
  tabs.push({ id: "playernotes", label: "Player Notes", active: activeTab === "playernotes" });
  // DEC-032: a sexta aba. So o Mestre — o Log e instrumento de conducao e de export.
  if (isGM) tabs.push({ id: "log", label: "Log", active: activeTab === "log" });
  if (canEdit) tabs.push({ id: "management", label: "Manage", active: activeTab === "management" });

  return {
    id: quest.id,
    name: quest.name,
    status: quest.status,
    statusLabel: QUEST_STATUS_LABEL[quest.status] ?? quest.status,
    description: quest.description,
    gmnotes: quest.gmnotes,
    gmcomments: quest.gmcomments,
    playernotes: quest.playernotes,
    splash: quest.splash,
    splashPos: quest.splashPos,
    splashAsIcon: quest.splashAsIcon,
    giverName: quest.giverName || quest.giverData?.name || "",
    giverImg: quest.giverData?.img ?? "",
    giverUuid: quest.giverData?.uuid ?? null,
    isPrimary: Boolean(primaryQuestId) && quest.id === primaryQuestId,
    isHidden: isQuestHidden(quest),
    isSubquest: Boolean(parent),
    parentId: parent?.id ?? null,
    parentName: parent?.name ?? "",
    objectives,
    rewards,
    clues,
    dilemmas,
    complications,
    outcomes,
    log: toArray(quest.log),
    // 0.23: sessoes e encerramento editorial. `session` e a corrente (maior numero).
    sessions: toArray(quest.sessions),
    session: currentSession(quest),
    wrappedUp: quest.wrappedUp === true,
    subquests,
    allRewardsVisible: rewards.length > 0 && rewards.every((r) => !r.hidden),
    allRewardsGranted: rewards.length > 0 && rewards.every((r) => r.granted),
    statusActions: canEdit ? statusActionsFor(quest.status) : [],
    tabs,
    activeTab: tabs.some((tab) => tab.active) ? activeTab : "details",
    isGM,
    canEdit
  };
}

/**
 * Status buttons offered for a given status.
 *
 * @param {string} status The current status.
 * @returns {object[]} `{status, icon, label}` entries.
 */
export function statusActionsFor(status) {
  return (STATUS_ACTIONS[status] ?? []).map((target) => ({
    status: target,
    ...STATUS_ACTION_META[target]
  }));
}

/**
 * A quest is hidden from players when its backing JournalEntry grants them nothing.
 *
 * @param {object} quest A quest carrying `entry`.
 * @returns {boolean} True when no player can observe it.
 */
export function isQuestHidden(quest) {
  const ownership = quest?.entry?.ownership ?? quest?.entry?.permission ?? null;
  if (!ownership) return quest?.status === QUEST_STATUS.inactive;

  const defaultLevel = ownership.default ?? 0;
  if (defaultLevel >= 2) return false;

  return !Object.entries(ownership).some(([key, level]) => key !== "default" && level >= 2);
}

/**
 * The image shown in the square at the left of each log row.
 *
 * Herdado do FQL, aquele quadrado servia só para a imagem do quest giver, e ficava vazio
 * em praticamente toda quest. Agora ele mostra, em ordem: a imagem da própria quest, a do
 * quest giver, nada. Assim o espaço passa a ter uso sem exigir um NPC associado.
 *
 * @param {object} quest A quest.
 * @returns {string} An image path, or "".
 */
function questIcon(quest) {
  if (quest.splashAsIcon && quest.splash) return quest.splash;
  return quest.splash || quest.giverData?.img || "";
}

function byPriorityThenName(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  return String(a.name).localeCompare(String(b.name), "pt-BR");
}

function indexById(quests) {
  const map = new Map();
  for (const quest of toArray(quests)) {
    if (quest?.id) map.set(quest.id, quest);
  }
  return map;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}
