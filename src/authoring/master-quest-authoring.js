import {
  MASTER_QUEST_SYSTEM_AGNOSTIC,
  SWADE_SYSTEM_ID,
  SWADE_SYSTEM_VERSION
} from "../constants.js";

const DEFAULT_TITLE = "Untitled MasterQuest";

const OBJECTIVE_KINDS = new Set(["main", "optional", "hidden", "milestone"]);
const VISIBILITY = new Set(["gm", "player", "secret", "public"]);
const SCENE_CHALLENGE_TYPES = new Set([
  "exploration",
  "social",
  "combat",
  "chase",
  "dramatic-task",
  "hazard",
  "mixed",
  "unknown"
]);
const THREAT_KINDS = new Set(["npc", "faction", "creature", "environment", "hazard", "clock", "custom"]);
const REWARD_KINDS = new Set(["information", "item", "ally", "advance", "resource", "access", "custom"]);
const CONTINUITY_MODES = new Set(["opening", "mid-campaign", "closeout", "bridge", "standalone"]);
const SUGGESTION_TARGETS = new Set([
  "complete",
  "objectives",
  "threats",
  "scenes",
  "clues",
  "rewards",
  "gmSecrets",
  "locations",
  "factions",
  "clocks",
  "riskNotes"
]);
const DERIVED_AUTHORING_FIELDS = [
  "objectives",
  "threats",
  "scenes",
  "clues",
  "rewards",
  "gmSecrets",
  "locations",
  "factions",
  "clocks",
  "riskNotes"
];

export function createMasterQuestDraft(seedInput = {}, options = {}) {
  const seed = normalizeSeed(seedInput);
  const title = cleanText(seed.title ?? seed.name) || DEFAULT_TITLE;
  const id = resolveDraftId(seed, title, options);
  const continuityMode = pick(CONTINUITY_MODES, seed.continuityMode, "standalone");
  const partyAnchors = normalizeStoryAnchors(seed.partyAnchors, "pc");
  const systemProfile = normalizeSystemProfile(
    seed.systemProfile ?? options.systemProfile ?? seed.systemId ?? seed.system
  );

  const draft = {
    schemaVersion: 1,
    id,
    title,
    scope: "quest",
    status: "draft",
    system: MASTER_QUEST_SYSTEM_AGNOSTIC,
    systemProfile,
    source: "native",
    premise: cleanText(seed.premise),
    dramaticQuestion: cleanText(seed.dramaticQuestion),
    gmSummary: cleanText(seed.gmSummary ?? seed.summary ?? seed.premise),
    playerSafeSummary: cleanText(seed.playerSafeSummary),
    continuityMode,
    contextProfile: normalizeContextProfile(seed.contextProfile, {
      adventureId: id,
      continuityMode,
      partyAnchors,
      looseThreads: seed.looseThreads
    }),
    partyAnchors,
    storyAnchors: normalizeStoryAnchors(seed.storyAnchors, "custom"),
    objectives: normalizeObjectives(seed.objectives ?? seed.goals),
    scenes: normalizeScenes(seed.scenes),
    threats: normalizeThreats(seed.threats ?? seed.enemies ?? seed.opposition),
    factions: normalizeLabelRecords(seed.factions, "faction"),
    locations: normalizeLabelRecords(seed.locations, "location"),
    clues: normalizeClues(seed.clues),
    rewards: normalizeRewards(seed.rewards),
    clocks: normalizeClocks(seed.clocks),
    gmSecrets: normalizeSecretRecords(seed.gmSecrets ?? seed.secrets),
    playerVisibleElements: normalizeLabelRecords(seed.playerVisibleElements, "visible"),
    challengeSuggestions: [],
    spotlightSuggestions: [],
    riskNotes: [],
    foundryMapping: normalizeFoundryMapping(seed.foundryMapping)
  };

  draft.challengeSuggestions = normalizeSuggestions(
    seed.challengeSuggestions,
    deriveChallengeSuggestions(draft)
  );
  draft.spotlightSuggestions = normalizeSuggestions(
    seed.spotlightSuggestions,
    deriveSpotlightSuggestions(draft)
  );
  draft.riskNotes = normalizeSuggestions(seed.riskNotes, deriveRiskNotes(draft));
  if (draft.systemProfile) {
    draft.systemProfile.suggestions = mergeSuggestions(
      draft.systemProfile.suggestions,
      deriveSystemProfileSuggestions(draft)
    );
  }

  return draft;
}

// Flatten a normalized draft back into the editable string-list seed shape used
// by the Authoring Console. Lets the Adventure Review send the GM "back to draft"
// without losing the structured content.
export function masterQuestDraftToSeed(draftInput = {}) {
  const draft = draftInput ?? {};
  const labelsOf = (list, key) =>
    toArray(list)
      .map((entry) => cleanText(entry?.[key] ?? entry?.label ?? entry?.title ?? entry?.name ?? entry))
      .filter(Boolean);

  return {
    title: cleanText(draft.title),
    premise: cleanText(draft.premise),
    dramaticQuestion: cleanText(draft.dramaticQuestion),
    playerSafeSummary: cleanText(draft.playerSafeSummary),
    objectives: labelsOf(draft.objectives, "title"),
    threats: labelsOf(draft.threats, "label"),
    scenes: labelsOf(draft.scenes, "title"),
    clues: labelsOf(draft.clues, "label"),
    rewards: labelsOf(draft.rewards, "title"),
    gmSecrets: labelsOf(draft.gmSecrets, "label"),
    locations: labelsOf(draft.locations, "label"),
    factions: labelsOf(draft.factions, "label"),
    clocks: labelsOf(draft.clocks, "label"),
    riskNotes: toTextArray(draft.riskNotes),
    partyAnchors: labelsOf(draft.partyAnchors, "label"),
    storyAnchors: labelsOf(draft.storyAnchors, "label")
  };
}

