import {
  assessMasterQuestDraft,
  createMasterQuestDraft,
  generateMasterQuestPreview
} from "./master-quest-authoring.js";

export function generateMasterQuestFoundryExportPreview(draftInput = {}, options = {}) {
  const draft = isMasterQuestDraft(draftInput)
    ? draftInput
    : createMasterQuestDraft(draftInput, options);
  const assessment = assessMasterQuestDraft(draft);
  const gmPreview = generateMasterQuestPreview(draft, { audience: "gm" });
  const playerPreview = generateMasterQuestPreview(draft, { audience: "player-safe" });
  const folderName = cleanText(options.folderName) || `MasterQuest - ${draft.title}`;
  const journalName = cleanText(options.journalName) || draft.title;
  const pages = buildJournalPages(draft, gmPreview, playerPreview);
  const questOps = buildQuestOpsPlan(draft);
  const plannedDocuments = {
    folders: [
      {
        id: `${draft.id}-folder`,
        name: folderName,
        type: "JournalEntry",
        role: "master-quest-workspace"
      }
    ],
    journalEntries: [
      {
        id: `${draft.id}-journal`,
        name: journalName,
        folderId: `${draft.id}-folder`,
        role: "master-quest-canonical-journal",
        pages
      }
    ],
    questOps: [questOps]
  };

  const operations = buildOperations(plannedDocuments);

  return {
    schemaVersion: 1,
    mode: "preview-only",
    draftId: draft.id,
    title: draft.title,
    target: {
      platform: "foundry-vtt",
      foundryVersion: cleanText(options.foundryVersion) || "13.351",
      system: draft.system,
      systemProfile: draft.systemProfile ?? null
    },
    writeMode: "none",
    readyForExportPlan: assessment.readyForPreview,
    readyForWrite: false,
    blockers: assessment.missing.filter((issue) => issue.severity === "error"),
    warnings: [
      ...assessment.missing.filter((issue) => issue.severity !== "error"),
      ...assessment.warnings
    ],
    plannedDocuments,
    operations,
    safety: [
      "Preview only: no Foundry Document is created, updated, or deleted.",
      "No JournalEntry.create call is made.",
      "No JournalEntry.update call is made.",
      "No setFlag call is made.",
      "No legacy FQL payload is generated or written.",
      "A future export adapter must require GM preview, backup policy, and explicit approval."
    ]
  };
}

function buildJournalPages(draft, gmPreview, playerPreview) {
  const pages = [
    makePage("gm-overview", "GM Overview", "gm", gmPreview.markdown),
    makePage("player-brief", "Player Brief", "player", playerPreview.markdown),
    makePage("objectives", "Objectives", "gm", renderListPage("Objectives", draft.objectives, formatObjective)),
    makePage("scenes", "Scenes", "gm", renderListPage("Scenes", draft.scenes, formatScene)),
    makePage(
      "opposition",
      "Opposition And Pressure",
      "gm",
      renderListPage("Threats", draft.threats, (threat) => formatThreat(threat, draft.systemProfile))
    ),
    makePage("clues-rewards", "Clues And Rewards", "gm", renderCluesAndRewards(draft)),
    makePage("continuity", "Continuity And Anchors", "gm", renderContinuity(draft)),
    makePage("system-profile", "System Profile Notes", "gm", renderSystemProfileNotes(draft)),
    makePage("export-notes", "Export Notes", "gm", renderExportNotes())
  ];

  if (draft.gmSecrets.length) {
    pages.splice(7, 0, makePage(
      "gm-secrets",
      "GM Secrets",
      "gm",
      renderListPage("GM Secrets", draft.gmSecrets, (secret) =>
        secret.notes ? `${secret.label}: ${secret.notes}` : secret.label
      )
    ));
  }

  return pages;
}

function buildQuestOpsPlan(draft) {
  return {
    id: `${draft.id}-quest-ops`,
    name: draft.title,
    sourceDraftId: draft.id,
    status: "draft",
    scope: "quest",
    source: "master-quest-native",
    fqlStrategy: "none",
    objectiveIds: draft.objectives.map((objective) => objective.id),
    sceneIds: draft.scenes.map((scene) => scene.id),
    threatIds: draft.threats.map((threat) => threat.id),
    rewardIds: draft.rewards.map((reward) => reward.id),
    clockIds: draft.clocks.map((clock) => clock.id),
    visibilityModel: {
      gmOnly: [
        ...draft.objectives.filter(isGmOnly).map((objective) => objective.id),
        ...draft.threats.filter(isGmOnly).map((threat) => threat.id),
        ...draft.clues.filter(isGmOnly).map((clue) => clue.id),
        ...draft.rewards.filter(isGmOnly).map((reward) => reward.id)
      ],
      playerVisible: [
        ...draft.objectives.filter(isPlayerVisible).map((objective) => objective.id),
        ...draft.threats.filter(isPlayerVisible).map((threat) => threat.id),
        ...draft.clues.filter(isPlayerVisible).map((clue) => clue.id),
        ...draft.rewards.filter(isPlayerVisible).map((reward) => reward.id)
      ]
    }
  };
}

function buildOperations(plannedDocuments) {
  const operations = [];

  for (const folder of plannedDocuments.folders) {
    operations.push(makeOperation("plan-folder", "would-create-folder", folder.id, folder.name));
  }

  for (const journal of plannedDocuments.journalEntries) {
    operations.push(makeOperation("plan-journal-entry", "would-create-journal-entry", journal.id, journal.name));

    for (const page of journal.pages) {
      operations.push(makeOperation("plan-journal-page", "would-create-journal-page", page.id, page.name));
    }
  }

  for (const questOps of plannedDocuments.questOps) {
    operations.push(makeOperation("plan-quest-ops-record", "would-create-quest-ops-record", questOps.id, questOps.name));
  }

  return operations;
}

