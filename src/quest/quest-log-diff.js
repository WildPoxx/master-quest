/**
 * DEC-032: o diff que alimenta o Log.
 *
 * Uma funcao pura, chamada pelo commit() da janela de Quest: compara a quest antes e
 * depois de uma mutacao e devolve as linhas de log correspondentes. Central de proposito —
 * nenhum handler precisa lembrar de logar, entao nenhum handler esquece. E a mesma
 * filosofia do merge unico: a regra mora num lugar so.
 *
 * O log registra o QUE mudou e DE ONDE veio; a RAZAO nasce vazia e visivelmente
 * pendente, preenchida pelo Mestre na aba Log — exigir o motivo no clique quebraria o
 * gesto unico da DEC-031.
 */

import { makeId } from "./quest-schema.js";

const toArray = (value) => (Array.isArray(value) ? value : []);

/** Campos rastreados por colecao, com o par de verbos de cada booleano. */
const TRACKED = {
  objectives: {
    label: "objective",
    booleans: { hidden: ["hidden", "revealed"], known: ["now known", "no longer known"], completed: ["completed", "completion undone"], failed: ["failed", "failure undone"] }
  },
  rewards: {
    label: "reward",
    booleans: { hidden: ["hidden", "revealed"], known: ["now known", "no longer known"], granted: ["granted", "grant undone"] }
  },
  clues: {
    label: "clue",
    booleans: { hidden: ["hidden", "revealed"], known: ["now known", "no longer known"], found: ["found", "found undone"] }
  },
  dilemmas: {
    label: "dilemma",
    booleans: { hidden: ["hidden", "revealed"], known: ["now known", "no longer known"] },
    states: { state: true }
  },
  complications: {
    label: "complication",
    booleans: { hidden: ["hidden", "revealed"], known: ["now known", "no longer known"], fired: ["fired", "fire undone"] }
  },
  outcomes: {
    label: "outcome",
    booleans: { hidden: ["hidden", "revealed"], known: ["now known", "no longer known"], occurred: ["occurred", "occurrence undone"] }
  }
};

function entry(at, target, targetType, change) {
  return { id: makeId(), at, target, targetType, change, reason: "" };
}

/**
 * @param {object} before A quest como estava.
 * @param {object} after A quest como ficou.
 * @param {number} at Epoch ms do momento da mudanca.
 * @returns {object[]} Linhas de log; vazio se nada rastreado mudou.
 */
export function diffQuestForLog(before, after, at) {
  const entries = [];
  if (!before || !after) return entries;

  if (before.status !== after.status) {
    entries.push(entry(at, after.name ?? "", "quest", `status: ${before.status} \u2192 ${after.status}`));
  }

  for (const [collection, spec] of Object.entries(TRACKED)) {
    const olds = new Map(toArray(before[collection]).map((item) => [item.id, item]));
    const news = new Map(toArray(after[collection]).map((item) => [item.id, item]));

    for (const [id, item] of news) {
      const old = olds.get(id);
      if (!old) {
        entries.push(entry(at, item.name ?? "", spec.label, "added"));
        continue;
      }
      for (const [field, [on, off]] of Object.entries(spec.booleans)) {
        if (old[field] !== item[field]) entries.push(entry(at, item.name ?? "", spec.label, item[field] ? on : off));
      }
      for (const field of Object.keys(spec.states ?? {})) {
        if (old[field] !== item[field]) entries.push(entry(at, item.name ?? "", spec.label, `${old[field]} \u2192 ${item[field]}`));
      }
    }

    for (const [id, old] of olds) {
      if (!news.has(id)) entries.push(entry(at, old.name ?? "", spec.label, "removed"));
    }
  }

  return entries;
}

/** Export Markdown do log inteiro, agrupado por dia. */
export function logToMarkdown(questName, log) {
  const lines = [`# Log \u2014 ${questName}`, ""];
  let day = "";
  for (const item of toArray(log)) {
    const d = item.at ? new Date(item.at).toISOString().slice(0, 10) : "undated";
    if (d !== day) {
      day = d;
      lines.push(`## ${day}`, "");
    }
    lines.push(`- **${item.target}** (${item.targetType}) \u2014 ${item.change}${item.reason ? ` \u2014 _${item.reason}_` : " \u2014 _reason pending_"}`);
  }
  return lines.join("\n");
}
