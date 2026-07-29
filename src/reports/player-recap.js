import { QUEST_STATUS } from "../constants.js";

export function generatePlayerRecap(questStates = [], { title = "Anteriormente em Lost Frontier..." } = {}) {
  const publicQuests = questStates.filter((quest) =>
    quest.visibility.playersVisible && quest.status !== QUEST_STATUS.inactive
  );

  const lines = [
    `# ${title}`,
    "",
    "## O que voces sabem"
  ];

  if (!publicQuests.length) {
    lines.push("", "Nenhuma quest publica foi detectada para este resumo.");
  }

  for (const quest of publicQuests) {
    lines.push("", `### ${quest.name}`, "");

    if (quest.playerNotes) {
      lines.push(quest.playerNotes, "");
    } else if (quest.description) {
      lines.push(quest.description, "");
    }

    const visibleTasks = quest.tasks.filter((task) => task.visible);
    if (visibleTasks.length) {
      lines.push("#### Objetivos conhecidos");
      for (const task of visibleTasks) {
        const state = task.done ? "concluido" : task.failed ? "falhou" : "pendente";
        lines.push(`- ${task.title || "(sem titulo)"}: ${state}`);
      }
      lines.push("");
    }

    const visibleRewards = quest.rewards.filter((reward) => reward.visible && !reward.locked);
    if (visibleRewards.length) {
      lines.push("#### Recompensas manifestas");
      for (const reward of visibleRewards) {
        lines.push(`- ${reward.title || "(sem titulo)"}`);
      }
      lines.push("");
    }
  }

  lines.push("## Safety", "");
  lines.push("- Este resumo exclui GM Notes, quests ocultas, tasks ocultas e rewards ocultas ou bloqueadas.");

  return lines.join("\n");
}
