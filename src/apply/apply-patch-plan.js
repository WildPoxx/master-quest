import { FQL_FLAG_KEY, FQL_MODULE_ID } from "../constants.js";

export const QUEST_PATCH_APPLY_STATUS = Object.freeze({
  dryRun: "dry-run",
  applied: "applied",
  alreadyFixed: "already-fixed",
  blocked: "blocked",
  failed: "failed"
});

const SUPPORTED_OPERATION = "append-subquest-id";
const SUBQUEST_PATH = `flags.${FQL_MODULE_ID}.${FQL_FLAG_KEY}.subquests`;

export async function applyPatchPlan(patchPlan = {}, options = {}) {
  const changes = Array.isArray(patchPlan.proposedChanges) ? patchPlan.proposedChanges : [];
  const results = [];

  for (const change of changes) {
    results.push(await applyQuestPatch(change, options));
  }

  return {
    schemaVersion: 1,
    mode: options.dryRun === false ? "apply" : "dry-run",
    status: summarizeBatchStatus(results),
    patchCount: changes.length,
    appliedCount: results.filter((result) => result.status === QUEST_PATCH_APPLY_STATUS.applied).length,
    alreadyFixedCount: results.filter((result) => result.status === QUEST_PATCH_APPLY_STATUS.alreadyFixed).length,
    blockedCount: results.filter((result) => result.status === QUEST_PATCH_APPLY_STATUS.blocked).length,
    failedCount: results.filter((result) => result.status === QUEST_PATCH_APPLY_STATUS.failed).length,
    results
  };
}

export async function applyQuestPatch(change = {}, options = {}) {
  const dryRun = options.dryRun !== false;
  const approved = Boolean(options.approved);
  const requireApproval = options.requireApproval !== false && change.requiresHumanApproval !== false;
  const now = resolveNow(options.now);
  const result = createBaseResult(change, { dryRun, approved, requireApproval, now });

  try {
    const journal = options.journal;
    const parentEntry = findJournalDocument(journal, change.targetQuestId);
    const childEntry = findJournalDocument(journal, change.childQuestId);
    const parentPayload = cloneData(getFqlPayload(parentEntry));
    const childPayload = cloneData(getFqlPayload(childEntry));

    const preValidation = validateAppendSubquestPatch(change, {
      parentEntry,
      childEntry,
      parentPayload,
      childPayload
    });

    result.preValidation = preValidation;
    result.before = makeState(parentEntry, childEntry, parentPayload, childPayload);

    if (!preValidation.ok) {
      result.status = QUEST_PATCH_APPLY_STATUS.blocked;
      return result;
    }

    if (parentPayload.subquests.includes(change.childQuestId)) {
      result.status = QUEST_PATCH_APPLY_STATUS.alreadyFixed;
      result.alreadyFixed = true;
      result.postValidation = {
        ok: true,
        issues: []
      };
      result.after = result.before;
      return result;
    }

    result.backup.required = true;

    if (dryRun) {
      result.status = QUEST_PATCH_APPLY_STATUS.dryRun;
      result.applied.mutation = makeMutation(change);
      result.postValidation = {
        ok: null,
        issues: []
      };
      return result;
    }

    if (requireApproval && !approved) {
      result.status = QUEST_PATCH_APPLY_STATUS.blocked;
      result.preValidation.issues.push(makeIssue(
        "approval-required",
        "error",
        "approval",
        "Patch requires explicit GM approval before write."
      ));
      result.preValidation.ok = false;
      return result;
    }

    if (typeof options.createBackup !== "function") {
      result.status = QUEST_PATCH_APPLY_STATUS.blocked;
      result.backup.error = "No backup adapter was provided.";
      result.preValidation.issues.push(makeIssue(
        "backup-adapter-required",
        "error",
        "backup",
        "Write operations require a backup adapter."
      ));
      result.preValidation.ok = false;
      return result;
    }

    const parentExceptSubquestsBefore = stableJson(withoutKey(parentPayload, "subquests"));
    const childBefore = stableJson(childPayload);

    try {
      result.backup.record = await options.createBackup(makeBackupRequest(change, {
        parentEntry,
        childEntry,
        parentPayload,
        childPayload,
        before: result.before,
        now
      }));
      result.backup.created = true;
    } catch (err) {
      result.status = QUEST_PATCH_APPLY_STATUS.failed;
      result.failed = true;
      result.backup.error = String(err?.message ?? err);
      return result;
    }

    const nextParentPayload = cloneData(parentPayload);
    nextParentPayload.subquests = [...parentPayload.subquests, change.childQuestId];

    result.applied.attempted = true;
    result.applied.mutation = makeMutation(change);
    await setFqlPayload(parentEntry, nextParentPayload);
    result.changedFoundryDocuments = true;
    result.applied.changed = true;

    const afterParentPayload = cloneData(getFqlPayload(parentEntry));
    const afterChildPayload = cloneData(getFqlPayload(childEntry));
    result.after = makeState(parentEntry, childEntry, afterParentPayload, afterChildPayload);
    result.postValidation = validatePostApply(change, {
      afterParentPayload,
      afterChildPayload,
      parentExceptSubquestsBefore,
      childBefore
    });

    if (!result.postValidation.ok) {
      result.status = QUEST_PATCH_APPLY_STATUS.failed;
      result.failed = true;
      return result;
    }

    if (typeof options.refresh === "function") {
      result.refresh = await options.refresh({ change, result });
    }

    result.status = QUEST_PATCH_APPLY_STATUS.applied;
    return result;
  } catch (err) {
    result.status = QUEST_PATCH_APPLY_STATUS.failed;
    result.failed = true;
    result.error = String(err?.message ?? err);
    return result;
  }
}