// Merge per-field suggestion lists into a seed, de-duplicating case-insensitively.
export function applySeedSuggestions(seedInput = {}, fieldSuggestions = {}) {
  const seed = { ...seedInput };

  for (const [field, suggestions] of Object.entries(fieldSuggestions ?? {})) {
    const merged = [];
    const seen = new Set();

    for (const entry of [...toArray(seed[field]), ...toArray(suggestions)]) {
      const value = cleanText(entry);
      const key = value.toLowerCase();
      if (!value || seen.has(key)) continue;
      seen.add(key);
      merged.push(value);
    }

    seed[field] = merged;
  }

  return seed;
}

export function assessMasterQuestDraft(draftInput = {}, options = {}) {
  const draft = isMasterQuestDraft(draftInput) ? draftInput : createMasterQuestDraft(draftInput, options);
  const missing = [];
  const warnings = [];

  if (!draft.title || draft.title === DEFAULT_TITLE) {
    missing.push(makeIssue(
      "missing-title",
      "warning",
      "title",
      "Give the quest a working title before GM review.",
      "title"
    ));
  }

  if (!draft.premise) {
    missing.push(makeIssue(
      "missing-premise",
      "error",
      "premise",
      "The draft needs a premise: what is happening and why it matters.",
      "premise"
    ));
  }

  if (!draft.dramaticQuestion) {
    missing.push(makeIssue(
      "missing-dramatic-question",
      "error",
      "dramaticQuestion",
      "The draft needs a dramatic question that frames the uncertainty of play.",
      "dramaticQuestion"
    ));
  }

  if (!draft.objectives.length) {
    missing.push(makeIssue(
      "missing-objectives",
      "error",
      "objectives",
      "The draft needs at least one objective the GM can track.",
      "objectives"
    ));
  }

  if (!draft.threats.length) {
    missing.push(makeIssue(
      "missing-opposition",
      "error",
      "threats",
      "The draft needs opposition, pressure, or a threat.",
      "threats"
    ));
  }

  if (!hasConsequence(draft)) {
    missing.push(makeIssue(
      "missing-consequence",
      "error",
      "rewards",
      "The draft needs consequences: rewards, failure states, clocks, or risk notes.",
      "consequences"
    ));
  }

  if (!draft.playerSafeSummary) {
    warnings.push(makeIssue(
      "missing-player-safe-summary",
      "warning",
      "playerSafeSummary",
      "Write a player-safe summary before sharing any preview with players.",
      "playerSafeSummary"
    ));
  }

  if (!draft.scenes.length) {
    warnings.push(makeIssue(
      "missing-scenes",
      "warning",
      "scenes",
      "The draft has no scenes yet. That is acceptable early, but it limits play prep.",
      "scenes"
    ));
  }

  return {
    schemaVersion: 1,
    draftId: draft.id,
    title: draft.title,
    readyForPreview: missing.every((issue) => issue.severity !== "error"),
    readyForFoundryExport: false,
    missing,
    warnings,
    counts: {
      objectives: draft.objectives.length,
      scenes: draft.scenes.length,
      threats: draft.threats.length,
      factions: draft.factions.length,
      locations: draft.locations.length,
      clues: draft.clues.length,
      rewards: draft.rewards.length,
      clocks: draft.clocks.length,
      gmSecrets: draft.gmSecrets.length,
      partyAnchors: draft.partyAnchors.length,
      storyAnchors: draft.storyAnchors.length
    },
    safety: [
      "Authoring v0.1 is local-only.",
      "No Foundry data was changed.",
      "No legacy FQL data was read or written.",
      "Foundry mapping is a future export plan only."
    ]
  };
}

export function generateMasterQuestAuthoringQuestions(seedOrDraft = {}, options = {}) {
  const draft = isMasterQuestDraft(seedOrDraft)
    ? seedOrDraft
    : createMasterQuestDraft(seedOrDraft, options);
  const assessment = assessMasterQuestDraft(draft);
  const questions = [];

  for (const issue of [...assessment.missing, ...assessment.warnings]) {
    const question = questionForIssue(issue);
    if (question) {
      questions.push(question);
    }
  }

  return {
    schemaVersion: 1,
    draftId: draft.id,
    title: draft.title,
    questionCount: questions.length,
    questions,
    assessment
  };
}

