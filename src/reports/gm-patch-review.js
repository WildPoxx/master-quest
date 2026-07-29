export function generateGMPatchReview(
  patchPlan,
  questStates = [],
  { title = "MasterQuest - Revisao GM do Patch Plan" } = {}
) {
  const statusCounts = countBy(questStates, (quest) => quest.status);
  const totals = summarizeQuestTotals(questStates);
  const topologyIssues = patchPlan?.observations?.questTopologyIssues ?? [];
  const proposedChanges = patchPlan?.proposedChanges ?? [];
  const missingOlfFlags = questStates.filter((quest) => !quest.olfFlags);
  const noteCasingDuplications = questStates.filter((quest) => hasDuplicatedNoteCasing(quest.source));
  const lockedRewardQuests = questStates
    .map((quest) => ({
      quest,
      lockedRewards: quest.rewards.filter((reward) => reward.locked),
      hiddenRewards: quest.rewards.filter((reward) => !reward.visible)
    }))
    .filter((entry) => entry.lockedRewards.length || entry.hiddenRewards.length);

  const lines = [
    `# ${title}`,
    "",
    `Gerado em: ${patchPlan?.generatedAt ?? "(sem data)"}`,
    "",
    "## Resumo",
    "",
    `- Modo: ${patchPlan?.mode ?? "(desconhecido)"}`,
    `- Exige aprovacao humana: ${patchPlan?.requiresHumanApproval ? "sim" : "nao"}`,
    `- Quests analisadas: ${questStates.length}`,
    `- Recomendacoes de patch: ${proposedChanges.length}`,
    `- Problemas de topologia: ${topologyIssues.length}`,
    `- Quests sem flags OLF: ${missingOlfFlags.length}`,
    `- Quests com notas duplicadas por caixa: ${noteCasingDuplications.length}`,
    "",
    "## Status das quests",
    "",
    `- Active: ${statusCounts.active ?? 0}`,
    `- Inactive: ${statusCounts.inactive ?? 0}`,
    `- Completed: ${statusCounts.completed ?? 0}`,
    `- Failed: ${statusCounts.failed ?? 0}`,
    `- Unknown: ${statusCounts.unknown ?? 0}`,
    "",
    "## Totais operacionais",
    "",
    `- Tasks: ${totals.tasks}`,
    `- Tasks pendentes: ${totals.pendingTasks}`,
    `- Tasks falhadas: ${totals.failedTasks}`,
    `- Tasks ocultas: ${totals.hiddenTasks}`,
    `- Rewards: ${totals.rewards}`,
    `- Rewards locked: ${totals.lockedRewards}`,
    `- Rewards ocultas: ${totals.hiddenRewards}`,
    ""
  ];

  appendRecommendedPatches(lines, proposedChanges);
  appendTopologyIssues(lines, topologyIssues);
  appendMissingOlfFlags(lines, missingOlfFlags);
  appendNoteCasing(lines, noteCasingDuplications);
  appendRewardReview(lines, lockedRewardQuests);
  appendSafety(lines, patchPlan?.safety ?? []);

  return lines.join("\n");
}

function appendRecommendedPatches(lines, proposedChanges) {
  lines.push("## Recomendacoes de patch", "");

  if (!proposedChanges.length) {
    lines.push("- Nenhuma recomendacao de alteracao foi gerada.", "");
    return;
  }

  for (const change of proposedChanges) {
    lines.push(`### ${change.operation ?? change.type}`);
    lines.push("");
    lines.push(`- Tipo: ${change.type}`);
    lines.push(`- Status: ${change.status}`);
    lines.push(`- Alvo: ${change.targetQuestName ?? change.targetQuestId}`);
    lines.push(`- Filho: ${change.childQuestName ?? change.childQuestId}`);
    lines.push(`- Caminho: ${change.path}`);
    lines.push(`- Valor a adicionar: ${change.valueToAppend}`);
    lines.push(`- Motivo: ${change.reason}`);
    lines.push(`- Exige aprovacao humana: ${change.requiresHumanApproval ? "sim" : "nao"}`);

    if (Array.isArray(change.safeBecause) && change.safeBecause.length) {
      lines.push("- Por que e seguro como proposta:");
      for (const reason of change.safeBecause) {
        lines.push(`  - ${reason}`);
      }
    }

    lines.push("");
  }
}

