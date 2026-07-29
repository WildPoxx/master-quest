export function generateGMReport(questStates = [], { title = "Relatorio Privado do GM" } = {}) {
  const lines = [
    `# ${title}`,
    "",
    `Quests analisadas: ${questStates.length}`,
    "",
    "## Estado das quests"
  ];

  for (const quest of questStates) {
    lines.push("", `### ${quest.name}`, "");
    lines.push(`- Status: ${quest.status}`);
    lines.push(`- Visivel a jogadores: ${quest.visibility.playersVisible ? "sim" : "nao"}`);
    lines.push(`- Tasks: ${quest.tasks.length}`);
    lines.push(`- Rewards: ${quest.rewards.length}`);

    const pendingTasks = quest.tasks.filter((task) => !task.done && !task.failed);
    if (pendingTasks.length) {
      lines.push("- Pendencias:");
      for (const task of pendingTasks) {
        lines.push(`  - ${task.title || "(sem titulo)"}${task.gmOnly ? " [oculta]" : ""}`);
      }
    }

    if (quest.gmnotes) {
      lines.push("", "#### GM Notes", "", quest.gmnotes);
    }

    if (quest.playerNotes) {
      lines.push("", "#### Player Notes", "", quest.playerNotes);
    }

    if (quest.journalLinks.length) {
      lines.push("", "#### Links", "");
      for (const link of quest.journalLinks) {
        lines.push(`- ${link}`);
      }
    }
  }

  lines.push("", "## Safety", "");
  lines.push("- Este relatorio pode conter informacao privada do GM.");
  lines.push("- Nenhuma quest, task ou reward foi alterada.");

  return lines.join("\n");
}
