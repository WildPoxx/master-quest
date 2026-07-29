import { QUEST_STATUS } from "../constants.js";

const STATUS_SET = new Set(Object.values(QUEST_STATUS));
const LOOSE_END_PREFIXES = [
  "pontas soltas registradas -",
  "pontas soltas -",
  "pontas soltas registradas â€”",
  "pontas soltas â€”"
];

export function aggregateContinuityState({
  questStates = [],
  continuityReports = [],
  journalIndex = []
} = {}) {
  const records = new Map();

  for (const quest of questStates) {
    const record = getRecord(records, quest.name);
    record.questId = quest.id ?? null;
    record.questUuid = quest.uuid ?? null;
    record.currentQuestStatus = normalizeStatus(quest.status);
    record.currentQuest = quest;
  }

  for (const report of continuityReports) {
    ingestReport(records, report);
  }

  const quests = Array.from(records.values())
    .map((record) => finalizeRecord(record, journalIndex))
    .sort(compareQuestRecords);

  return {
    schemaVersion: 1,
    mode: "read-only",
    questCount: questStates.length,
    reportCount: continuityReports.length,
    journalEntryCount: Array.isArray(journalIndex) ? journalIndex.length : 0,
    facts: quests.flatMap((quest) => quest.facts),
    openThreads: quests.flatMap((quest) => quest.openThreads),
    candidatePatchImplications: quests.flatMap((quest) => quest.candidatePatchImplications),
    uncertainties: quests.flatMap((quest) => quest.uncertainties),
    quests
  };
}

function ingestReport(records, report) {
  const reportDate = toTimestamp(report.generatedAtLabel);
  const reportMeta = {
    reportTitle: report.reportTitle ?? null,
    reportScope: report.reportScope ?? "unknown",
    sourcePath: report.sourcePath ?? null,
    reportDateLabel: report.generatedAtLabel ?? null,
    reportDateMs: reportDate
  };

  if (report.questTitle) {
    const record = getRecord(records, report.questTitle);
    record.sourceReports.add(report.reportTitle ?? report.questTitle);
    pushStatusEvidence(record, {
      title: report.questTitle,
      status: report.reportedStatus,
      scope: report.reportScope,
      inferred: false,
      sourceKind: "report",
      reportTitle: report.reportTitle ?? null,
      sourcePath: report.sourcePath ?? null,
      sourceDateLabel: report.generatedAtLabel ?? null,
      sourceDateMs: reportDate
    });

    pushFact(record, {
      type: "report-summary",
      title: report.questTitle,
      status: normalizeStatus(report.reportedStatus),
      scope: report.reportScope ?? "unknown",
      objectiveCounts: report.objectiveCounts ?? null,
      rewardCounts: report.rewardCounts ?? null,
      sourceKind: "report",
      sourcePath: report.sourcePath ?? null
    });

    for (const reward of report.obtainedRewards ?? []) {
      pushFact(record, {
        type: "obtained-reward",
        title: report.questTitle,
        text: reward,
        scope: report.reportScope ?? "unknown",
        sourceKind: "report",
        sourcePath: report.sourcePath ?? null
      });
    }

    for (const alert of report.reportAlerts ?? []) {
      pushFact(record, {
        type: "report-alert",
        title: report.questTitle,
        text: alert,
        scope: report.reportScope ?? "unknown",
        sourceKind: "report",
        sourcePath: report.sourcePath ?? null
      });
    }
  }

  for (const entry of report.completedObjectives ?? []) {
    const record = getRecord(records, entry.group);
    record.sourceReports.add(report.reportTitle ?? report.questTitle ?? entry.group);
    pushFact(record, {
      type: "completed-objective",
      title: entry.group,
      text: entry.text,
      scope: report.reportScope ?? "unknown",
      sourceKind: "report-section",
      sourcePath: report.sourcePath ?? null
    });
  }

  for (const entry of report.failedObjectives ?? []) {
    const record = getRecord(records, entry.group);
    record.sourceReports.add(report.reportTitle ?? report.questTitle ?? entry.group);
    pushFact(record, {
      type: "failed-objective",
      title: entry.group,
      text: entry.text,
      scope: report.reportScope ?? "unknown",
      sourceKind: "report-section",
      sourcePath: report.sourcePath ?? null
    });
    pushOpenThread(record, {
      type: "failed-objective",
      title: entry.group,
      text: entry.text,
      scope: report.reportScope ?? "unknown",
      sourceKind: "report-section",
      sourcePath: report.sourcePath ?? null
    });
  }

  for (const entry of report.pendingObjectives ?? []) {
    const record = getRecord(records, entry.group);
    record.sourceReports.add(report.reportTitle ?? report.questTitle ?? entry.group);
    pushOpenThread(record, {
      type: "pending-objective",
      title: entry.group,
      text: entry.text,
      scope: report.reportScope ?? "unknown",
      sourceKind: "report-section",
      sourcePath: report.sourcePath ?? null
    });
  }

  for (const closeoutEntry of report.closeoutEntries ?? []) {
    const record = getRecord(records, closeoutEntry.title);
    record.sourceReports.add(report.reportTitle ?? report.questTitle ?? closeoutEntry.title);
    pushStatusEvidence(record, {
      title: closeoutEntry.title,
      status: QUEST_STATUS.completed,
      scope: closeoutEntry.scope,
      inferred: true,
      sourceKind: "closeout-entry",
      reportTitle: report.reportTitle ?? null,
      sourcePath: report.sourcePath ?? null,
      sourceDateLabel: closeoutEntry.date ?? report.generatedAtLabel ?? null,
      sourceDateMs: toTimestamp(closeoutEntry.date) ?? reportDate
    });

    pushFact(record, {
      type: "closeout",
      title: closeoutEntry.title,
      scope: closeoutEntry.scope ?? "unknown",
      summary: closeoutEntry.summary ?? null,
      consequence: closeoutEntry.consequence ?? null,
      sourceKind: "closeout-entry",
      sourcePath: report.sourcePath ?? null
    });

    for (const alert of closeoutEntry.alerts ?? []) {
      pushFact(record, {
        type: "closeout-alert",
        title: closeoutEntry.title,
        text: alert,
        scope: closeoutEntry.scope ?? "unknown",
        sourceKind: "closeout-entry",
        sourcePath: report.sourcePath ?? null
      });
    }

    for (const looseEnd of closeoutEntry.looseEnds ?? []) {
      pushOpenThread(record, {
        type: classifyLooseEnd(looseEnd),
        title: closeoutEntry.title,
        text: looseEnd,
        scope: closeoutEntry.scope ?? "unknown",
        sourceKind: "closeout-entry",
        sourcePath: report.sourcePath ?? null
      });
    }
  }

  for (const looseEnd of report.looseEnds ?? []) {
    const title = cleanLooseEndGroup(looseEnd.group) ?? report.questTitle;
    const record = getRecord(records, title);
    record.sourceReports.add(report.reportTitle ?? report.questTitle ?? title);
    pushOpenThread(record, {
      type: classifyLooseEnd(looseEnd.text),
      title,
      text: looseEnd.text,
      scope: report.reportScope ?? "unknown",
      sourceKind: "report-loose-end",
      sourcePath: report.sourcePath ?? null,
      sourceDateLabel: looseEnd.date ?? report.generatedAtLabel ?? null
    });
  }
}