export function generateMasterQuestPreview(draftInput = {}, options = {}) {
  const { audience = "gm" } = options;
  const draft = isMasterQuestDraft(draftInput) ? draftInput : createMasterQuestDraft(draftInput, options);
  const normalizedAudience = audience === "player" || audience === "player-safe"
    ? "player-safe"
    : "gm";
  const sections = normalizedAudience === "player-safe"
    ? buildPlayerSafeSections(draft)
    : buildGmSections(draft);
  const markdown = renderMarkdown(draft.title, sections);

  return {
    schemaVersion: 1,
    draftId: draft.id,
    title: draft.title,
    audience: normalizedAudience,
    sections,
    markdown,
    safety: normalizedAudience === "player-safe"
      ? [
          "GM secrets are omitted.",
          "GM-only threats are omitted.",
          "Hidden objectives and GM notes are omitted."
        ]
      : [
          "GM preview may include secrets and operational notes.",
          "No Foundry data was changed.",
          "No legacy FQL data was read or written."
        ]
  };
}

export function suggestMasterQuestElements(seedOrDraft = {}, options = {}) {
  const draft = isMasterQuestDraft(seedOrDraft)
    ? seedOrDraft
    : createMasterQuestDraft(seedOrDraft, options);
  const target = pick(SUGGESTION_TARGETS, options.target, "complete");
  const fields = target === "complete" ? DERIVED_AUTHORING_FIELDS : [target];
  const fieldSuggestions = {};

  for (const field of fields) {
    fieldSuggestions[field] = suggestFieldValues(draft, field);
  }

  return {
    schemaVersion: 1,
    draftId: draft.id,
    title: draft.title,
    target,
    mode: "local-authoring-assistant",
    fieldSuggestions,
    counts: Object.fromEntries(
      Object.entries(fieldSuggestions).map(([field, values]) => [field, values.length])
    ),
    safety: [
      "Suggestions are local draft text only.",
      "No Foundry document was created or updated.",
      "No JournalEntry, setFlag, FQL API, or write adapter was called.",
      "The GM remains the final editor of all suggested material."
    ]
  };
}

function normalizeSeed(seedInput) {
  if (typeof seedInput === "string") {
    return { premise: cleanText(seedInput) };
  }

  if (isPlainObject(seedInput)) {
    return seedInput;
  }

  return {};
}

function suggestFieldValues(draft, field) {
  switch (field) {
    case "objectives":
      return suggestObjectives(draft);
    case "threats":
      return suggestThreats(draft);
    case "scenes":
      return suggestScenes(draft);
    case "clues":
      return suggestClues(draft);
    case "rewards":
      return suggestRewards(draft);
    case "gmSecrets":
      return suggestGmSecrets(draft);
    case "locations":
      return suggestLocations(draft);
    case "factions":
      return suggestFactions(draft);
    case "clocks":
      return suggestClocks(draft);
    case "riskNotes":
      return suggestRiskNotes(draft);
    default:
      return [];
  }
}

function suggestObjectives(draft) {
  const kernel = designKernel(draft);
  const question = cleanText(draft.dramaticQuestion);

  return [
    `Estabelecer o que realmente esta acontecendo: ${kernel}.`,
    question
      ? `Responder na pratica a pergunta dramatica: ${question}`
      : "Descobrir qual escolha central define o resultado da quest.",
    "Tomar uma decisao que mude a situacao antes que a pressao escale."
  ];
}

function suggestThreats(draft) {
  const kernel = designKernel(draft);

  return [
    `Uma forca rival quer controlar, explorar ou apagar a verdade por tras de: ${kernel}.`,
    "Um obstaculo ambiental, social ou sobrenatural transforma investigacao em escolha dificil.",
    "Um agente secundario oferece uma solucao util, mas cobra um custo moral, politico ou material."
  ];
}

function suggestScenes(draft) {
  const kernel = designKernel(draft);

  return [
    `Gatilho inicial: um sinal, pedido ou desastre revela que ${kernel}.`,
    "Investigacao ativa: os personagens precisam escolher entre dois caminhos incompletos.",
    "Pressao em cena: a oposicao age enquanto uma pista importante esta em risco.",
    "Confronto de decisao: vencer nao basta; a mesa precisa escolher o que salvar, revelar ou sacrificar.",
    "Desfecho: mostrar uma consequencia imediata e deixar um gancho para continuidade."
  ];
}

function suggestClues(draft) {
  const kernel = designKernel(draft);
  const firstSecret = firstLabel(draft.gmSecrets, "o segredo central");
  const firstThreat = firstLabel(draft.threats, "a oposicao");

  return [
    `Rastro material: algo fisico prova que ${kernel} ja deixou marcas no mundo.`,
    `Testemunho contraditorio: alguem viu ${firstThreat}, mas entendeu a cena de forma incompleta.`,
    `Falha no padrao: um detalhe tecnico, magico ou social aponta para ${firstSecret}.`,
    "Registro parcial: mapa, diario, log, rumor ou transmissao que revela uma causa, mas esconde a consequencia.",
    "Pista falsa util: uma interpretacao errada leva a perigo, mas ainda aproxima a mesa da verdade."
  ];
}

function suggestRewards(draft) {
  return [
    "Informacao acionavel que muda o mapa da aventura ou revela uma nova escolha.",
    "Acesso a um local, aliado, rota, recurso ou autoridade antes bloqueado.",
    "Recurso de mesa: equipamento, favor, vantagem narrativa ou permissao para resolver uma cena futura.",
    "Reputacao, divida ou consequencia politica que torna a decisao visivel no mundo."
  ];
}

