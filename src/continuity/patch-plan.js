import { QUEST_STATUS } from "../constants.js";

export function generatePatchPlan(questStates = [], { now = new Date().toISOString() } = {}) {
  const activeQuests = questStates.filter((quest) => quest.status === QUEST_STATUS.active);
  const questTopology = assessQuestTopology(questStates);
  const pendingTasks = questStates.flatMap((quest) =>
    quest.tasks
      .filter((task) => !task.done && !task.failed)
      .map((task) => ({
        questId: quest.id,
        questName: quest.name,
        taskId: task.id,
        title: task.title,
        hidden: !task.visible
      }))
  );

  const lockedRewards = questStates.flatMap((quest) =>
    quest.rewards
      .filter((reward) => reward.locked)
      .map((reward) => ({
        questId: quest.id,
        questName: quest.name,
        rewardId: reward.id,
        title: reward.title,
        hidden: !reward.visible
      }))
  );

  return {
    schemaVersion: 1,
    mode: "dry-run",
    requiresHumanApproval: true,
    generatedAt: now,
    questCount: questStates.length,
    proposedChanges: questTopology.proposedChanges,
    observations: {
      activeQuestCount: activeQuests.length,
      questTopologyIssues: questTopology.issues,
      pendingTasks,
      lockedRewards
    },
    safety: [
      "No data was changed.",
      "No quest was completed.",
      "No task was marked.",
      "No reward was granted.",
      "Any future patch must show preview and require GM confirmation."
    ]
  };
}

function assessQuestTopology(questStates) {
  const questsById = new Map(
    questStates
      .filter((quest) => typeof quest.id === "string" && quest.id.length > 0)
      .map((quest) => [quest.id, quest])
  );

  const issues = [];
  const proposedChanges = [];

  for (const quest of questStates) {
    if (!quest?.id) {
      continue;
    }

    const parentId = typeof quest.parent === "string" && quest.parent.length > 0
      ? quest.parent
      : null;

    if (parentId) {
      const parentQuest = questsById.get(parentId);

      if (!parentQuest) {
        issues.push({
          code: "missing-parent",
          severity: "error",
          questId: quest.id,
          questName: quest.name,
          parentId,
          summary: `Quest "${quest.name}" points to parent "${parentId}", but that parent is absent from the read model.`
        });
      } else if (!toIdArray(parentQuest.subquests).includes(quest.id)) {
        const issue = {
          code: "parent-missing-child-link",
          severity: "warning",
          questId: quest.id,
          questName: quest.name,
          parentId,
          parentName: parentQuest.name,
          summary: `Quest "${quest.name}" points to "${parentQuest.name}" as parent, but the parent does not list it as a subquest.`
        };

        issues.push(issue);
        proposedChanges.push({
          type: "quest-tree-repair",
          operation: "append-subquest-id",
          status: "recommended",
          targetQuestId: parentQuest.id,
          targetQuestName: parentQuest.name,
          childQuestId: quest.id,
          childQuestName: quest.name,
          path: "flags.forien-quest-log.json.subquests",
          valueToAppend: quest.id,
          reason: issue.summary,
          safeBecause: [
            "The child already points to this parent.",
            "The repair only adds the missing child id to the parent subquests list.",
            "No quest status, task, reward, note, or ownership value is changed."
          ],
          requiresHumanApproval: true
        });
      }
    }

    for (const childId of toIdArray(quest.subquests)) {
      const childQuest = questsById.get(childId);

      if (!childQuest) {
        issues.push({
          code: "missing-subquest",
          severity: "error",
          questId: quest.id,
          questName: quest.name,
          childQuestId: childId,
          summary: `Quest "${quest.name}" lists subquest "${childId}", but that subquest is absent from the read model.`
        });
      } else if (childQuest.parent !== quest.id) {
        issues.push({
          code: "child-parent-mismatch",
          severity: "warning",
          questId: quest.id,
          questName: quest.name,
          childQuestId: childQuest.id,
          childQuestName: childQuest.name,
          childParentId: childQuest.parent,
          summary: `Quest "${quest.name}" lists "${childQuest.name}" as subquest, but the child points to a different parent.`
        });
      }
    }
  }

  return {
    issues,
    proposedChanges
  };
}

function toIdArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0) : [];
}