function finalizeRecord(record, journalIndex) {
  const statusEvidence = [...record.statusEvidence].sort(compareStatusEvidence);
  const continuityStatus = statusEvidence[0]
    ? {
        value: statusEvidence[0].status,
        scope: statusEvidence[0].scope,
        inferred: statusEvidence[0].inferred,
        sourceKind: statusEvidence[0].sourceKind,
        sourceDateLabel: statusEvidence[0].sourceDateLabel ?? null,
        sourcePath: statusEvidence[0].sourcePath ?? null
      }
    : null;

  const facts = [...record.facts].sort(compareStructuredTextEntries);
  const openThreads = [...record.openThreads].sort(compareStructuredTextEntries);
  const candidatePatchImplications = [];
  const uncertainties = [];
  const matchedJournalEntries = matchJournalEntries(record.title, journalIndex);

  const distinctContinuityStatuses = [...new Set(statusEvidence.map((entry) => entry.status))];
  if (distinctContinuityStatuses.length > 1) {
    uncertainties.push({
      type: "continuity-status-conflict",
      title: record.title,
      currentQuestStatus: record.currentQuestStatus,
      observedStatuses: distinctContinuityStatuses,
      chosenStatus: continuityStatus?.value ?? null
    });
  }

  if (!record.questId && continuityStatus) {
    candidatePatchImplications.push({
      type: "missing-fql-quest",
      title: record.title,
      continuityStatus: continuityStatus.value,
      reason: "Continuity evidence exists for a quest that is not present in current FQL read state."
    });
  }

  if (record.questId && continuityStatus && record.currentQuestStatus !== continuityStatus.value) {
    candidatePatchImplications.push({
      type: "status-review",
      title: record.title,
      currentStatus: record.currentQuestStatus,
      continuityStatus: continuityStatus.value,
      preferredScope: continuityStatus.scope,
      inferredFromCloseout: continuityStatus.inferred,
      reason: "Current FQL status and continuity closeout history disagree."
    });
  }

  if (continuityStatus?.value === QUEST_STATUS.completed && openThreads.length > 0) {
    candidatePatchImplications.push({
      type: "completed-with-open-threads",
      title: record.title,
      continuityStatus: continuityStatus.value,
      openThreadCount: openThreads.length,
      reason: "Quest appears fictionally closed but still carries unresolved loose ends, failed objectives, or pending rewards."
    });
  }

  if (record.questId && !continuityStatus && openThreads.length === 0) {
    uncertainties.push({
      type: "no-continuity-evidence",
      title: record.title,
      currentQuestStatus: record.currentQuestStatus,
      reason: "Quest exists in FQL read state but no continuity report evidence was matched yet."
    });
  }

  return {
    title: record.title,
    questId: record.questId,
    questUuid: record.questUuid,
    currentQuestStatus: record.currentQuestStatus,
    continuityStatus,
    matchedJournalEntries,
    sourceReports: [...record.sourceReports].sort(),
    facts,
    openThreads,
    candidatePatchImplications,
    uncertainties
  };
}

