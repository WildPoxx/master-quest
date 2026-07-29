import { FQL_FLAG_KEY, FQL_MODULE_ID, QUEST_STATUS } from "../constants.js";

const VALID_STATUSES = new Set(Object.values(QUEST_STATUS).filter((value) => value !== QUEST_STATUS.unknown));

export function assessQuestMigration({ journal } = {}) {
  if (!journal) {
    return [];
  }

  return toArray(journal)
    .map((doc) => assessQuestDocument(doc))
    .filter(Boolean);
}

export function assessQuestDocument(doc) {
  const payload = getFqlPayload(doc);
  if (!isPlainObject(payload)) {
    return null;
  }

  const source = cloneData(payload);
  const issues = [];
  const unknownFields = getUnknownFieldKeys(source);
  const questId = doc.id ?? source.id ?? null;
  const questName = source.name ?? doc.name ?? "Unnamed quest";

  if (typeof source.name !== "string" || !source.name.trim()) {
    issues.push(issue("missing-name", "error", "name", "Quest sem nome textual valido.", "repair-name"));
  }

  if (!VALID_STATUSES.has(source.status)) {
    issues.push(issue("invalid-status", "warning", "status", "Status fora do conjunto esperado pelo FQL/OLF.", "normalize-status"));
  }

  if (typeof source.playerNotes === "string" && typeof source.playernotes !== "string") {
    issues.push(issue("legacy-playerNotes-alias", "info", "playerNotes", "Campo legado usa a variante playerNotes.", "canonicalize-playernotes"));
  }

  inspectTasks(source.tasks, issues);
  inspectRewards(source.rewards, issues);
  inspectTopology(source, issues);

  const recommendedActions = unique([
    ...issues.map((entry) => entry.recommendedAction).filter(Boolean),
    ...(unknownFields.length ? ["preserve-unknown-fields"] : [])
  ]);

  return {
    questId,
    questName,
    legacyStatus: source.status ?? null,
    targetStatus: normalizeTargetStatus(source.status),
    strategy: chooseStrategy(issues),
    legacyPayloadLooksSafe: !issues.some((entry) => entry.severity === "error"),
    issueCount: issues.length,
    issues,
    recommendedActions,
    preserveUnknownFields: unknownFields,
    topology: {
      parent: typeof source.parent === "string" ? source.parent : null,
      subquestCount: Array.isArray(source.subquests) ? source.subquests.length : 0
    },
    source
  };
}

function inspectTasks(tasks, issues) {
  if (!Array.isArray(tasks)) {
    issues.push(issue("tasks-not-array", "warning", "tasks", "Tasks nao estao em array.", "coerce-tasks-array"));
    return;
  }

  tasks.forEach((task, index) => {
    const path = `tasks[${index}]`;

    if (!isPlainObject(task)) {
      issues.push(issue("task-not-object", "warning", path, "Task nao e objeto.", "sanitize-task"));
      return;
    }

    const title = firstString(task.name, task.title, task.description, task.note);
    if (!title) {
      issues.push(issue("task-missing-title", "warning", path, "Task sem titulo legivel.", "repair-task-title"));
    }
  });
}

function inspectRewards(rewards, issues) {
  if (!Array.isArray(rewards)) {
    issues.push(issue("rewards-not-array", "warning", "rewards", "Rewards nao estao em array.", "coerce-rewards-array"));
    return;
  }

  rewards.forEach((reward, index) => {
    const path = `rewards[${index}]`;

    if (!isPlainObject(reward)) {
      issues.push(issue("reward-not-object", "warning", path, "Reward nao e objeto.", "sanitize-reward"));
      return;
    }

    if (!isPlainObject(reward.data)) {
      issues.push(issue("reward-missing-data", "error", `${path}.data`, "Reward sem bloco data valido.", "sanitize-reward"));
      return;
    }

    const rewardName = firstString(reward.data?.name, reward.name, reward.title, reward.description, reward.note);
    if (!rewardName) {
      issues.push(issue("reward-missing-name", "error", path, "Reward sem nome legivel.", "repair-reward-name"));
    }

    if ((reward.type === "item" || reward.type === "actor") && typeof reward.data.uuid !== "string") {
      issues.push(issue("reward-missing-uuid", "warning", path, "Reward concreta sem UUID Foundry.", "downgrade-reward-to-abstract"));
    }
  });
}

function inspectTopology(source, issues) {
  if (source.parent !== undefined && source.parent !== null && typeof source.parent !== "string") {
    issues.push(issue("parent-invalid", "error", "parent", "Parent precisa ser string ou null.", "repair-parent-link"));
  }

  if (source.subquests !== undefined && !Array.isArray(source.subquests)) {
    issues.push(issue("subquests-not-array", "error", "subquests", "Subquests precisam estar em array.", "coerce-subquests-array"));
    return;
  }

  if (Array.isArray(source.subquests)) {
    source.subquests.forEach((subquestId, index) => {
      if (typeof subquestId !== "string") {
        issues.push(issue("subquest-id-invalid", "warning", `subquests[${index}]`, "ID de subquest invalido.", "sanitize-subquest-ids"));
      }
    });
  }
}

function chooseStrategy(issues) {
  const hasError = issues.some((entry) => entry.severity === "error");
  if (hasError) {
    const hasTopologyError = issues.some((entry) => entry.code.includes("parent") || entry.code.includes("subquest"));
    return hasTopologyError ? "manual-review" : "sanitize-before-write";
  }

  const hasWarning = issues.some((entry) => entry.severity === "warning");
  return hasWarning ? "sanitize-before-write" : "pass-through";
}

function normalizeTargetStatus(status) {
  return VALID_STATUSES.has(status) ? status : QUEST_STATUS.inactive;
}

function getFqlPayload(doc) {
  if (!doc) {
    return null;
  }

  // Read the raw flag rather than `doc.getFlag(...)`: Foundry rejects flag scopes whose
  // module is not active, and FQL cannot be activated on v14. See quest-import-fql.js.
  return doc.flags?.[FQL_MODULE_ID]?.[FQL_FLAG_KEY] ?? null;
}

function getUnknownFieldKeys(source) {
  const knownFields = new Set([
    "name",
    "status",
    "giver",
    "giverData",
    "description",
    "gmnotes",
    "playernotes",
    "playerNotes",
    "image",
    "giverName",
    "splash",
    "splashPos",
    "splashAsIcon",
    "location",
    "priority",
    "type",
    "parent",
    "subquests",
    "tasks",
    "rewards",
    "date",
    "tags"
  ]);

  return Object.keys(source).filter((key) => !knownFields.has(key));
}

function issue(code, severity, path, message, recommendedAction) {
  return { code, severity, path, message, recommendedAction };
}

function toArray(collection) {
  if (Array.isArray(collection)) {
    return collection;
  }

  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }

  if (typeof collection[Symbol.iterator] === "function") {
    return Array.from(collection);
  }

  return Object.values(collection);
}

function firstString(...values) {
  return values.find((value) => typeof value === "string" && value.trim()) ?? "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneData(value) {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set(values)];
}
