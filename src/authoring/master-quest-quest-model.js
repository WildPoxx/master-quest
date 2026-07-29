import { createMasterQuestDraft } from "./master-quest-authoring.js";

// Convert a reviewed MasterQuest draft into a native operational quest model.
// This is a PREVIEW: it never creates JournalEntries, quests, or FQL flags.
// The Quest Board renders this model; a future write adapter would require
// explicit GM confirmation, backup, and post-write validation.
export function generateMasterQuestQuestModel(draftInput = {}, options = {}) {
  const draft = isQuestDraft(draftInput)
    ? draftInput
    : createMasterQuestDraft(draftInput, options);

  const quest = {
    id: draft.id,
    title: draft.title,
    status: "draft",
    premise: cleanText(draft.premise),
    dramaticQuestion: cleanText(draft.dramaticQuestion),
    playerSummary: cleanText(draft.playerSafeSummary),
    gmSummary: cleanText(draft.gmSummary),
    objectives: arr(draft.objectives).map((objective) => ({
      title: cleanText(objective.title),
      kind: cleanText(objective.kind),
      visibility: objective.visibility === "gm" ? "gm" : "player",
      successCriteria: cleanText(objective.successCriteria),
      failureConsequence: cleanText(objective.failureConsequence)
    })),
    clues: arr(draft.clues).map((clue) => ({
      label: cleanText(clue.label),
      summary: cleanText(clue.summary),
      reveals: arr(clue.reveals).map(cleanText).filter(Boolean),
      visibility: "gm"
    })),
    rewards: arr(draft.rewards).map((reward) => ({
      title: cleanText(reward.title),
      kind: cleanText(reward.kind),
      unlockCondition: cleanText(reward.unlockCondition),
      visibility: "player"
    })),
    clocks: arr(draft.clocks).map((clock) => ({
      label: cleanText(clock.label),
      current: Number(clock.current ?? 0),
      max: Number(clock.max ?? 0),
      consequence: cleanText(clock.consequence)
    })),
    threats: arr(draft.threats).map((threat) => ({
      label: cleanText(threat.label),
      kind: cleanText(threat.kind),
      role: cleanText(threat.role),
      agenda: cleanText(threat.agenda),
      swadeRole: cleanText(threat.swadeRole),
      systemRole: cleanText(threat.systemRole),
      visibility: "gm"
    })),
    secrets: arr(draft.gmSecrets).map((secret) => ({
      label: cleanText(secret.label),
      notes: cleanText(secret.notes),
      visibility: "gm"
    })),
    locations: arr(draft.locations).map((location) => ({ label: cleanText(location.label) })),
    factions: arr(draft.factions).map((faction) => ({ label: cleanText(faction.label) })),
    partyAnchors: arr(draft.partyAnchors).map(anchorRecord),
    storyAnchors: arr(draft.storyAnchors).map(anchorRecord)
  };

  // Optional subquests derived from scenes. The draft has no explicit subquests
  // yet; scenes are the most natural seed for "potential subquests" in a preview.
  const subquests = arr(draft.scenes).map((scene, index) => ({
    id: `${draft.id}-sub-${index + 1}`,
    title: cleanText(scene.title) || `Cena ${index + 1}`,
    summary: cleanText(scene.purpose),
    challengeType: scene.challengeType && scene.challengeType !== "unknown" ? scene.challengeType : "",
    locationRef: cleanText(scene.locationRef),
    gmNotes: cleanText(scene.gmNotes),
    source: "scene"
  }));

  const counts = {
    objectives: quest.objectives.length,
    clues: quest.clues.length,
    rewards: quest.rewards.length,
    clocks: quest.clocks.length,
    threats: quest.threats.length,
    secrets: quest.secrets.length,
    subquests: subquests.length
  };

  return {
    schemaVersion: 1,
    kind: "master-quest-quest-model",
    mode: cleanText(options.mode) || "preview",
    writeMode: "none",
    generatedFrom: { id: draft.id, title: draft.title },
    systemProfile: draft.systemProfile ?? null,
    quest,
    subquests,
    counts,
    safety: [
      "writeMode: none",
      "No JournalEntry, quest, or FQL flag is created by this preview.",
      "Generating into a live Quest Board requires explicit GM confirmation, backup, and post-write validation."
    ]
  };
}

// Readable GM-facing preview text for the generated model.
export function generateMasterQuestQuestPreviewText(model = {}) {
  const quest = model.quest ?? {};
  const lines = [
    `# Quest Preview: ${cleanText(quest.title) || "Untitled"}`,
    "",
    `Status: ${cleanText(quest.status) || "draft"} (writeMode: ${model.writeMode ?? "none"})`
  ];

  if (quest.premise) {
    lines.push("", cleanText(quest.premise));
  }

  pushList(lines, "Objetivos", arr(quest.objectives).map((objective) =>
    `${cleanText(objective.title)}${objective.visibility ? ` [${objective.visibility}]` : ""}`));
  pushList(lines, "Pistas (GM)", arr(quest.clues).map((clue) => cleanText(clue.label)));
  pushList(lines, "Recompensas", arr(quest.rewards).map((reward) => cleanText(reward.title)));
  pushList(lines, "Relógios", arr(quest.clocks).map((clock) =>
    `${cleanText(clock.label)} (${clock.current}/${clock.max})`));
  pushList(lines, "Ameaças (GM)", arr(quest.threats).map((threat) => cleanText(threat.label)));
  pushList(lines, "Segredos (GM)", arr(quest.secrets).map((secret) => cleanText(secret.label)));
  pushList(lines, "Subquests", arr(model.subquests).map((subquest) => cleanText(subquest.title)));

  lines.push("", "## Segurança", ...arr(model.safety).map((entry) => `- ${cleanText(entry)}`));
  return lines.join("\n");
}

function anchorRecord(anchor) {
  return {
    label: cleanText(anchor.label),
    kind: cleanText(anchor.kind),
    role: cleanText(anchor.role),
    importance: cleanText(anchor.importance)
  };
}

function pushList(lines, heading, entries) {
  lines.push("", `## ${heading}`);
  const items = arr(entries).map(cleanText).filter(Boolean);
  if (!items.length) {
    lines.push("Nada planejado ainda.");
    return;
  }
  for (const item of items) {
    lines.push(`- ${item}`);
  }
}

function isQuestDraft(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && value.scope === "quest"
    && Array.isArray(value.objectives);
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function cleanText(value) {
  return String(value ?? "").trim();
}
