/**
 * Ponto unico de mesclagem entre FONTE (blueprint, rascunho de autoria) e MESA (o que esta
 * gravado no JournalEntry).
 *
 * HISTORICO — vale ler antes de mexer aqui.
 * Ate a 0.19.2 existiam DOIS merges independentes, `mergeDraftIntoQuest` e
 * `mergeBlueprintIntoQuest`, cada um com sua propria lista do que a MESA preserva. Listar o
 * que se preserva e frageil por construcao: quem acrescenta campo ao schema tem de lembrar
 * de acrescenta-lo em duas listas, e ninguem lembrou. O resultado, medido na 0.19.2:
 *
 *   mergeDraftIntoQuest       perdia rewards, gmcomments, designId, type, image,
 *                             splash, splashPos, splashAsIcon, activationTriggers,
 *                             journalLinks
 *   mergeBlueprintIntoQuest   perdia rewards, gmcomments, objectives[].hidden,
 *                             location, image, splashPos, splashAsIcon
 *
 * `designId` era o mais grave: e a chave pela qual a reimportacao reconhece a quest, e
 * regravar um rascunho a apagava — a quest deixava de ser reconhecida pela propria fonte.
 * `gmcomments` era o mais caro: e o GM Notes, territorio do Mestre pela DEC-028.
 *
 * A regra agora e INVERTIDA e mora num lugar so: declara-se o que a FONTE pode
 * sobrescrever. Todo o resto sobrevive do documento atual, por default. Campo novo no
 * schema nasce, portanto, pertencendo a mesa — que e o lado seguro do erro.
 *
 * O teste `master-quest-merge.test.js` enumera o schema e falha quando aparece campo que
 * nao esteja em nenhuma das listas deste arquivo. E o que impede a reincidencia.
 */

import { normalizeQuest, normalizeObjective, normalizeReward, normalizeDilemma, normalizeComplication, normalizeClue, normalizeOutcome } from "./quest-schema.js";

const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const toArray = (value) => (Array.isArray(value) ? value : []);

/**
 * Campos de quest que o rascunho de autoria governa. O rascunho e uma ferramenta de
 * redacao: ele manda no texto e nas colecoes que o autor escreve, e em nada mais.
 */
export const AUTHORED_BY_DRAFT = Object.freeze({
  quest: Object.freeze(["name", "description", "gmnotes"]),
  objective: Object.freeze(["name"]),
  reward: Object.freeze(["name", "type", "img", "uuid", "data"]),
  // `severity` do dilema (0.23) e autoral como a da complicacao: quanto pesa a pergunta
  // e decisao de design, escrita na fonte.
  dilemma: Object.freeze(["name", "table", "severity"]),
  complication: Object.freeze(["name", "trigger", "severity"]),
  clue: Object.freeze(["name"]),
  outcome: Object.freeze(["name", "table"])
});

/**
 * Campos de quest que o blueprint governa. Alem do texto, o blueprint e a fonte da
 * estrutura: tipo, prioridade, gatilhos e vinculos de journal.
 *
 * `designId` entra porque o blueprint e quem o atribui — e, como a quest existente foi
 * encontrada POR ele, o valor autorado e o mesmo que ja esta gravado.
 */
export const AUTHORED_BY_BLUEPRINT = Object.freeze({
  quest: Object.freeze([
    "name", "type", "description", "gmnotes", "priority",
    "activationTriggers", "journalLinks", "designId"
  ]),
  objective: Object.freeze(["name"]),
  reward: Object.freeze(["name", "type", "img", "uuid", "data"]),
  dilemma: Object.freeze(["name", "table", "severity"]),
  complication: Object.freeze(["name", "trigger", "severity"]),
  clue: Object.freeze(["name"]),
  outcome: Object.freeze(["name", "table"])
});

/**
 * Campos que sao da MESA em qualquer caminho, e que nenhuma fonte pode sobrescrever.
 * Esta lista nao e usada pelo merge — ele preserva tudo que nao esta nas listas acima.
 * Ela existe para o teste de enumeracao e para a leitura humana: e a declaracao explicita
 * de quem manda em cada campo do schema.
 */
export const TABLE_OWNED = Object.freeze({
  quest: Object.freeze([
    "schemaVersion", "status", "giver", "giverData", "giverName", "image",
    "gmcomments", "playernotes", "splash", "splashPos", "splashAsIcon",
    // `sessions` e `wrappedUp` (0.23): tempo de mesa e encerramento editorial — nenhuma
    // fonte sabe em que sessao a campanha esta, nem quando o Mestre fechou o caderno.
    "location", "parent", "subquests", "date", "source", "log", "sessions", "wrappedUp"
  ]),
  objective: Object.freeze(["id", "completed", "failed", "hidden", "known"]),
  reward: Object.freeze(["id", "hidden", "granted", "known", "locked"]),
  // `state`/`resolution`/`occurred`/`record`/`found`/`fired` sao o vivido; a fonte
  // governa so a definicao (nome, tabela, gatilho, severidade).
  dilemma: Object.freeze(["id", "state", "resolution", "hidden", "known"]),
  complication: Object.freeze(["id", "fired", "hidden", "known"]),
  clue: Object.freeze(["id", "found", "hidden", "known"]),
  outcome: Object.freeze(["id", "occurred", "record", "hidden", "known"])
});