function makeOperation(type, operation, targetId, targetName) {
  return {
    type,
    operation,
    targetId,
    targetName,
    writeCapable: false,
    requiresFutureApproval: true
  };
}

function makePage(idSuffix, name, visibility, markdown) {
  return {
    id: idSuffix,
    name,
    type: "text",
    visibility,
    format: "markdown",
    markdown: cleanText(markdown)
  };
}

function renderListPage(title, entries, formatter) {
  const lines = [`# ${title}`];

  if (!entries.length) {
    lines.push("", "No entries planned yet.");
    return lines.join("\n");
  }

  for (const entry of entries) {
    lines.push("", `- ${formatter(entry)}`);
  }

  return lines.join("\n");
}

function renderCluesAndRewards(draft) {
  return [
    renderListPage("Clues", draft.clues, (clue) =>
      [clue.label, clue.summary, clue.reveals.length ? `reveals: ${clue.reveals.join(", ")}` : ""]
        .filter(Boolean)
        .join(" - ")
    ),
    renderListPage("Rewards", draft.rewards, (reward) =>
      [reward.title, reward.kind, reward.unlockCondition].filter(Boolean).join(" - ")
    )
  ].join("\n\n");
}

function renderContinuity(draft) {
  const lines = [
    "# Continuity And Anchors",
    "",
    `Continuity mode: ${draft.continuityMode}`
  ];

  appendList(lines, "Party Anchors", draft.partyAnchors, (anchor) => formatAnchor(anchor));
  appendList(lines, "Story Anchors", draft.storyAnchors, (anchor) => formatAnchor(anchor));
  appendList(lines, "Loose Threads", draft.contextProfile.looseThreads, (thread) => thread);
  appendList(lines, "Factions", draft.factions, (faction) => faction.label);
  appendList(lines, "Locations", draft.locations, (location) => location.label);
  appendList(lines, "Clocks", draft.clocks, (clock) =>
    `${clock.label} (${clock.current}/${clock.max})${clock.consequence ? ` - ${clock.consequence}` : ""}`
  );

  return lines.join("\n");
}

function renderSystemProfileNotes(draft) {
  const lines = ["# System Profile Notes"];
  if (draft.systemProfile) {
    lines.push("", `${draft.systemProfile.label}${draft.systemProfile.version ? ` ${draft.systemProfile.version}` : ""}`);
  } else {
    lines.push("", "No system profile is active. The MasterQuest core remains rules-system agnostic.");
  }

  appendList(lines, "Challenge Suggestions", draft.challengeSuggestions, (entry) => entry);
  appendList(lines, "Profile Suggestions", draft.systemProfile?.suggestions ?? [], (entry) => entry);
  appendList(lines, "Spotlight Suggestions", draft.spotlightSuggestions, (entry) => entry);
  appendList(lines, "Risk Notes", draft.riskNotes, (entry) => entry);
  return lines.join("\n");
}

function renderExportNotes() {
  return [
    "# Export Notes",
    "",
    "This is a planning preview only.",
    "",
    "- writeMode: none",
    "- legacyFqlStrategy: none",
    "- no JournalEntry create/update is executed",
    "- no legacy FQL flags are read or written",
    "- a future adapter must require GM approval before any write"
  ].join("\n");
}

function appendList(lines, heading, entries, formatter) {
  lines.push("", `## ${heading}`);

  if (!entries.length) {
    lines.push("No entries planned yet.");
    return;
  }

  for (const entry of entries) {
    lines.push(`- ${formatter(entry)}`);
  }
}

function formatObjective(objective) {
  return [
    objective.title,
    objective.kind,
    objective.visibility,
    objective.successCriteria,
    objective.failureConsequence ? `failure: ${objective.failureConsequence}` : ""
  ].filter(Boolean).join(" - ");
}

function formatScene(scene) {
  return [
    scene.title,
    scene.purpose,
    scene.locationRef,
    scene.challengeType !== "unknown" ? scene.challengeType : "",
    scene.gmNotes ? `GM: ${scene.gmNotes}` : ""
  ].filter(Boolean).join(" - ");
}

function formatThreat(threat, systemProfile = null) {
  return [
    threat.label,
    threat.kind,
    threat.role,
    threat.agenda ? `agenda: ${threat.agenda}` : "",
    systemProfile?.id === "swade" && threat.swadeRole ? `SWADE: ${threat.swadeRole}` : "",
    systemProfile && systemProfile.id !== "swade" && threat.systemRole ? `system role: ${threat.systemRole}` : ""
  ].filter(Boolean).join(" - ");
}

function formatAnchor(anchor) {
  return [
    anchor.label,
    anchor.kind,
    anchor.role,
    anchor.importance
  ].filter(Boolean).join(" - ");
}

function isGmOnly(entry) {
  return entry.visibility === "gm" || entry.visibility === "secret" || entry.kind === "hidden";
}

function isPlayerVisible(entry) {
  return entry.visibility === "player" || entry.visibility === "public";
}

function cleanText(value) {
  if (value == null) {
    return "";
  }

  return String(value).trim();
}

function isMasterQuestDraft(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && value.scope === "quest"
    && value.source === "native"
    && Array.isArray(value.objectives)
    && Array.isArray(value.threats);
}