function suggestGmSecrets(draft) {
  const kernel = designKernel(draft);
  const firstThreat = firstLabel(draft.threats, "a oposicao");

  return [
    `A causa real de ${kernel} e diferente da explicacao publica.`,
    `${firstThreat} nao e apenas obstaculo; tambem protege, teme ou depende de algo oculto.`,
    "Existe uma terceira parte se beneficiando do conflito enquanto todos olham para o antagonista mais obvio."
  ];
}

function suggestLocations(draft) {
  return [
    "Local de entrada: onde o problema aparece pela primeira vez para os personagens.",
    "Local de investigacao: onde pistas, testemunhas ou registros podem ser conectados.",
    "Local de pressao: onde a oposicao consegue agir com vantagem.",
    "Local de decisao: onde a quest muda de estado conforme a escolha da mesa."
  ];
}

function suggestFactions(draft) {
  return [
    "Autoridade local que quer controle, silencio ou uma solucao rapida.",
    "Grupo interessado que enxerga lucro, fe, vinganca, pesquisa ou libertacao no conflito.",
    "Aliado instavel que pode ajudar os personagens, mas tem prioridade propria.",
    "Forca oculta ou distante que transforma o caso local em sinal de algo maior."
  ];
}

function suggestClocks(draft) {
  return [
    "Pressao da quest (0/6): a situacao piora quando os personagens hesitam, falham ou ignoram sinais claros.",
    "Exposicao dos personagens (0/4): a oposicao entende quem eles sao e passa a agir contra eles.",
    "Custo colateral (0/6): inocentes, recursos, aliados ou rotas sofrem enquanto a quest avanca."
  ];
}

function suggestRiskNotes(draft) {
  return [
    "Nao dependa de uma unica pista critica; cada revelacao importante deve ter mais de um caminho.",
    "Diferencie segredo de informacao essencial: o segredo pode esperar, mas a mesa precisa de direcao jogavel.",
    "Transforme falha em custo, pressao ou desvio, nao em bloqueio total da aventura.",
    "Reserve uma escolha real para os jogadores; nao reduza a quest a descobrir a resposta correta."
  ];
}

function designKernel(draft) {
  const source = cleanText(draft.premise)
    || cleanText(draft.gmSummary)
    || cleanText(draft.playerSafeSummary)
    || cleanText(draft.dramaticQuestion)
    || cleanText(draft.title)
    || "a situacao central da quest";

  return summarizeText(source, 150);
}

function summarizeText(value, maxLength) {
  const text = cleanText(value).replace(/\s+/g, " ");
  if (text.length <= maxLength) {
    return stripTrailingPunctuation(text);
  }

  const sliced = text.slice(0, maxLength);
  const lastSpace = sliced.lastIndexOf(" ");
  return `${stripTrailingPunctuation(sliced.slice(0, lastSpace > 60 ? lastSpace : maxLength))}...`;
}

function stripTrailingPunctuation(value) {
  return cleanText(value).replace(/[.;:!?]+$/g, "");
}

function firstLabel(entries, fallback) {
  const first = toArray(entries)[0];
  if (!first) {
    return fallback;
  }

  if (typeof first === "string") {
    return cleanText(first) || fallback;
  }

  if (isPlainObject(first)) {
    return cleanText(first.label ?? first.title ?? first.name ?? first.notes ?? first.summary) || fallback;
  }

  return fallback;
}

function normalizeSystemProfile(profileInput) {
  if (profileInput == null || profileInput === false) {
    return null;
  }

  if (typeof profileInput === "string") {
    const id = cleanText(profileInput);
    if (!id || id === MASTER_QUEST_SYSTEM_AGNOSTIC || id === "none") {
      return null;
    }

    return makeSystemProfile({ id });
  }

  if (!isPlainObject(profileInput)) {
    return null;
  }

  const id = cleanText(profileInput.id ?? profileInput.system ?? profileInput.name);
  if (!id || id === MASTER_QUEST_SYSTEM_AGNOSTIC || id === "none") {
    return null;
  }

  return makeSystemProfile(profileInput);
}

function makeSystemProfile(source) {
  const id = cleanText(source.id ?? source.system ?? source.name);
  const isSwade = id === SWADE_SYSTEM_ID;

  return {
    ...source,
    id,
    version: cleanText(source.version) || (isSwade ? SWADE_SYSTEM_VERSION : ""),
    label: cleanText(source.label ?? source.title) || (isSwade ? "SWADE" : id),
    mode: cleanText(source.mode) || "optional-profile",
    suggestions: toTextArray(source.suggestions ?? source.challengeSuggestions)
  };
}

function resolveDraftId(seed, title, options) {
  if (typeof options.idFactory === "function") {
    const id = cleanText(options.idFactory(seed));
    if (id) return id;
  }

  const explicitId = cleanText(seed.id);
  if (explicitId) return explicitId;

  const slug = slugify(title);
  return slug ? `mq-${slug}` : "mq-draft";
}