function getRecord(records, title) {
  const normalizedTitle = normalizeText(title);
  const safeTitle = String(title ?? "Unknown quest").trim() || "Unknown quest";

  if (!records.has(normalizedTitle)) {
    records.set(normalizedTitle, {
      title: safeTitle,
      normalizedTitle,
      questId: null,
      questUuid: null,
      currentQuestStatus: null,
      currentQuest: null,
      statusEvidence: [],
      facts: [],
      openThreads: [],
      sourceReports: new Set()
    });
  }

  return records.get(normalizedTitle);
}

function pushStatusEvidence(record, evidence) {
  const status = normalizeStatus(evidence.status);
  if (!STATUS_SET.has(status)) return;

  record.statusEvidence.push({
    ...evidence,
    status,
    scope: evidence.scope ?? "unknown"
  });
}

function pushFact(record, fact) {
  const key = [
    fact.type,
    normalizeText(fact.title),
    normalizeText(fact.text ?? fact.summary ?? fact.status ?? ""),
    fact.scope ?? "unknown"
  ].join("|");

  if (!record._factKeys) record._factKeys = new Set();
  if (record._factKeys.has(key)) return;
  record._factKeys.add(key);
  record.facts.push(fact);
}

function pushOpenThread(record, thread) {
  const key = [
    thread.type,
    normalizeText(thread.title),
    normalizeText(thread.text),
    thread.scope ?? "unknown"
  ].join("|");

  if (!record._openThreadKeys) record._openThreadKeys = new Set();
  if (record._openThreadKeys.has(key)) return;
  record._openThreadKeys.add(key);
  record.openThreads.push(thread);
}

function matchJournalEntries(title, journalIndex) {
  const target = normalizeText(title);
  return toArray(journalIndex)
    .filter((entry) => normalizeText(entry.name) === target)
    .map((entry) => ({
      id: entry.id ?? null,
      uuid: entry.uuid ?? null,
      name: entry.name ?? null,
      folderName: entry.folderName ?? null,
      pageCount: entry.pageCount ?? 0
    }));
}

function classifyLooseEnd(text) {
  const normalized = normalizeText(text);
  if (normalized.startsWith("objetivo falho")) return "failed-objective";
  if (normalized.startsWith("reward")) return "pending-reward";
  if (normalized.startsWith("objetivo nao concluido")) return "pending-objective";
  return "loose-end";
}

function cleanLooseEndGroup(group) {
  const raw = String(group ?? "").trim();
  if (!raw) return null;

  const normalized = normalizeText(raw);
  for (const prefix of LOOSE_END_PREFIXES) {
    const normalizedPrefix = normalizeText(prefix);
    if (normalized.startsWith(normalizedPrefix)) {
      return raw.slice(raw.toLowerCase().indexOf("-") + 1).trim();
    }
  }

  return raw;
}

function compareStatusEvidence(left, right) {
  return (
    compareNumbersDesc(left.sourceDateMs, right.sourceDateMs) ||
    compareNumbersDesc(scopePriority(left.scope), scopePriority(right.scope)) ||
    compareNumbersDesc(originPriority(left.sourceKind), originPriority(right.sourceKind)) ||
    compareNumbersDesc(left.inferred ? 0 : 1, right.inferred ? 0 : 1)
  );
}

function compareQuestRecords(left, right) {
  return left.title.localeCompare(right.title);
}

function compareStructuredTextEntries(left, right) {
  const leftText = `${left.type}|${left.text ?? left.summary ?? left.status ?? ""}`;
  const rightText = `${right.type}|${right.text ?? right.summary ?? right.status ?? ""}`;
  return leftText.localeCompare(rightText);
}

function originPriority(kind) {
  if (kind === "report") return 3;
  if (kind === "closeout-entry") return 2;
  return 1;
}

function scopePriority(scope) {
  if (scope === "module") return 3;
  if (scope === "session") return 2;
  return 1;
}

function compareNumbersDesc(left, right) {
  return (right ?? -Infinity) - (left ?? -Infinity);
}

function normalizeStatus(status) {
  const normalized = normalizeText(status);
  return STATUS_SET.has(normalized) ? normalized : QUEST_STATUS.unknown;
}

function toTimestamp(value) {
  if (!value) return null;

  const isoTimestamp = Date.parse(value);
  if (Number.isFinite(isoTimestamp)) {
    return isoTimestamp;
  }

  const match = String(value).match(/^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const [, day, month, year, hour, minute, second = "00"] = match;
  return Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[â€”â€“]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function toArray(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return Array.from(collection.values());
  if (typeof collection[Symbol.iterator] === "function") return Array.from(collection);
  return Object.values(collection);
}