function validateAppendSubquestPatch(change, context) {
  const issues = [];
  const { parentEntry, childEntry, parentPayload, childPayload } = context;

  if (change.operation !== SUPPORTED_OPERATION) {
    issues.push(makeIssue(
      "unsupported-operation",
      "error",
      "operation",
      `Unsupported patch operation: ${change.operation ?? "(missing)"}.`
    ));
  }

  if (change.path && change.path !== SUBQUEST_PATH) {
    issues.push(makeIssue(
      "unexpected-path",
      "error",
      "path",
      `Patch path must be ${SUBQUEST_PATH}.`
    ));
  }

  if (!change.targetQuestId) {
    issues.push(makeIssue("missing-target-id", "error", "targetQuestId", "Patch has no targetQuestId."));
  }

  if (!change.childQuestId) {
    issues.push(makeIssue("missing-child-id", "error", "childQuestId", "Patch has no childQuestId."));
  }

  if (change.valueToAppend && change.valueToAppend !== change.childQuestId) {
    issues.push(makeIssue(
      "append-value-mismatch",
      "error",
      "valueToAppend",
      "valueToAppend must match childQuestId for append-subquest-id patches."
    ));
  }

  if (!parentEntry) {
    issues.push(makeIssue("target-not-found", "error", "targetQuestId", `Target quest not found: ${change.targetQuestId}.`));
  }

  if (!childEntry) {
    issues.push(makeIssue("child-not-found", "error", "childQuestId", `Child quest not found: ${change.childQuestId}.`));
  }

  if (!isPlainObject(parentPayload)) {
    issues.push(makeIssue("target-payload-invalid", "error", SUBQUEST_PATH, "Target quest has no valid FQL payload object."));
  } else if (!Array.isArray(parentPayload.subquests)) {
    issues.push(makeIssue("target-subquests-not-array", "error", SUBQUEST_PATH, "Target quest subquests value is not an array."));
  }

  if (!isPlainObject(childPayload)) {
    issues.push(makeIssue("child-payload-invalid", "error", "flags.forien-quest-log.json", "Child quest has no valid FQL payload object."));
  } else if (childPayload.parent !== change.targetQuestId) {
    issues.push(makeIssue(
      "child-parent-mismatch",
      "error",
      "flags.forien-quest-log.json.parent",
      `Child parent must be ${change.targetQuestId}, found ${childPayload.parent ?? "null"}.`
    ));
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function validatePostApply(change, context) {
  const issues = [];
  const {
    afterParentPayload,
    afterChildPayload,
    parentExceptSubquestsBefore,
    childBefore
  } = context;

  if (!Array.isArray(afterParentPayload?.subquests)) {
    issues.push(makeIssue("post-target-subquests-not-array", "error", SUBQUEST_PATH, "Post-apply target subquests is not an array."));
  } else if (!afterParentPayload.subquests.includes(change.childQuestId)) {
    issues.push(makeIssue("post-child-not-appended", "error", SUBQUEST_PATH, "Post-apply target subquests does not include childQuestId."));
  }

  if (afterChildPayload?.parent !== change.targetQuestId) {
    issues.push(makeIssue(
      "post-child-parent-mismatch",
      "error",
      "flags.forien-quest-log.json.parent",
      "Post-apply child parent changed or does not match target."
    ));
  }

  if (stableJson(withoutKey(afterParentPayload, "subquests")) !== parentExceptSubquestsBefore) {
    issues.push(makeIssue(
      "post-target-unexpected-field-change",
      "error",
      "flags.forien-quest-log.json",
      "Post-apply target payload changed outside subquests."
    ));
  }

  if (stableJson(afterChildPayload) !== childBefore) {
    issues.push(makeIssue(
      "post-child-unexpected-change",
      "error",
      "flags.forien-quest-log.json",
      "Post-apply child payload changed unexpectedly."
    ));
  }

  return {
    ok: issues.length === 0,
    issues
  };
}

function createBaseResult(change, { dryRun, approved, requireApproval, now }) {
  return {
    schemaVersion: 1,
    operation: change.operation ?? null,
    type: change.type ?? null,
    targetQuestId: change.targetQuestId ?? null,
    targetQuestName: change.targetQuestName ?? null,
    childQuestId: change.childQuestId ?? null,
    childQuestName: change.childQuestName ?? null,
    status: QUEST_PATCH_APPLY_STATUS.failed,
    dryRun,
    approved,
    requiresHumanApproval: requireApproval,
    changedFoundryDocuments: false,
    backup: {
      required: false,
      created: false,
      record: null,
      error: null
    },
    applied: {
      attempted: false,
      changed: false,
      mutation: null
    },
    alreadyFixed: false,
    failed: false,
    preValidation: {
      ok: false,
      issues: []
    },
    postValidation: {
      ok: null,
      issues: []
    },
    before: null,
    after: null,
    refresh: null,
    error: null,
    safety: [
      "No quest status is changed.",
      "No task is marked.",
      "No reward is granted.",
      "No note, ownership, or Journal page is changed.",
      "Write mode requires explicit approval and a backup adapter."
    ],
    completedAt: now
  };
}

function makeMutation(change) {
  return {
    documentId: change.targetQuestId,
    path: SUBQUEST_PATH,
    operation: SUPPORTED_OPERATION,
    appendedValue: change.childQuestId
  };
}

function makeBackupRequest(change, context) {
  const { parentEntry, childEntry, parentPayload, childPayload, before, now } = context;

  return {
    schemaVersion: 1,
    operation: change.operation,
    createdAt: now,
    change: cloneData(change),
    before: cloneData(before),
    entries: [
      makeBackupEntry("target", parentEntry, parentPayload),
      makeBackupEntry("child", childEntry, childPayload)
    ]
  };
}

function makeBackupEntry(role, entry, payload) {
  return {
    role,
    id: entry.id ?? null,
    uuid: entry.uuid ?? (entry.id ? `JournalEntry.${entry.id}` : null),
    name: entry.name ?? payload?.name ?? null,
    flags: {
      [FQL_MODULE_ID]: {
        [FQL_FLAG_KEY]: cloneData(payload)
      }
    }
  };
}

function makeState(parentEntry, childEntry, parentPayload, childPayload) {
  return {
    target: makeQuestSnapshot(parentEntry, parentPayload),
    child: makeQuestSnapshot(childEntry, childPayload)
  };
}

function makeQuestSnapshot(entry, payload) {
  if (!entry && !payload) {
    return null;
  }

  return {
    id: entry?.id ?? null,
    uuid: entry?.uuid ?? (entry?.id ? `JournalEntry.${entry.id}` : null),
    name: payload?.name ?? entry?.name ?? null,
    parent: payload?.parent ?? null,
    subquests: Array.isArray(payload?.subquests) ? [...payload.subquests] : payload?.subquests ?? null
  };
}

function findJournalDocument(journal, id) {
  if (!journal || !id) {
    return null;
  }

  if (typeof journal.get === "function") {
    const found = journal.get(id);
    if (found) return found;
  }

  return toArray(journal).find((doc) => doc?.id === id || doc?._id === id) ?? null;
}

function getFqlPayload(entry) {
  if (!entry) {
    return null;
  }

  // Read the raw flag rather than `entry.getFlag(...)`: Foundry rejects flag scopes whose
  // module is not active, and FQL cannot be activated on v14. See quest-import-fql.js.
  return entry.flags?.[FQL_MODULE_ID]?.[FQL_FLAG_KEY] ?? null;
}

async function setFqlPayload(entry, payload) {
  // `setFlag` performs the same active-scope validation as `getFlag` and would throw for
  // the FQL scope on v14. `update()` with an explicit flag path does not validate scope.
  // This is exactly what `setFlag` does internally, minus the scope check.
  if (typeof entry.update === "function") {
    await entry.update({ flags: { [FQL_MODULE_ID]: { [FQL_FLAG_KEY]: payload } } });
    return;
  }

  entry.flags ??= {};
  entry.flags[FQL_MODULE_ID] ??= {};
  entry.flags[FQL_MODULE_ID][FQL_FLAG_KEY] = payload;
}

function summarizeBatchStatus(results) {
  if (!results.length) {
    return "no-op";
  }

  if (results.some((result) => result.status === QUEST_PATCH_APPLY_STATUS.failed)) {
    return QUEST_PATCH_APPLY_STATUS.failed;
  }

  if (results.some((result) => result.status === QUEST_PATCH_APPLY_STATUS.blocked)) {
    return QUEST_PATCH_APPLY_STATUS.blocked;
  }

  if (results.every((result) => result.status === QUEST_PATCH_APPLY_STATUS.dryRun)) {
    return QUEST_PATCH_APPLY_STATUS.dryRun;
  }

  if (results.every((result) => result.status === QUEST_PATCH_APPLY_STATUS.alreadyFixed)) {
    return QUEST_PATCH_APPLY_STATUS.alreadyFixed;
  }

  return "completed";
}

function makeIssue(code, severity, path, message) {
  return {
    code,
    severity,
    path,
    message
  };
}

function withoutKey(value, key) {
  const copy = cloneData(value);
  if (copy && typeof copy === "object") {
    delete copy[key];
  }
  return copy;
}

function stableJson(value) {
  return JSON.stringify(value ?? null);
}

function resolveNow(now) {
  if (typeof now === "function") {
    return now();
  }

  return now ?? new Date().toISOString();
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