function normalizeContextProfile(profileInput, defaults) {
  const profile = isPlainObject(profileInput) ? profileInput : {};
  const continuityMode = pick(CONTINUITY_MODES, profile.continuityMode, defaults.continuityMode);

  return {
    adventureId: cleanText(profile.adventureId) || defaults.adventureId,
    continuityMode,
    previousAdventure: isPlainObject(profile.previousAdventure) ? profile.previousAdventure : null,
    looseThreads: toTextArray(profile.looseThreads ?? defaults.looseThreads),
    partyAnchors: normalizeStoryAnchors(profile.partyAnchors ?? defaults.partyAnchors, "pc"),
    antagonistAnchors: normalizeStoryAnchors(profile.antagonistAnchors, "npc"),
    itemAnchors: normalizeStoryAnchors(profile.itemAnchors, "item"),
    factionAnchors: normalizeStoryAnchors(profile.factionAnchors, "faction"),
    locationAnchors: normalizeStoryAnchors(profile.locationAnchors, "location")
  };
}

function normalizeObjectives(value) {
  return toArray(value).map((entry, index) => {
    const source = recordFromEntry(entry, "Objective");
    const kind = pick(OBJECTIVE_KINDS, source.kind, "main");
    const title = cleanText(source.title ?? source.label ?? source.name) || `Objective ${index + 1}`;

    return {
      id: cleanText(source.id) || makeStableId("mq-obj", title, index),
      title,
      kind,
      visibility: pick(VISIBILITY, source.visibility, kind === "hidden" ? "secret" : "player"),
      successCriteria: cleanText(source.successCriteria ?? source.criteria),
      failureConsequence: cleanText(source.failureConsequence ?? source.failure),
      linkedSceneIds: toTextArray(source.linkedSceneIds ?? source.sceneIds),
      linkedRewardIds: toTextArray(source.linkedRewardIds ?? source.rewardIds),
      notes: cleanText(source.notes)
    };
  });
}

function normalizeScenes(value) {
  return toArray(value).map((entry, index) => {
    const source = recordFromEntry(entry, "Scene");
    const title = cleanText(source.title ?? source.label ?? source.name) || `Scene ${index + 1}`;

    return {
      id: cleanText(source.id) || makeStableId("mq-scene", title, index),
      title,
      purpose: cleanText(source.purpose ?? source.summary),
      locationRef: cleanText(source.locationRef ?? source.location),
      challengeType: pick(SCENE_CHALLENGE_TYPES, source.challengeType, "unknown"),
      involvedThreatIds: toTextArray(source.involvedThreatIds ?? source.threatIds),
      objectiveIds: toTextArray(source.objectiveIds),
      clueIds: toTextArray(source.clueIds),
      gmNotes: cleanText(source.gmNotes ?? source.notes),
      playerVisible: source.playerVisible !== false && source.visibility !== "secret"
    };
  });
}

function normalizeThreats(value) {
  return toArray(value).map((entry, index) => {
    const source = recordFromEntry(entry, "Threat");
    const label = cleanText(source.label ?? source.title ?? source.name) || `Threat ${index + 1}`;

    return {
      id: cleanText(source.id) || makeStableId("mq-threat", label, index),
      label,
      kind: pick(THREAT_KINDS, source.kind ?? source.type, "custom"),
      role: cleanText(source.role),
      agenda: cleanText(source.agenda),
      methods: toTextArray(source.methods),
      visibility: pick(VISIBILITY, source.visibility, "gm"),
      systemRole: cleanText(source.systemRole ?? source.swadeRole),
      swadeRole: cleanText(source.swadeRole),
      notes: cleanText(source.notes)
    };
  });
}

function normalizeRewards(value) {
  return toArray(value).map((entry, index) => {
    const source = recordFromEntry(entry, "Reward");
    const title = cleanText(source.title ?? source.label ?? source.name) || `Reward ${index + 1}`;

    return {
      id: cleanText(source.id) || makeStableId("mq-reward", title, index),
      title,
      kind: pick(REWARD_KINDS, source.kind ?? source.type, "custom"),
      visibility: pick(VISIBILITY, source.visibility, "player"),
      unlockCondition: cleanText(source.unlockCondition ?? source.condition),
      notes: cleanText(source.notes)
    };
  });
}

function normalizeClues(value) {
  return toArray(value).map((entry, index) => {
    const source = recordFromEntry(entry, "Clue");
    const label = cleanText(source.label ?? source.title ?? source.name) || `Clue ${index + 1}`;

    return {
      id: cleanText(source.id) || makeStableId("mq-clue", label, index),
      label,
      summary: cleanText(source.summary ?? source.notes),
      reveals: toTextArray(source.reveals),
      visibility: pick(VISIBILITY, source.visibility, "gm"),
      linkedSceneIds: toTextArray(source.linkedSceneIds ?? source.sceneIds),
      notes: cleanText(source.notes)
    };
  });
}

function normalizeClocks(value) {
  return toArray(value).map((entry, index) => {
    const source = recordFromEntry(entry, "Clock");
    const label = cleanText(source.label ?? source.title ?? source.name) || `Clock ${index + 1}`;
    const max = Number.isFinite(Number(source.max)) ? Number(source.max) : 6;
    const current = Number.isFinite(Number(source.current)) ? Number(source.current) : 0;

    return {
      id: cleanText(source.id) || makeStableId("mq-clock", label, index),
      label,
      current,
      max,
      consequence: cleanText(source.consequence),
      visibility: pick(VISIBILITY, source.visibility, "gm"),
      notes: cleanText(source.notes)
    };
  });
}

