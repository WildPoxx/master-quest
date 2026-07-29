import {
  assessMasterQuestDraft,
  createMasterQuestDraft
} from "../authoring/master-quest-authoring.js";
import { FQL_FLAG_KEY, FQL_MODULE_ID } from "../constants.js";

export function generateMasterQuestImportPreview(sourceInput = {}, options = {}) {
  const sourceType = resolveSourceType(sourceInput, options);
  const seeds = buildDraftSeeds(sourceInput, sourceType, options);
  const candidates = seeds.map((candidate, index) => {
    const draft = createMasterQuestDraft(candidate.seed, {
      systemProfile: candidate.seed.systemProfile ?? options.systemProfile
    });
    const assessment = assessMasterQuestDraft(draft);

    return {
      id: draft.id,
      title: draft.title,
      index,
      sourceType,
      sourceRef: candidate.sourceRef,
      confidence: candidate.confidence,
      draft,
      assessment,
      warnings: candidate.warnings
    };
  });

  return {
    schemaVersion: 1,
    mode: "import-preview-only",
    sourceType,
    writeMode: "none",
    readyForDraft: candidates.length > 0,
    readyForWrite: false,
    sourceSummary: summarizeSource(sourceInput, sourceType),
    candidateCount: candidates.length,
    candidates,
    operations: candidates.map((candidate) => ({
      type: "plan-master-quest-draft",
      operation: "would-create-master-quest-draft",
      targetId: candidate.id,
      targetName: candidate.title,
      sourceRef: candidate.sourceRef,
      writeCapable: false,
      requiresFutureApproval: true
    })),
    safety: [
      "Import preview is local-only.",
      "No Foundry Document is created, updated, or deleted.",
      "No JournalEntry.create call is made.",
      "No JournalEntry.update call is made.",
      "No setFlag call is made.",
      "No legacy FQL payload is written."
    ]
  };
}

function resolveSourceType(source, options) {
  const explicit = cleanText(options.sourceType);
  if (explicit) {
    return explicit;
  }

  if (typeof source === "string") {
    return "text";
  }

  if (Array.isArray(source)) {
    return source.some((entry) => extractFqlPayload(entry)) ? "fql-snapshot" : "journal-index";
  }

  if (!isPlainObject(source)) {
    return "unknown";
  }

  if (Array.isArray(source.quests) || Array.isArray(source.questStates) || Array.isArray(source.fqlQuests)) {
    return "fql-snapshot";
  }

  if (extractFqlPayload(source)) {
    return "fql-snapshot";
  }

  if (Array.isArray(source.entries) || Array.isArray(source.journalEntries)) {
    return "journal-index";
  }

  if (Array.isArray(source.pages) || source.uuid || source.folder) {
    return "journal-entry";
  }

  if (source.text || source.markdown || source.content) {
    return "text";
  }

  return "unknown";
}

function buildDraftSeeds(source, sourceType, options) {
  switch (sourceType) {
    case "text":
      return [buildTextSeed(source, options)];
    case "journal-entry":
      return [buildJournalSeed(source, options)];
    case "journal-index":
      return [buildJournalIndexSeed(source, options)];
    case "fql-snapshot":
      return buildFqlSnapshotSeeds(source, options);
    default:
      return [];
  }
}

function buildTextSeed(source, options) {
  const text = normalizeTextSource(source);
  const title = cleanText(options.title) || extractHeading(text) || "Imported Adventure";

  return {
    sourceRef: "text",
    confidence: "low",
    warnings: ["Free text import only creates a draft seed; the GM still needs objectives, opposition, and consequences."],
    seed: {
      id: cleanText(options.id),
      title,
      premise: firstParagraph(text),
      gmSummary: text,
      playerSafeSummary: cleanText(options.playerSafeSummary),
      systemProfile: options.systemProfile
    }
  };
}

function buildJournalSeed(source, options) {
  const title = cleanText(options.title ?? source.name ?? source.title) || "Imported Journal Adventure";
  const text = collectJournalText([source]);

  return {
    sourceRef: cleanText(source.uuid ?? source.id ?? source._id) || "journal-entry",
    confidence: "medium",
    warnings: ["Journal import preview preserves text as planning material; it does not infer a complete quest automatically."],
    seed: {
      id: cleanText(options.id),
      title,
      premise: firstParagraph(text) || title,
      gmSummary: text,
      playerSafeSummary: cleanText(options.playerSafeSummary),
      scenes: makeJournalScenes([source]),
      storyAnchors: [{
        kind: "journal",
        label: title,
        uuid: cleanText(source.uuid),
        role: "source"
      }],
      systemProfile: options.systemProfile
    }
  };
}

function buildJournalIndexSeed(source, options) {
  const entries = Array.isArray(source)
    ? source
    : toArray(source.entries ?? source.journalEntries);
  const title = cleanText(options.title) || cleanText(source.name ?? source.title) || "Imported Journal Adventure";
  const text = collectJournalText(entries);

  return {
    sourceRef: "journal-index",
    confidence: entries.length ? "medium" : "low",
    warnings: ["Journal index import preview groups source entries into one draft seed; later import steps can split acts or quests."],
    seed: {
      id: cleanText(options.id),
      title,
      premise: firstParagraph(text) || title,
      gmSummary: text,
      playerSafeSummary: cleanText(options.playerSafeSummary),
      scenes: makeJournalScenes(entries),
      storyAnchors: entries.map((entry) => ({
        kind: "journal",
        label: cleanText(entry.name ?? entry.title) || "Journal Entry",
        uuid: cleanText(entry.uuid),
        role: "source"
      })),
      systemProfile: options.systemProfile
    }
  };
}

