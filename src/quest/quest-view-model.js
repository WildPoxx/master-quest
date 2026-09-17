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
  QUEST_TYPE,
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
  const visibleIds = new Set(visible.map((quest) => quest.id));

  // 1.3.0 — a etapa nao e linha propria: entra DENTRO da linha do pai. Por isso as abas
  // contam um trabalho, e nao um trabalho mais cada fatia dele. So se recolhe a etapa cujo
  // pai esta DE FATO numa linha desta lista; se o pai nao aparece — oculto para quem le,
  // ausente do mundo, ou ele mesmo recolhido —, a etapa volta a ser linha comum. Conteudo
  // nunca some da vista por causa de agrupamento (P5).
  const rows = visible
    .filter((quest) => !isNestedStage(quest, { index, visibleIds }))
    .map((quest) => buildQuestRow(quest, {
      isGM,
      primaryQuestId,
      countHidden,
      index,
      stages: stagesOf(quest, visible).filter((stage) => isNestedStage(stage, { index, visibleIds }))
    }))
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
  index = new Map(),
  stages = []
} = {}) {
  const objectives = countObjectives(quest, { countHidden });
  const parent = quest.parent ? index.get(quest.parent) ?? null : null;
  const isSequence = quest.type === QUEST_TYPE.sequence;
  const stageRows = toArray(stages).map((stage, position) => buildStageRow(stage, {
    isGM,
    countHidden,
    position: position + 1
  }));
  const current = currentStage(stageRows);

  return {
    id: quest.id,
    name: quest.name,
    status: quest.status,
    statusLabel: QUEST_STATUS_LABEL[quest.status] ?? quest.status,
    isPrimary: Boolean(primaryQuestId) && quest.id === primaryQuestId,
    isHidden: isQuestHidden(quest),
    // 1.3.0: "ter pai" deixou de bastar para ser subquest. `isChild` guarda o sentido
    // antigo; `isSubquest` passa a ser o filho que NAO e etapa.
    isChild: Boolean(quest.parent),
    isSequence,
    isSubquest: Boolean(quest.parent) && !isSequence,
    parentId: quest.parent ?? null,
    parentName: parent?.name ?? "",
    // O badge de ramificacao conta subquest de verdade. Id que nao resolve continua
    // contando, como antes: o badge nunca soube se o filho existia.
    subquestCount: toArray(quest.subquests)
      .filter((id) => index.get(id)?.type !== QUEST_TYPE.sequence).length,
    stages: stageRows,
    // Total so para o Mestre: ao jogador, "de 4" contaria etapas que ele ainda nao pode ver.
    stageTotal: isGM ? stageRows.length : null,
    currentStage: current,
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
    .filter((sub) => sub.type !== QUEST_TYPE.sequence)
    .filter((sub) => isGM || !isQuestHidden(sub))
    .map((sub) => buildQuestRow(sub, { isGM, primaryQuestId, index }));

  // 1.3.0: as etapas saem numa colecao propria, EM ORDEM, e cada uma traz os proprios
  // objetivos ja filtrados pelo mesmo criterio de visibilidade da quest aberta. A tela do
  // pai mostra o arco inteiro; a conclusao de cada objetivo continua na janela da etapa.
  const readable = toArray(allQuests).filter((candidate) => isGM || !isQuestHidden(candidate));
  const sequences = stagesOf(quest, readable).map((stage, position) => ({
    ...buildStageRow(stage, { isGM, position: position + 1 }),
    // 1.3.1 — a lista de etapas do GM Panel mostra o painel de cada etapa sem sair da
    // janela do arco. O texto vem do documento da etapa e e LEITURA: nada nesta tela
    // escreve de volta (DEC-028: o painel e do blueprint; DEC-031: derivado nao se grava).
    // Vazio para quem nao e Mestre, porque o campo inteiro e do Mestre.
    gmnotes: isGM ? String(stage.gmnotes ?? "") : "",
    objectives: toArray(stage.objectives)
      .filter((objective) => isGM || !objective.hidden)
      .map((objective) => ({
        id: objective.id,
        name: objective.name,
        hidden: objective.hidden === true,
        state: objective.completed ? "check" : objective.failed ? "times" : "square",
        stateLabel: objective.completed ? "Completed" : objective.failed ? "Failed" : "Open"
      }))
  }));
  const currentSequence = currentStage(sequences);

  // 1.5.0 — o fluxo so existe para o Mestre: e direcao, como o gmnotes. O peso ganha
  // rotulo aqui para o desenho nao carregar dicionario.
  const flow = isGM
    ? toArray(quest.flow).map((step) => ({
        ...step,
        weightLabel: FLOW_WEIGHT_LABEL[step.weight] ?? step.weight
      }))
    : [];

  const isSequence = quest.type === QUEST_TYPE.sequence;
  const siblings = isSequence && parent ? stagesOf(parent, readable) : [];
  const stageIndex = siblings.findIndex((sibling) => sibling.id === quest.id);

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

  // 1.1.0 — a fileira passa a ter DOIS BLOCOS, por decisao de Mario (2026-08-20):
  //
  //     JOGO      Overview · Manage · GM Panel      o que se opera DURANTE a mesa
  //     REGISTRO  GM Notes · Player Notes · Logs    o que se escreve SOBRE a mesa
  //
  // O campo `block` existe para o CSS pintar os dois conjuntos de forma distinta e para o
  // desenho saber onde entra o filete separador. Sem ele, a interface teria de adivinhar
  // isso a partir do id de cada aba — e adivinhacao envelhece mal.
  //
  // ROTULOS trocados, IDS INTACTOS. "Details" passa a chamar-se **Overview** (a aba e o
  // resumo da quest, nao uma amostra dela) e "Log" passa a **Logs**. Os ids `details` e
  // `log` ficam como estao DE PROPOSITO: o id e o que o modulo guarda como aba corrente e
  // o que `activeTab` e os testes usam. Renomear o id invalidaria a aba guardada de quem
  // ja usa o modulo, em troca de nada.
  //
  // A ordem antiga punha o GM Panel em segundo, colado em Details, porque os dois eram o
  // par de conducao (DIR-05). A ordem nova cumpre o mesmo proposito por outro meio: o
  // bloco do JOGO fica inteiro junto, e o GM Panel segue dentro dele.
  const tabs = [{ id: "details", label: "Overview", block: "play", active: activeTab === "details" }];
  // 1.1.0: a Manage passa a ser guardada por `isGM`, e nao mais por `canEdit`. Ela agora
  // abriga Dilemas, Desfechos e Complicacoes — "o que fica atras da cortina", pelo criterio
  // de Mario. `canEdit` e `isGM || canUserModify(...)`, ou seja, um JOGADOR com posse do
  // JournalEntry da quest entrava aqui. Com o conteudo novo, isso seria a cortina aberta.
  if (isGM) tabs.push({ id: "management", label: "Manage", block: "play", active: activeTab === "management" });
  if (isGM) tabs.push({ id: "gmnotes", label: "GM Panel", block: "play", active: activeTab === "gmnotes" });
  if (isGM) tabs.push({ id: "gmcomments", label: "GM Notes", block: "record", active: activeTab === "gmcomments" });
  tabs.push({ id: "playernotes", label: "Player Notes", block: "record", active: activeTab === "playernotes" });
  // DEC-032: a sexta aba. So o Mestre — o Log e instrumento de conducao e de export.
  if (isGM) tabs.push({ id: "log", label: "Logs", block: "record", active: activeTab === "log" });

  return {
    id: quest.id,
    name: quest.name,
    status: quest.status,
    statusLabel: QUEST_STATUS_LABEL[quest.status] ?? quest.status,
    description: quest.description,
    gmnotes: quest.gmnotes,
    gmcomments: quest.gmcomments,
    playernotes: quest.playernotes,
    // DEC-038: endereco da entrada de Journal das notas do jogador, quando ja existir.
    // A aba mostra o link; o conteudo mora la, nao aqui.
    playerNotesUuid: quest.playerNotesUuid ?? null,
    splash: quest.splash,
    splashPos: quest.splashPos,
    splashAsIcon: quest.splashAsIcon,
    giverName: quest.giverName || quest.giverData?.name || "",
    giverImg: quest.giverData?.img ?? "",
    giverUuid: quest.giverData?.uuid ?? null,
    isPrimary: Boolean(primaryQuestId) && quest.id === primaryQuestId,
    isHidden: isQuestHidden(quest),
    isChild: Boolean(parent),
    isSequence,
    isSubquest: Boolean(parent) && !isSequence,
    // Posicao desta etapa entre as irmas que QUEM LE consegue ver; null fora de etapa.
    stagePosition: stageIndex >= 0 ? stageIndex + 1 : null,
    stageTotal: stageIndex >= 0 && isGM ? siblings.length : null,
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
    flow,
    sequences,
    currentSequence,
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

/**
 * 1.3.0 — as etapas de uma quest, na ordem do arco.
 *
 * Fonte: o `parent` de cada filho, e nao o `subquests[]` do pai. E a MESMA fonte que decide
 * recolher a etapa no log (`isNestedStage`); usar fontes diferentes nas duas pontas abriria
 * a porta para etapa recolhida que nao aparece em lugar nenhum.
 *
 * Ordem: `order` crescente; empate (inclusive o 0 de quem nao escreveu `order`) pela
 * posicao em `subquests[]` do pai, que ja e dado gravado; e so entao pelo nome.
 *
 * @param {object} quest A quest pai.
 * @param {object[]} quests As quests entre as quais procurar (ja filtradas por quem le).
 * @returns {object[]} As etapas, em ordem.
 */
const FLOW_WEIGHT_LABEL = Object.freeze({ axis: "Axis", expected: "Expected", open: "Open" });

export function stagesOf(quest, quests) {
  if (!quest?.id) return [];
  const linkOrder = toArray(quest.subquests);
  const position = (id) => {
    const at = linkOrder.indexOf(id);
    return at < 0 ? Number.MAX_SAFE_INTEGER : at;
  };

  return toArray(quests)
    .filter((candidate) => candidate?.type === QUEST_TYPE.sequence && candidate.parent === quest.id)
    .sort((a, b) =>
      (a.order ?? 0) - (b.order ?? 0)
      || position(a.id) - position(b.id)
      || String(a.name).localeCompare(String(b.name), "pt-BR"));
}

/**
 * A etapa entra dentro da linha do pai (e nao como linha propria) quando o pai ocupa uma
 * linha visivel desta lista. Um nivel so: etapa de etapa volta a ser linha comum, em vez
 * de sumir dentro de uma linha que ja esta recolhida.
 */
function isNestedStage(quest, { index, visibleIds }) {
  if (quest?.type !== QUEST_TYPE.sequence || !quest.parent) return false;
  if (!visibleIds.has(quest.parent)) return false;
  const parent = index.get(quest.parent);
  if (!parent) return false;
  const parentIsNested = parent.type === QUEST_TYPE.sequence
    && Boolean(parent.parent)
    && visibleIds.has(parent.parent)
    && index.has(parent.parent);
  return !parentIsNested;
}

function buildStageRow(stage, { isGM = false, countHidden = true, position = null } = {}) {
  const objectives = countObjectives(stage, { countHidden });
  return {
    id: stage.id,
    name: stage.name,
    order: stage.order ?? 0,
    position,
    status: stage.status,
    statusLabel: QUEST_STATUS_LABEL[stage.status] ?? stage.status,
    isHidden: isQuestHidden(stage),
    objectiveBadge: `${objectives.done}/${objectives.total}`,
    statusActions: isGM ? statusActionsFor(stage.status) : []
  };
}

/**
 * A etapa corrente: a primeira EM ANDAMENTO; na falta, a primeira DISPONIVEL. Nenhuma das
 * duas, nenhuma corrente — o modulo nao adivinha, e nunca muda status por conta propria.
 */
function currentStage(stages) {
  const list = toArray(stages);
  const current = list.find((stage) => stage.status === QUEST_STATUS.active)
    ?? list.find((stage) => stage.status === QUEST_STATUS.available)
    ?? null;
  return current ? { id: current.id, name: current.name, position: current.position } : null;
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