function normalizeLabelRecords(value, prefix) {
  return toArray(value).map((entry, index) => {
    const source = recordFromEntry(entry, prefix);
    const label = cleanText(source.label ?? source.title ?? source.name) || `${capitalize(prefix)} ${index + 1}`;

    return {
      id: cleanText(source.id) || makeStableId(`mq-${prefix}`, label, index),
      label,
      role: cleanText(source.role),
      visibility: pick(VISIBILITY, source.visibility, "player"),
      notes: cleanText(source.notes ?? source.summary)
    };
  });
}

function normalizeSecretRecords(value) {
  return toArray(value).map((entry, index) => {
    const source = recordFromEntry(entry, "Secret");
    const label = cleanText(source.label ?? source.title ?? source.name) || `Secret ${index + 1}`;

    return {
      id: cleanText(source.id) || makeStableId("mq-secret", label, index),
      label,
      notes: cleanText(source.notes ?? source.summary)
    };
  });
}

function normalizeStoryAnchors(value, defaultKind) {
  return toArray(value).map((entry, index) => {
    const source = recordFromEntry(entry, "Anchor");
    const label = cleanText(source.label ?? source.title ?? source.name) || `Anchor ${index + 1}`;

    return {
      kind: cleanText(source.kind) || defaultKind,
      label,
      uuid: cleanText(source.uuid) || null,
      role: cleanText(source.role) || null,
      importance: cleanText(source.importance) || "supporting",
      notes: cleanText(source.notes),
      mechanicalRelevance: toTextArray(source.mechanicalRelevance),
      storyRelevance: toTextArray(source.storyRelevance)
    };
  });
}

function normalizeFoundryMapping(mappingInput) {
  const mapping = isPlainObject(mappingInput) ? mappingInput : {};

  return {
    schemaVersion: 1,
    writeMode: "none",
    target: "future-export",
    journalStrategy: cleanText(mapping.journalStrategy) || "planned",
    questOpsStrategy: cleanText(mapping.questOpsStrategy) || "planned",
    fqlStrategy: "none",
    plannedDocuments: isPlainObject(mapping.plannedDocuments)
      ? mapping.plannedDocuments
      : {
          journalEntry: null,
          folders: [],
          pages: [],
          questOps: []
        },
    notes: cleanText(mapping.notes),
    safety: [
      "No Foundry document is created by MasterQuest authoring v0.1.",
      "No JournalEntry is updated by MasterQuest authoring v0.1.",
      "No legacy FQL flags are read or written by MasterQuest authoring."
    ]
  };
}

function normalizeSuggestions(value, fallback) {
  const suggestions = toTextArray(value);
  return suggestions.length ? suggestions : fallback;
}

function mergeSuggestions(value, fallback) {
  const seen = new Set();
  const merged = [];

  for (const suggestion of [...toTextArray(value), ...toTextArray(fallback)]) {
    if (!seen.has(suggestion)) {
      seen.add(suggestion);
      merged.push(suggestion);
    }
  }

  return merged;
}

function deriveChallengeSuggestions(draft) {
  const suggestions = [];
  const sceneTypes = [...new Set(draft.scenes.map((scene) => scene.challengeType).filter((type) => type !== "unknown"))];

  if (sceneTypes.length) {
    suggestions.push(`Use lightweight scene pressure procedures for: ${sceneTypes.join(", ")}.`);
  }

  if (draft.threats.length) {
    suggestions.push("Choose per scene whether opposition is best handled as a conflict, obstacle, clock, negotiation, pursuit, hazard, or direct fight.");
  }

  return suggestions;
}

function deriveSystemProfileSuggestions(draft) {
  if (draft.systemProfile?.id !== SWADE_SYSTEM_ID) {
    return [];
  }

  const suggestions = [
    "SWADE profile: use Quick Encounters, Dramatic Tasks, Chases, Social Conflict, Hazards, or combat only when they serve the scene."
  ];
  const sceneTypes = [...new Set(draft.scenes.map((scene) => scene.challengeType).filter((type) => type !== "unknown"))];

  if (sceneTypes.length) {
    suggestions.push(`SWADE profile: map current challenge tags to table procedures: ${sceneTypes.join(", ")}.`);
  }

  if (draft.threats.some((threat) => threat.swadeRole || threat.systemRole)) {
    suggestions.push("SWADE profile: confirm threat roles at the table before turning them into actors or combatants.");
  }

  return suggestions;
}

function deriveSpotlightSuggestions(draft) {
  if (draft.partyAnchors.length) {
    return draft.partyAnchors.map((anchor) =>
      `Give ${anchor.label} one meaningful choice, cost, or reveal tied to this quest.`
    );
  }

  return draft.objectives.length
    ? ["Reserve at least one spotlight beat for a PC decision, not only for plot delivery."]
    : [];
}

