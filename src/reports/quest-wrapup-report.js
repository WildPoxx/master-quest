/**
 * 0.23 (Mario, 2026-08-06): o relatorio de encerramento — o Wrap Up.
 *
 * O snapshot e uma radiografia (JSON, estado bruto, para maquina). Este relatorio e a
 * ATA: Markdown legivel que conta o que a quest perguntou, o que a mesa fez, o que
 * encontrou, o que ganhou, o que o mundo cobrou e como terminou — na ordem canonica da
 * Details. Serve a tres leitores: o Mestre relendo a campanha, o jogador que quer o
 * resumo, e a IA de recap/follow-up que precisa do consolidado com as razoes.
 *
 * Leitura pura, como o snapshot: nada aqui grava documento, flag ou status. O gesto de
 * "Wrap Up" (a flag `wrappedUp`) mora na UI; este arquivo so ESCREVE O TEXTO.
 *
 * Duas camadas deliberadas:
 *  - FICCAO: o que aconteceu (visivel a qualquer leitor do relatorio);
 *  - METAJOGO ("Left on the table"): o que NAO aconteceu — pistas nao achadas,
 *    recompensas nao concedidas, desfechos possiveis que nao ocorreram. E o insumo do
 *    follow-up: subquest nova nasce do que ficou pendurado.
 */

import { QUEST_STATUS_LABEL } from "../quest/quest-schema.js";
import { sessionHeading } from "../quest/quest-log-diff.js";

const toArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Monta o relatorio consolidado em Markdown.
 *
 * @param {object} quest A quest normalizada.
 * @param {object} [options]
 * @param {string} [options.generatedAt] ISO timestamp, injetavel para testes.
 * @returns {string} O relatorio.
 */
export function buildWrapupReport(quest, { generatedAt = null } = {}) {
  if (!quest) return "";
  const lines = [];
  const push = (...xs) => lines.push(...xs);

  push(`# Wrap-Up — ${quest.name}`, "");
  push(`- **Status:** ${QUEST_STATUS_LABEL[quest.status] ?? quest.status}`);
  if (quest.designId) push(`- **Design id:** ${quest.designId}`);
  const sessions = toArray(quest.sessions);
  if (sessions.length) {
    const first = sessions[0];
    const last = sessions[sessions.length - 1];
    push(`- **Sessions:** ${sessions.length} (from ${describeSession(first)} to ${describeSession(last)})`);
  }
  push(`- **Generated:** ${generatedAt ?? new Date().toISOString()}`, "");

  // 1. Dilemmas — a pergunta que a quest pos (primeira secao, como na Details 0.23).
  const dilemmas = toArray(quest.dilemmas);
  if (dilemmas.length) {
    push(`## The question the quest posed`, "");
    for (const d of dilemmas) {
      const state = d.state === "resolved"
        ? `resolved${d.resolution ? ` — ${d.resolution}` : " (resolution not recorded)"}`
        : "left open";
      push(`- **${d.name}** _(severity: ${d.severity ?? "leve"})_ — ${state}`);
    }
    push("");
  }

  // 2. Objectives — o que a mesa fez.
  const objectives = toArray(quest.objectives);
  if (objectives.length) {
    push(`## What the party did`, "");
    for (const o of objectives) {
      const mark = o.completed ? "[x]" : o.failed ? "[!]" : "[ ]";
      const state = o.completed ? "" : o.failed ? " — failed" : " — left open";
      push(`- ${mark} ${o.name}${state}`);
    }
    push("");
  }

  // 3. Clues — o que a mesa encontrou (e o que ficou por achar).
  const clues = toArray(quest.clues);
  const found = clues.filter((c) => c.found);
  if (found.length) {
    push(`## What the party found`, "");
    for (const c of found) push(`- ${c.name}`);
    push("");
  }

  // 4. Rewards — o que ficou com a mesa.
  const rewards = toArray(quest.rewards);
  const granted = rewards.filter((r) => r.granted);
  if (granted.length) {
    push(`## What the party earned`, "");
    for (const r of granted) push(`- ${r.name}`);
    push("");
  }

  // 5. Complications — o que o mundo cobrou.
  const complications = toArray(quest.complications).filter((c) => c.fired);
  if (complications.length) {
    push(`## What the world did back`, "");
    for (const c of complications) {
      push(`- **${c.name}** _(severity: ${c.severity ?? "leve"})_${c.trigger ? ` — trigger: ${c.trigger}` : ""}`);
    }
    push("");
  }

  // 6. Outcomes — como terminou.
  const outcomes = toArray(quest.outcomes);
  const occurred = outcomes.filter((o) => o.occurred);
  if (occurred.length) {
    push(`## How it ended`, "");
    for (const o of occurred) push(`- **${o.name}**${o.record ? ` — ${o.record}` : " (record not written)"}`);
    push("");
  }

  // 7. Metajogo: o que ficou na mesa. Insumo de follow-up — subquest nova nasce daqui.
  const leftClues = clues.filter((c) => !c.found);
  const leftRewards = rewards.filter((r) => !r.granted);
  const leftOutcomes = outcomes.filter((o) => !o.occurred);
  if (leftClues.length || leftRewards.length || leftOutcomes.length) {
    push(`## Left on the table`, "");
    for (const c of leftClues) push(`- Clue never found: ${c.name}`);
    for (const r of leftRewards) push(`- Reward never granted: ${r.name}`);
    for (const o of leftOutcomes) push(`- Ending that did not come to pass: ${o.name}`);
    push("");
  }

  // 8. O log inteiro, por sessao, com as razoes — o consolidado que da sentido ao resto.
  const log = toArray(quest.log);
  if (log.length) {
    push(`## Session log`, "");
    const byNumber = new Map(sessions.map((s) => [s.number, s]));
    let group;
    let first = true;
    for (const item of log) {
      const key = item.session ?? null;
      if (first || key !== group) {
        group = key;
        first = false;
        push(`### ${sessionHeading(key, byNumber.get(key))}`, "");
      }
      push(`- **${item.target}** (${item.targetType}) — ${item.change}${item.reason ? ` — _${item.reason}_` : ""}`);
    }
    push("");
  }

  return lines.join("\n");
}

