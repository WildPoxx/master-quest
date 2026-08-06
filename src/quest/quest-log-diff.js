/**
 * DEC-032, revista na 0.23: o diff que alimenta o Log.
 *
 * Uma funcao pura, chamada pelo commit() da janela de Quest: compara a quest antes e
 * depois de uma mutacao e devolve as linhas de log correspondentes. Central de proposito —
 * nenhum handler precisa lembrar de logar, entao nenhum handler esquece. E a mesma
 * filosofia do merge unico: a regra mora num lugar so.
 *
 * O QUE ENTRA NO LOG (Mario, 2026-08-06): so o CONSOLIDADO — mudancas de FICCAO.
 * Completar/falhar objetivo, conceder recompensa, achar pista, resolver dilema, incidir
 * complicacao, ocorrer desfecho, mudar o eixo diegetico `known`, mudar o status da quest.
 *
 * O QUE NAO ENTRA: gerenciamento de painel. Ocultar/exibir (`hidden`) e curadoria de
 * spoiler, nao acontecimento; adicionar/remover item e edicao da estrutura, nao ficcao.
 * O log e o registro da campanha, nao a trilha de auditoria da interface.
 *
 * A RAZAO nasce vazia e visivelmente pendente, preenchida pelo Mestre na aba Log —
 * exigir o motivo no clique quebraria o gesto unico da DEC-031.
 */

import { makeId } from "./quest-schema.js";

const toArray = (value) => (Array.isArray(value) ? value : []);

/** Campos rastreados por colecao, com o par de verbos de cada booleano. FICCAO apenas. */
const TRACKED = {
  objectives: {
    label: "objective",
    booleans: { known: ["now known", "no longer known"], completed: ["completed", "completion undone"], failed: ["failed", "failure undone"] }
  },
  rewards: {
    label: "reward",
    booleans: { known: ["now known", "no longer known"], granted: ["granted", "grant undone"] }
  },
  clues: {
    label: "clue",
    booleans: { known: ["now known", "no longer known"], found: ["found", "found undone"] }
  },
  dilemmas: {
    label: "dilemma",
    booleans: { known: ["now known", "no longer known"] },
    states: { state: true }
  },
  complications: {
    label: "complication",
    booleans: { known: ["now known", "no longer known"], fired: ["fired", "fire undone"] }
  },
  outcomes: {
    label: "outcome",
    booleans: { known: ["now known", "no longer known"], occurred: ["occurred", "occurrence undone"] }
  }
};

function entry(at, target, targetType, change, session) {
  return { id: makeId(), at, target, targetType, change, reason: "", session: session ?? null, origin: "auto" };
}

/**
 * @param {object} before A quest como estava.
 * @param {object} after A quest como ficou.
 * @param {number} at Epoch ms do momento da mudanca.
 * @param {number|null} [session] Numero da sessao corrente, para o carimbo (0.23).
 * @returns {object[]} Linhas de log; vazio se nada de FICCAO mudou.
 */
export function diffQuestForLog(before, after, at, session = null) {
  const entries = [];
  if (!before || !after) return entries;

  if (before.status !== after.status) {
    entries.push(entry(at, after.name ?? "", "quest", `status: ${before.status} → ${after.status}`, session));
  }

  for (const [collection, spec] of Object.entries(TRACKED)) {
    const olds = new Map(toArray(before[collection]).map((item) => [item.id, item]));
    const news = new Map(toArray(after[collection]).map((item) => [item.id, item]));

    for (const [id, item] of news) {
      const old = olds.get(id);
      // Item novo nao gera linha: adicionar e edicao de estrutura, nao ficcao.
      if (!old) continue;
      for (const [field, [on, off]] of Object.entries(spec.booleans)) {
        if (old[field] !== item[field]) entries.push(entry(at, item.name ?? "", spec.label, item[field] ? on : off, session));
      }
      for (const field of Object.keys(spec.states ?? {})) {
        if (old[field] !== item[field]) entries.push(entry(at, item.name ?? "", spec.label, `${old[field]} → ${item[field]}`, session));
      }
    }
    // Item removido tampouco: o log nao vigia o painel.
  }

  return entries;
}

/**
 * Export Markdown do log inteiro, agrupado por SESSAO (0.23). Entradas sem carimbo de
 * sessao (anteriores a 0.23, ou manuais sem sessao aberta) caem no grupo inicial.
 *
 * @param {string} questName Nome da quest.
 * @param {object[]} log As linhas do log.
 * @param {object[]} [sessions] `quest.sessions` para dar titulo aos grupos.
 */
export function logToMarkdown(questName, log, sessions = []) {
  const byNumber = new Map(toArray(sessions).map((s) => [s.number, s]));
  const lines = [`# Log — ${questName}`, ""];
  let group;
  for (const item of toArray(log)) {
    const key = item.session ?? null;
    if (key !== group || lines.length === 2) {
      group = key;
      lines.push(`## ${sessionHeading(key, byNumber.get(key))}`, "");
    }
    lines.push(`- **${item.target}** (${item.targetType}) — ${item.change}${item.reason ? ` — _${item.reason}_` : " — _reason pending_"}`);
  }
  return lines.join("\n");
}

/** "Session 3 — 2026-08-06 — A sombra no cofre", degradando com o que houver. */
export function sessionHeading(number, session) {
  if (number == null) return "Before session records";
  const parts = [`Session ${number}`];
  if (session?.date) parts.push(session.date);
  if (session?.title) parts.push(session.title);
  return parts.join(" — ");
}