function deriveRiskNotes(draft) {
  const notes = [];

  if (draft.clocks.length) {
    notes.push("Use clocks as visible pressure, not as automatic failure rails.");
  }

  if (draft.threats.length && !draft.scenes.length) {
    notes.push("Threats exist, but their first appearance in play is not staged yet.");
  }

  return notes;
}

function hasConsequence(draft) {
  return draft.rewards.length > 0
    || draft.clocks.length > 0
    || draft.riskNotes.length > 0
    || draft.objectives.some((objective) => objective.failureConsequence);
}

function questionForIssue(issue) {
  const templates = {
    "missing-title": {
      prompt: "What working title identifies this quest for the GM?",
      whyItMatters: "The title anchors the conversation, the preview and the eventual mapping into Foundry."
    },
    "missing-premise": {
      prompt: "What is the premise in one or two sentences: what is happening, and why does it matter now?",
      whyItMatters: "The premise keeps objectives and scenes from becoming a loose list."
    },
    "missing-dramatic-question": {
      prompt: "Which dramatic question should stay open through the quest?",
      whyItMatters: "The dramatic question sets the central uncertainty the table will resolve."
    },
    "missing-objectives": {
      prompt: "What do the characters need to find out, win, prevent or decide for the quest to move?",
      whyItMatters: "Objectives turn the idea into something the GM can actually run."
    },
    "missing-opposition": {
      prompt: "Who or what opposes the characters: enemy, faction, environment, clock or complication?",
      whyItMatters: "With no opposition or pressure, the quest does not produce play yet."
    },
    "missing-consequence": {
      prompt: "What changes if the characters succeed, fail, or take too long?",
      whyItMatters: "Consequences give weight to choices and set up rewards, costs and clocks."
    },
    "missing-player-safe-summary": {
      prompt: "What summary can be shown to the players without giving away secrets?",
      whyItMatters: "This separates what guides the table from what belongs to the GM alone."
    },
    "missing-scenes": {
      prompt: "Which first scene or situation puts the quest in motion at the table?",
      whyItMatters: "An opening scene reduces the friction between prep and play."
    }
  };

  const template = templates[issue.code];
  if (!template) return null;

  return {
    id: `q-${issue.code}`,
    code: issue.code,
    path: issue.path,
    prompt: template.prompt,
    whyItMatters: template.whyItMatters,
    suggestedField: issue.questionId ?? issue.path
  };
}

function buildGmSections(draft) {
  return [
    textSection("Premise", draft.premise),
    textSection("Dramatic Question", draft.dramaticQuestion),
    textSection("GM Summary", draft.gmSummary),
    textSection("Player-Safe Summary", draft.playerSafeSummary),
    listSection("Objectives", draft.objectives, formatObjective),
    listSection("Scenes", draft.scenes, formatSceneForGm),
    listSection("Threats", draft.threats, (threat) => formatThreat(threat, draft.systemProfile)),
    listSection("Factions", draft.factions, formatLabelRecord),
    listSection("Locations", draft.locations, formatLabelRecord),
    listSection("Clues", draft.clues, formatClue),
    listSection("Rewards", draft.rewards, formatReward),
    listSection("Clocks", draft.clocks, formatClock),
    listSection("GM Secrets", draft.gmSecrets, formatSecret),
    textSection("System Profile", formatSystemProfile(draft.systemProfile)),
    listSection("Challenge Suggestions", draft.challengeSuggestions),
    listSection(
      draft.systemProfile ? `${draft.systemProfile.label} Profile Suggestions` : "System Profile Suggestions",
      draft.systemProfile?.suggestions ?? []
    ),
    listSection("Spotlight Suggestions", draft.spotlightSuggestions),
    listSection("Risk Notes", draft.riskNotes),
    textSection("Foundry Mapping", "Future export plan only. writeMode=none; legacyFqlStrategy=none.")
  ].filter((section) => section.items.length > 0);
}

function buildPlayerSafeSections(draft) {
  const visibleObjectives = draft.objectives.filter(isPlayerVisibleObjective);
  const visibleRewards = draft.rewards.filter(isPlayerVisible);
  const visibleLocations = draft.locations.filter(isPlayerVisible);
  const visibleClues = draft.clues.filter(isPlayerVisible);
  const visibleElements = draft.playerVisibleElements;

  return [
    textSection("Summary", draft.playerSafeSummary || "A player-safe summary has not been written yet."),
    listSection("Visible Objectives", visibleObjectives, formatObjectiveForPlayer),
    listSection("Known Places", visibleLocations, formatLabelRecord),
    listSection("Known Leads", visibleClues, formatClueForPlayer),
    listSection("Possible Rewards", visibleRewards, formatRewardForPlayer),
    listSection("Visible Elements", visibleElements, formatLabelRecord)
  ].filter((section) => section.items.length > 0);
}

function textSection(heading, body) {
  const text = cleanText(body);
  return {
    heading,
    items: text ? [text] : []
  };
}

function listSection(heading, entries, formatter = (entry) => cleanText(entry)) {
  const items = toArray(entries).map(formatter).map(cleanText).filter(Boolean);
  return {
    heading,
    items
  };
}