function buildFqlSnapshotSeeds(source, options) {
  const quests = extractFqlQuests(source);
  return quests.map((quest, index) => {
    const payload = extractFqlPayload(quest) ?? quest;
    const title = cleanText(quest.title ?? quest.name ?? payload.title ?? payload.name) || `Imported FQL Quest ${index + 1}`;
    const text = [
      payload.description,
      payload.gmnotes,
      payload.playernotes,
      quest.description,
      quest.gmNotes,
      quest.playerNotes
    ].map(cleanText).filter(Boolean).join("\n\n");

    return {
      sourceRef: cleanText(quest.uuid ?? quest.id ?? quest._id ?? payload.id) || `fql-quest-${index + 1}`,
      confidence: "medium",
      warnings: ["FQL snapshot import preview reads legacy quest data as plain source material; it does not write back to FQL."],
      seed: {
        id: cleanText(options.id),
        title,
        premise: firstParagraph(text) || title,
        gmSummary: text,
        playerSafeSummary: cleanText(payload.playernotes ?? quest.playerNotes),
        objectives: normalizeFqlTasks(payload.tasks ?? quest.tasks ?? quest.objectives),
        rewards: normalizeFqlRewards(payload.rewards ?? quest.rewards),
        systemProfile: options.systemProfile
      }
    };
  });
}

function extractFqlQuests(source) {
  if (Array.isArray(source)) {
    return source;
  }

  if (!isPlainObject(source)) {
    return [];
  }

  return toArray(source.quests ?? source.questStates ?? source.fqlQuests ?? source.items ?? source.entries ?? source);
}

function extractFqlPayload(source) {
  if (!isPlainObject(source)) {
    return null;
  }

  if (isPlainObject(source.fqlPayload)) {
    return source.fqlPayload;
  }

  if (isPlainObject(source.flags?.[FQL_MODULE_ID]?.[FQL_FLAG_KEY])) {
    return source.flags[FQL_MODULE_ID][FQL_FLAG_KEY];
  }

  if (source.tasks || source.rewards || source.status || source.parent || source.subquests) {
    return source;
  }

  return null;
}

function normalizeFqlTasks(tasks) {
  return toArray(tasks).map((task, index) => {
    const source = isPlainObject(task) ? task : { title: task };
    const title = cleanText(source.title ?? source.name ?? source.label ?? source.text) || `Objective ${index + 1}`;

    return {
      title,
      kind: source.hidden ? "hidden" : "main",
      visibility: source.hidden ? "secret" : "player",
      successCriteria: source.completed ? "Already marked complete in the legacy snapshot." : "",
      notes: cleanText(source.notes ?? source.description)
    };
  });
}

function normalizeFqlRewards(rewards) {
  return toArray(rewards).map((reward, index) => {
    const source = isPlainObject(reward) ? reward : { title: reward };
    const title = cleanText(source.title ?? source.name ?? source.label ?? source.text) || `Reward ${index + 1}`;

    return {
      title,
      kind: "custom",
      visibility: source.hidden ? "secret" : "player",
      unlockCondition: source.unlocked ? "Already unlocked in the legacy snapshot." : "",
      notes: cleanText(source.notes ?? source.description)
    };
  });
}

function summarizeSource(source, sourceType) {
  return {
    type: sourceType,
    isArray: Array.isArray(source),
    itemCount: Array.isArray(source) ? source.length : countKnownItems(source),
    hasText: Boolean(firstParagraph(normalizeTextSource(source))),
    detectedAt: "local-preview"
  };
}

function countKnownItems(source) {
  if (!isPlainObject(source)) {
    return 0;
  }

  for (const key of ["quests", "questStates", "fqlQuests", "entries", "journalEntries", "pages"]) {
    if (Array.isArray(source[key])) {
      return source[key].length;
    }
  }

  return 1;
}

function collectJournalText(entries) {
  return entries.map((entry) => {
    const title = cleanText(entry.name ?? entry.title);
    const pageText = toArray(entry.pages).map((page) =>
      cleanText(page.text?.markdown ?? page.text?.content ?? page.markdown ?? page.content ?? page.name)
    ).filter(Boolean).join("\n\n");
    const body = cleanText(entry.text ?? entry.markdown ?? entry.content);

    return [title && `# ${title}`, body, pageText].filter(Boolean).join("\n\n");
  }).filter(Boolean).join("\n\n");
}

function makeJournalScenes(entries) {
  return entries.map((entry, index) => ({
    title: cleanText(entry.name ?? entry.title) || `Journal Source ${index + 1}`,
    purpose: "Review imported journal source and decide whether it becomes a scene, objective, or reference.",
    challengeType: "unknown",
    gmNotes: cleanText(entry.uuid) ? `Source: ${entry.uuid}` : ""
  }));
}

function normalizeTextSource(source) {
  if (typeof source === "string") {
    return cleanText(source);
  }

  if (!isPlainObject(source)) {
    return "";
  }

  return cleanText(source.text ?? source.markdown ?? source.content ?? source.gmSummary ?? source.description);
}

function extractHeading(text) {
  const firstLine = cleanText(text).split(/\r?\n/).find((line) => cleanText(line));
  if (!firstLine) {
    return "";
  }

  return firstLine.replace(/^#+\s*/, "").trim();
}

function firstParagraph(text) {
  return cleanText(text).split(/\r?\n\s*\r?\n/).map(cleanText).find(Boolean) ?? "";
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
