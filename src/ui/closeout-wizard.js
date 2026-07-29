import { markdownToHtml, postGmWhisper } from "../foundry/chat.js";
import { notifyInfo } from "../foundry/environment.js";

export async function startCloseoutWizard({ api, game, ui, postToChat = true } = {}) {
  const questStates = api.readQuestStates();
  const gmReport = api.generateGMReport({ questStates });
  const playerRecap = api.generatePlayerRecap({ questStates });
  const patchPlan = api.generatePatchPlan({ questStates });

  if (postToChat && game?.user?.isGM) {
    await postGmWhisper({
      content: markdownToHtml(gmReport),
      chatMessage: globalThis.ChatMessage
    });
  }

  notifyInfo("MasterQuest closeout preview generated in read-only mode.", ui);

  return {
    applied: false,
    mode: "read-only",
    questStates,
    gmReport,
    playerRecap,
    patchPlan
  };
}
