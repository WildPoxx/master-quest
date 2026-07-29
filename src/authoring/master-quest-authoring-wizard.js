import {
  assessMasterQuestDraft,
  createMasterQuestDraft,
  generateMasterQuestAuthoringQuestions,
  generateMasterQuestPreview
} from "./master-quest-authoring.js";
import { generateMasterQuestFoundryExportPreview } from "./master-quest-export-preview.js";

const QUESTION_FIELD_MAP = new Map([
  ["q-missing-title", "title"],
  ["missing-title", "title"],
  ["title", "title"],
  ["q-missing-premise", "premise"],
  ["missing-premise", "premise"],
  ["premise", "premise"],
  ["q-missing-dramatic-question", "dramaticQuestion"],
  ["missing-dramatic-question", "dramaticQuestion"],
  ["dramaticQuestion", "dramaticQuestion"],
  ["q-missing-objectives", "objectives"],
  ["missing-objectives", "objectives"],
  ["objectives", "objectives"],
  ["q-missing-opposition", "threats"],
  ["missing-opposition", "threats"],
  ["threats", "threats"],
  ["opposition", "threats"],
  ["enemies", "threats"],
  ["q-missing-consequence", "consequences"],
  ["missing-consequence", "consequences"],
  ["consequences", "consequences"],
  ["rewards", "rewards"],
  ["riskNotes", "riskNotes"],
  ["clocks", "clocks"],
  ["q-missing-player-safe-summary", "playerSafeSummary"],
  ["missing-player-safe-summary", "playerSafeSummary"],
  ["playerSafeSummary", "playerSafeSummary"],
  ["q-missing-scenes", "scenes"],
  ["missing-scenes", "scenes"],
  ["scenes", "scenes"],
  ["clues", "clues"],
  ["gmSecrets", "gmSecrets"],
  ["partyAnchors", "partyAnchors"],
  ["storyAnchors", "storyAnchors"],
  ["factions", "factions"],
  ["locations", "locations"]
]);
const DEFAULT_DRAFT_ID = "mq-untitled-masterquest";

export function startMasterQuestAuthoringWizard(seedOrDraft = {}, options = {}) {
  const draft = isMasterQuestDraft(seedOrDraft)
    ? seedOrDraft
    : createMasterQuestDraft(seedOrDraft, options);

  return buildWizardState(draft, {
    sessionId: cleanText(options.sessionId) || `${draft.id}-wizard`,
    revision: 1,
    appliedAnswers: []
  });
}

export function continueMasterQuestAuthoringWizard(sessionOrDraft = {}, answers = {}, options = {}) {
  const previousSession = isWizardState(sessionOrDraft) ? sessionOrDraft : null;
  const currentDraft = previousSession?.draft ?? (
    isMasterQuestDraft(sessionOrDraft) ? sessionOrDraft : createMasterQuestDraft(sessionOrDraft)
  );
  const normalizedAnswers = normalizeAnswers(answers);
  const nextSeed = applyAnswersToDraft(currentDraft, normalizedAnswers);
  const nextDraft = createMasterQuestDraft(nextSeed, options);

  return buildWizardState(nextDraft, {
    sessionId: cleanText(options.sessionId) || previousSession?.sessionId || `${nextDraft.id}-wizard`,
    revision: (previousSession?.revision ?? 0) + 1,
    appliedAnswers: normalizedAnswers
  });
}

function buildWizardState(draft, { sessionId, revision, appliedAnswers }) {
  const assessment = assessMasterQuestDraft(draft);
  const questionSet = generateMasterQuestAuthoringQuestions(draft);
  const gmPreview = generateMasterQuestPreview(draft, { audience: "gm" });
  const playerSafePreview = generateMasterQuestPreview(draft, { audience: "player-safe" });
  const exportPreview = generateMasterQuestFoundryExportPreview(draft);
  const stage = assessment.readyForPreview ? "review" : "questioning";

  return {
    schemaVersion: 1,
    mode: "local-authoring-wizard",
    sessionId,
    revision,
    stage,
    draft,
    assessment,
    questions: questionSet.questions,
    previews: {
      gm: gmPreview,
      playerSafe: playerSafePreview,
      foundryExport: exportPreview
    },
    nextActions: makeNextActions(stage, questionSet.questions, exportPreview),
    appliedAnswers,
    safety: [
      "Wizard state is local-only.",
      "No Foundry game context is read.",
      "No JournalEntry is created or updated.",
      "No setFlag call is made.",
      "No legacy FQL payload is read or written."
    ]
  };
}

