export function markdownToHtml(markdown) {
  return `<pre class="olf-fql-report">${escapeHtml(markdown)}</pre>`;
}

export async function postGmWhisper({ content, alias = "MasterQuest", chatMessage = globalThis.ChatMessage } = {}) {
  if (!chatMessage?.create) {
    return null;
  }

  const recipients = typeof chatMessage.getWhisperRecipients === "function"
    ? chatMessage.getWhisperRecipients("GM").map((user) => user.id)
    : [];

  return chatMessage.create({
    speaker: { alias },
    whisper: recipients,
    content
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