function renderMarkdown(title, sections) {
  const lines = [`# ${title}`];

  for (const section of sections) {
    lines.push("", `## ${section.heading}`);
    if (section.items.length === 1 && !section.items[0].includes("\n")) {
      lines.push(section.items[0]);
    } else {
      for (const item of section.items) {
        lines.push(`- ${item}`);
      }
    }
  }

  return lines.join("\n");
}

function formatObjective(objective) {
  const details = [
    objective.kind,
    objective.visibility,
    objective.successCriteria && `success: ${objective.successCriteria}`,
    objective.failureConsequence && `failure: ${objective.failureConsequence}`
  ].filter(Boolean).join("; ");
  return `${objective.title}${details ? ` (${details})` : ""}`;
}

function formatObjectiveForPlayer(objective) {
  return objective.successCriteria
    ? `${objective.title} - ${objective.successCriteria}`
    : objective.title;
}

function formatSceneForGm(scene) {
  const details = [
    scene.purpose,
    scene.locationRef && `at ${scene.locationRef}`,
    scene.challengeType !== "unknown" && `challenge: ${scene.challengeType}`,
    scene.gmNotes && `GM: ${scene.gmNotes}`
  ].filter(Boolean).join("; ");
  return `${scene.title}${details ? ` - ${details}` : ""}`;
}

function formatThreat(threat, systemProfile = null) {
  const details = [
    threat.kind,
    threat.role,
    threat.agenda && `agenda: ${threat.agenda}`,
    threat.visibility,
    formatThreatSystemRole(threat, systemProfile)
  ].filter(Boolean).join("; ");
  return `${threat.label}${details ? ` (${details})` : ""}`;
}

function formatThreatSystemRole(threat, systemProfile) {
  if (systemProfile?.id === SWADE_SYSTEM_ID && threat.swadeRole) {
    return `SWADE: ${threat.swadeRole}`;
  }

  if (systemProfile && threat.systemRole) {
    return `system role: ${threat.systemRole}`;
  }

  return "";
}

function formatSystemProfile(profile) {
  if (!profile) {
    return "";
  }

  return [profile.label, profile.version && `version ${profile.version}`, profile.mode]
    .filter(Boolean)
    .join(" - ");
}

function formatReward(reward) {
  const details = [
    reward.kind,
    reward.visibility,
    reward.unlockCondition && `unlock: ${reward.unlockCondition}`,
    reward.notes
  ].filter(Boolean).join("; ");
  return `${reward.title}${details ? ` (${details})` : ""}`;
}

function formatRewardForPlayer(reward) {
  return reward.unlockCondition
    ? `${reward.title} - ${reward.unlockCondition}`
    : reward.title;
}

function formatClue(clue) {
  const details = [
    clue.summary,
    clue.reveals.length && `reveals: ${clue.reveals.join(", ")}`,
    clue.visibility
  ].filter(Boolean).join("; ");
  return `${clue.label}${details ? ` (${details})` : ""}`;
}

function formatClueForPlayer(clue) {
  return clue.summary ? `${clue.label} - ${clue.summary}` : clue.label;
}

function formatClock(clock) {
  const details = [
    `${clock.current}/${clock.max}`,
    clock.consequence && `consequence: ${clock.consequence}`,
    clock.visibility
  ].filter(Boolean).join("; ");
  return `${clock.label} (${details})`;
}

function formatSecret(secret) {
  return secret.notes ? `${secret.label} - ${secret.notes}` : secret.label;
}

function formatLabelRecord(record) {
  const details = [record.role, record.notes].filter(Boolean).join("; ");
  return `${record.label}${details ? ` - ${details}` : ""}`;
}

function isPlayerVisibleObjective(objective) {
  return isPlayerVisible(objective) && objective.kind !== "hidden";
}

function isPlayerVisible(entry) {
  return entry.visibility === "player" || entry.visibility === "public";
}

function recordFromEntry(entry, fallbackLabel) {
  if (typeof entry === "string") {
    return { label: entry };
  }

  if (isPlainObject(entry)) {
    return entry;
  }

  return { label: fallbackLabel };
}

function makeIssue(code, severity, path, message, questionId = path) {
  const suggestionTarget = suggestionTargetForIssue(code);

  return {
    code,
    severity,
    path,
    message,
    questionId,
    assistable: Boolean(suggestionTarget),
    suggestionTarget
  };
}

function suggestionTargetForIssue(code) {
  const targets = {
    "missing-objectives": "objectives",
    "missing-opposition": "threats",
    "missing-consequence": "complete",
    "missing-scenes": "scenes",
    "missing-player-safe-summary": "complete"
  };

  return targets[code] ?? null;
}

function pick(allowed, value, fallback) {
  const text = cleanText(value);
  return allowed.has(text) ? text : fallback;
}

function cleanText(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function toTextArray(value) {
  return toArray(value).map(cleanText).filter(Boolean);
}

function toArray(value) {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function makeStableId(prefix, label, index) {
  const slug = slugify(label) || String(index + 1);
  return `${prefix}-${slug}`;
}

function slugify(value) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function capitalize(value) {
  const text = cleanText(value);
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}

function isMasterQuestDraft(value) {
  return isPlainObject(value)
    && value.scope === "quest"
    && value.source === "native"
    && Array.isArray(value.objectives)
    && Array.isArray(value.threats);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