function makeNextActions(stage, questions, exportPreview) {
  if (stage === "questioning") {
    return questions.map((question) => ({
      type: "answer-question",
      questionId: question.id,
      path: question.path,
      prompt: question.prompt
    }));
  }

  return [
    {
      type: "review-gm-preview",
      summary: "Review the GM preview for secrets, threats, scenes, clocks, and risk notes."
    },
    {
      type: "review-player-preview",
      summary: "Review the player-safe preview before showing anything at the table."
    },
    {
      type: "review-export-preview",
      summary: exportPreview.readyForExportPlan
        ? "Review the planned Foundry folder, Journal pages, and Quest Ops record."
        : "Resolve export blockers before any future adapter design."
    }
  ];
}

function normalizeAnswers(answers) {
  if (Array.isArray(answers)) {
    return answers.map((answer) => normalizeAnswerRecord(answer)).filter(Boolean);
  }

  if (!isPlainObject(answers)) {
    return [];
  }

  return Object.entries(answers)
    .map(([key, value]) => normalizeAnswerRecord({ id: key, value }))
    .filter(Boolean);
}

function normalizeAnswerRecord(answer) {
  if (!isPlainObject(answer)) {
    return null;
  }

  const key = cleanText(answer.id ?? answer.questionId ?? answer.path ?? answer.field);
  const field = QUESTION_FIELD_MAP.get(key) ?? QUESTION_FIELD_MAP.get(cleanText(answer.field)) ?? key;

  if (!field || !Object.hasOwn(answer, "value")) {
    return null;
  }

  return {
    id: key,
    field,
    value: answer.value
  };
}

function applyAnswersToDraft(draft, normalizedAnswers) {
  const next = cloneData(draft);

  for (const answer of normalizedAnswers) {
    applyAnswer(next, answer);
  }

  return next;
}

function applyAnswer(seed, answer) {
  switch (answer.field) {
    case "title":
    case "dramaticQuestion":
    case "playerSafeSummary":
      seed[answer.field] = cleanText(answer.value);
      if (answer.field === "title" && seed.id === DEFAULT_DRAFT_ID) {
        delete seed.id;
      }
      break;

    case "premise":
      seed.premise = cleanText(answer.value);
      if (!seed.gmSummary) {
        seed.gmSummary = seed.premise;
      }
      break;

    case "objectives":
    case "scenes":
    case "threats":
    case "rewards":
    case "clues":
    case "clocks":
    case "gmSecrets":
    case "partyAnchors":
    case "storyAnchors":
    case "factions":
    case "locations":
      seed[answer.field] = appendValues(seed[answer.field], answer.value);
      break;

    case "riskNotes":
      seed.riskNotes = appendValues(seed.riskNotes, answer.value);
      break;

    case "consequences":
      applyConsequenceAnswer(seed, answer.value);
      break;

    default:
      if (Object.hasOwn(seed, answer.field)) {
        seed[answer.field] = answer.value;
      }
      break;
  }
}

function applyConsequenceAnswer(seed, value) {
  if (isPlainObject(value)) {
    if (Object.hasOwn(value, "rewards")) {
      seed.rewards = appendValues(seed.rewards, value.rewards);
    }

    if (Object.hasOwn(value, "clocks")) {
      seed.clocks = appendValues(seed.clocks, value.clocks);
    }

    if (Object.hasOwn(value, "riskNotes")) {
      seed.riskNotes = appendValues(seed.riskNotes, value.riskNotes);
    }

    if (Object.hasOwn(value, "failureConsequence")) {
      seed.objectives = applyFailureConsequence(seed.objectives, value.failureConsequence);
    }

    return;
  }

  seed.riskNotes = appendValues(seed.riskNotes, value);
}

function applyFailureConsequence(objectives, failureConsequence) {
  const list = toArray(objectives).map((objective) => {
    if (isPlainObject(objective)) {
      return { ...objective };
    }

    return objective;
  });

  const firstObjectObjective = list.find((objective) => isPlainObject(objective));
  if (firstObjectObjective && !firstObjectObjective.failureConsequence) {
    firstObjectObjective.failureConsequence = cleanText(failureConsequence);
    return list;
  }

  if (list.length) {
    return list;
  }

  return [{
    title: "Resolve the central quest problem",
    failureConsequence: cleanText(failureConsequence)
  }];
}

function appendValues(current, incoming) {
  const next = toArray(current);
  return [...next, ...toArray(incoming)].filter((entry) => entry != null && cleanTextLike(entry));
}

function cleanTextLike(value) {
  if (typeof value === "string") {
    return cleanText(value);
  }

  return true;
}

function cloneData(value) {
  if (value == null) {
    return value;
  }

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function toArray(value) {
  if (value == null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function isWizardState(value) {
  return isPlainObject(value)
    && value.mode === "local-authoring-wizard"
    && isMasterQuestDraft(value.draft);
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