function appendTopologyIssues(lines, topologyIssues) {
  lines.push("## Problemas de topologia", "");

  if (!topologyIssues.length) {
    lines.push("- Nenhum problema de arvore pai/subquest detectado.", "");
    return;
  }

  for (const issue of topologyIssues) {
    lines.push(`- [${issue.severity}] ${issue.code}: ${issue.summary}`);
  }

  lines.push("");
}

function appendMissingOlfFlags(lines, quests) {
  lines.push("## Quests sem flags OLF", "");

  if (!quests.length) {
    lines.push("- Todas as quests analisadas possuem flags OLF paralelas.", "");
    return;
  }

  for (const quest of quests) {
    lines.push(`- ${quest.name} (${quest.id})`);
  }

  lines.push("");
}

function appendNoteCasing(lines, quests) {
  lines.push("## Notas duplicadas por caixa", "");

  if (!quests.length) {
    lines.push("- Nenhuma duplicacao `gmnotes/gmNotes` ou `playernotes/playerNotes` detectada.", "");
    return;
  }

  lines.push("- O leitor normaliza esses campos para uso interno e preserva o payload original.");
  for (const quest of quests) {
    lines.push(`- ${quest.name} (${quest.id})`);
  }

  lines.push("");
}

function appendRewardReview(lines, rewardEntries) {
  lines.push("## Rewards locked/ocultas", "");

  if (!rewardEntries.length) {
    lines.push("- Nenhuma reward locked ou oculta detectada.", "");
    return;
  }

  for (const { quest, lockedRewards, hiddenRewards } of rewardEntries) {
    lines.push(`- ${quest.name}: ${lockedRewards.length} locked, ${hiddenRewards.length} ocultas`);
  }

  lines.push("", "Observacao: rewards locked/ocultas sao estado de campanha. Este relatorio nao recomenda destravar ou revelar automaticamente.", "");
}

function appendSafety(lines, safety) {
  lines.push("## Safety", "");

  for (const entry of safety) {
    lines.push(`- ${entry}`);
  }

  lines.push("- Este relatorio e somente leitura.");
  lines.push("- Nenhuma alteracao deve ser aplicada sem backup e confirmacao GM.");
}

function summarizeQuestTotals(questStates) {
  return questStates.reduce(
    (totals, quest) => {
      totals.tasks += quest.tasks.length;
      totals.pendingTasks += quest.tasks.filter((task) => !task.done && !task.failed).length;
      totals.failedTasks += quest.tasks.filter((task) => task.failed).length;
      totals.hiddenTasks += quest.tasks.filter((task) => !task.visible).length;
      totals.rewards += quest.rewards.length;
      totals.lockedRewards += quest.rewards.filter((reward) => reward.locked).length;
      totals.hiddenRewards += quest.rewards.filter((reward) => !reward.visible).length;
      return totals;
    },
    {
      tasks: 0,
      pendingTasks: 0,
      failedTasks: 0,
      hiddenTasks: 0,
      rewards: 0,
      lockedRewards: 0,
      hiddenRewards: 0
    }
  );
}

function hasDuplicatedNoteCasing(source = {}) {
  return (
    (hasOwn(source, "gmnotes") && hasOwn(source, "gmNotes")) ||
    (hasOwn(source, "playernotes") && hasOwn(source, "playerNotes"))
  );
}

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function countBy(values, getKey) {
  return values.reduce((counts, value) => {
    const key = getKey(value) ?? "unknown";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