/**
 * Sobrescreve, num alvo, apenas os campos que a fonte governa.
 *
 * @param {object} table O lado da mesa (base: tudo sobrevive daqui).
 * @param {object} authored O lado da fonte.
 * @param {readonly string[]} fields Campos que a fonte governa.
 * @returns {object} O objeto mesclado.
 */
function overlay(table, authored, fields) {
  const merged = { ...table };
  for (const field of fields) merged[field] = authored[field];
  return merged;
}

/**
 * Mescla uma colecao item a item, casando pela chave dada.
 *
 * Item que a mesa tem e a fonte nao lista mais NAO e apagado: sobrevive ao fim da lista e
 * volta em `orphans`, para quem chamou reportar. Apagar em silencio estado que a mesa ja
 * viu seria o mesmo defeito que este arquivo existe para corrigir, so que ao contrario.
 *
 * @returns {{items: object[], orphans: object[]}} A colecao mesclada e os orfaos.
 */
function mergeCollection(tableItems, authoredItems, { fields, keyOf, normalize }) {
  const byKey = new Map(toArray(tableItems).map((item) => [keyOf(item), item]));
  const authoredKeys = new Set(toArray(authoredItems).map(keyOf));

  const items = toArray(authoredItems).map((authored) => {
    const previous = byKey.get(keyOf(authored));
    return previous ? normalize(overlay(previous, authored, fields)) : normalize(authored);
  });

  const orphans = toArray(tableItems).filter((item) => !authoredKeys.has(keyOf(item)));
  return { items: [...items, ...orphans.map(normalize)], orphans };
}

const byId = (item) => item?.id ?? null;
const byName = (item) =>
  String(item?.name ?? "").trim().toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Mescla um payload autorado sobre a quest gravada, preservando o estado de mesa.
 *
 * @param {object|null} current A quest gravada hoje, se houver.
 * @param {object} authored O payload vindo da fonte, ja normalizado.
 * @param {object} options
 * @param {object} options.authoredBy `AUTHORED_BY_DRAFT` ou `AUTHORED_BY_BLUEPRINT`.
 * @param {"id"|"name"} [options.matchBy] Como casar itens das colecoes. O blueprint tem id
 *   estavel; o rascunho de autoria nao, e casa por nome normalizado.
 * @returns {{quest: object, orphans: {objectives: object[], rewards: object[]}}}
 */
export function mergeQuest(current, authored, { authoredBy, matchBy = "id" } = {}) {
  const empty = { objectives: [], rewards: [], dilemmas: [], complications: [], clues: [], outcomes: [] };
  if (!isRecord(current)) return { quest: normalizeQuest(authored), orphans: empty };
  if (!isRecord(authoredBy)) throw new TypeError("mergeQuest: authoredBy e obrigatorio");

  const keyOf = matchBy === "name" ? byName : byId;

  const objectives = mergeCollection(current.objectives, authored.objectives, {
    fields: authoredBy.objective,
    keyOf,
    normalize: normalizeObjective
  });

  const rewards = mergeCollection(current.rewards, authored.rewards, {
    fields: authoredBy.reward,
    keyOf,
    normalize: normalizeReward
  });

  const dilemmas = mergeCollection(current.dilemmas, authored.dilemmas, {
    fields: authoredBy.dilemma,
    keyOf,
    normalize: normalizeDilemma
  });

  const complications = mergeCollection(current.complications, authored.complications, {
    fields: authoredBy.complication,
    keyOf,
    normalize: normalizeComplication
  });

  const clues = mergeCollection(current.clues, authored.clues, {
    fields: authoredBy.clue,
    keyOf,
    normalize: normalizeClue
  });

  const outcomes = mergeCollection(current.outcomes, authored.outcomes, {
    fields: authoredBy.outcome,
    keyOf,
    normalize: normalizeOutcome
  });

  const merged = overlay(current, authored, authoredBy.quest);
  merged.objectives = objectives.items;
  merged.rewards = rewards.items;
  merged.dilemmas = dilemmas.items;
  merged.complications = complications.items;
  merged.clues = clues.items;
  merged.outcomes = outcomes.items;

  return {
    quest: normalizeQuest(merged),
    orphans: {
      objectives: objectives.orphans,
      rewards: rewards.orphans,
      dilemmas: dilemmas.orphans,
      complications: complications.orphans,
      clues: clues.orphans,
      outcomes: outcomes.orphans
    }
  };
}