function describeSession(session) {
  if (!session) return "?";
  return `Session ${session.number}${session.date ? ` (${session.date})` : ""}`;
}

/**
 * Gera o relatorio e o entrega como download `.md`, no mesmo caminho degradavel do
 * snapshot: `saveDataToFile` do Foundry quando existe, ancora Blob quando nao, e em
 * ambiente sem download (teste, headless) devolve o payload mesmo assim.
 *
 * @param {object} quest A quest normalizada.
 * @param {object} [options] Injetaveis de teste + `generatedAt`.
 * @returns {object} `{status, filename, report}`.
 */
export function downloadWrapupReport(quest, options = {}) {
  const report = buildWrapupReport(quest, options);
  const filename = makeWrapupFilename(quest, options.generatedAt);
  const save = options.saveDataToFile ?? globalThis.saveDataToFile
    ?? globalThis.foundry?.utils?.saveDataToFile;

  if (typeof save === "function") {
    save(report, "text/markdown", filename);
    return { status: "downloaded", filename, report };
  }

  const doc = options.document ?? globalThis.document;
  const blobFactory = options.Blob ?? globalThis.Blob;
  const urlFactory = options.URL ?? globalThis.URL;

  if (!doc || typeof blobFactory !== "function" || typeof urlFactory?.createObjectURL !== "function") {
    return { status: "no-download-target", filename, report };
  }

  const url = urlFactory.createObjectURL(new blobFactory([report], { type: "text/markdown" }));
  const anchor = doc.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  doc.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  if (typeof urlFactory.revokeObjectURL === "function") {
    globalThis.setTimeout?.(() => urlFactory.revokeObjectURL(url), 1000);
  }

  return { status: "downloaded", filename, report };
}

/**
 * @param {object} quest A quest.
 * @param {string} [generatedAt] ISO timestamp.
 * @returns {string} A filesystem-safe filename.
 */
export function makeWrapupFilename(quest, generatedAt) {
  const slug = String(quest?.name ?? "quest")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48) || "quest";
  const stamp = String(generatedAt ?? new Date().toISOString()).replace(/[:.]/g, "-");
  return `masterquest-wrapup-${slug}-${stamp}.md`;
}
