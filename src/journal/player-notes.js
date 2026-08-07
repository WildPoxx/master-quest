/**
 * DEC-038, primeira aplicacao: as notas do jogador moram no Journal.
 *
 * O MasterQuest e organizador e leitor. Conteudo de leitura e escrita livre mora em
 * documento de Journal do Foundry; o flag `master-quest` guarda estado, estrutura e
 * PONTEIROS. A quest passa a ter `playerNotesUuid` (a entrada) e cada sessao um
 * `pageUuid` (a pagina daquela sessao).
 *
 * Por que isto resolve o que nenhum desenho interno resolvia: o jogador e Observer na
 * quest e, por isso, nao pode gravar no JournalEntry dela — mas `JournalEntryPage` tem
 * `ownership` PROPRIO (core 14.365, `BaseJournalEntryPage.defineSchema`, campo
 * `ownership`, `DocumentOwnershipField` com default `INHERIT`, verificado em disco em
 * 2026-08-06). A DEC-005 permanece intacta: a QUEST segue Observer para o jogador.
 *
 * DEC-042 (2026-08-07) fixou o desenho de permissao do CADERNO, que e outro documento:
 *
 *   entrada   ownership.default = OWNER     porque criar pagina nova exige ser Owner da
 *                                           ENTRADA. Sem isso o jogador so escreve nas
 *                                           paginas que o modulo abriu por ele.
 *   pagina    default = OBSERVER            EXPLICITO, nao INHERIT. Valor declarado na
 *             + dono = OWNER                pagina nao herda o da entrada, e e o que
 *                                           impede cada jogador de editar o caderno dos
 *                                           outros — o defeito que o teste manual de
 *                                           2026-08-06 produzira.
 *
 * O ponto que so o Foundry vivo comprova: que o core respeite pagina OBSERVER dentro de
 * entrada OWNER. Se nao respeitar, degrada para heranca pura (todos Owner de tudo), que
 * funciona e nao perde nota — e o achado vira DEC de emenda. Passo de teste em mesa:
 * jogador A tentando editar a pagina do jogador B deve ser negado.
 *
 * Nada aqui escreve sem previa (DEC-004) e nada aqui APAGA documento: quest removida nao
 * arrasta a nota; orfao e reportado, nunca destruido — a mesma filosofia do `mergeQuest`.
 */

import { MODULE_ID } from "../constants.js";

const JOURNAL_ENTRY_TYPE = "JournalEntry";

/** Raiz de tudo que o modulo cria ou le como conteudo, na arvore de Journals. */
export const MASTERQUEST_FOLDER = "MasterQuest";
/** Subpasta das notas de jogador. Profundidade 2 — o core permite 4 (FOLDER_MAX_DEPTH). */
export const PLAYER_NOTES_FOLDER = "Player Notes";
/** Titulo da pagina que recebe o que ja existia em `playernotes` antes da migracao. */
export const LEGACY_PAGE_NAME = "Before session records";

export const OWNERSHIP = Object.freeze({ INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 });

/**
 * DEC-042: o desenho de permissao do caderno, num lugar so, para a previa (DEC-004) poder
 * ANUNCIA-LO e o teste poder trava-lo. Mudanca de permissao e o tipo de coisa que uma
 * previa nao pode omitir: e a parte irreversivel-por-descuido da operacao.
 */
export const PLAYER_NOTES_OWNERSHIP = Object.freeze({
  entry: OWNERSHIP.OWNER,
  pageDefault: OWNERSHIP.OBSERVER,
  pageOwner: OWNERSHIP.OWNER
});

const toArray = (value) => (Array.isArray(value) ? value : Array.from(value?.values?.() ?? []));
const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * Nome da entrada de notas de uma quest. Deriva do nome da quest para o Mestre a
 * reconhecer na arvore sem abrir.
 *
 * @param {object} quest A quest normalizada.
 * @returns {string} O nome da entrada.
 */
export function playerNotesEntryName(quest) {
  return `Player Notes — ${text(quest?.name) || "Quest"}`;
}

/**
 * Nome da pagina de uma sessao: numero, data e subtitulo, na ordem em que se le.
 *
 * Gerado pelo modulo de proposito. No teste manual de Mario (2026-08-06) as paginas foram
 * digitadas a mao e sairam "Sesseão 01" com `sort` arbitrario; nome derivado de
 * `sessions[]` nao erra de digitacao nem desordena.
 *
 * @param {object} session A sessao normalizada.
 * @returns {string} O nome da pagina.
 */
export function sessionPageName(session) {
  const parts = [`Session ${session?.number ?? 1}`];
  if (text(session?.date)) parts.push(text(session.date));
  if (text(session?.title)) parts.push(text(session.title));
  return parts.join(" — ");
}

/**
 * Previa da criacao (DEC-004): o que seria criado, sem escrever nada.
 *
 * @param {object} options
 * @param {object} options.quest A quest normalizada.
 * @param {object} [options.game] O game do Foundry.
 * @returns {object} `{status, entryName, folderPath, pages, ownership, existing}`.
 */
export function planPlayerNotes({ quest, game = globalThis.game } = {}) {
  if (!quest) {
    return {
      status: "no-quest",
      entryName: "",
      folderPath: "",
      pages: [],
      ownership: PLAYER_NOTES_OWNERSHIP,
      existing: null
    };
  }

  const entryName = playerNotesEntryName(quest);
  const existing = findEntryByUuidOrName({ uuid: quest.playerNotesUuid, name: entryName, game });
  const sessions = toArray(quest.sessions);

  const pages = sessions.map((session) => ({
    number: session.number,
    name: sessionPageName(session),
    exists: Boolean(session.pageUuid)
  }));

  // A prosa que ja estava no campo vira a primeira pagina — nada se perde na migracao.
  if (text(quest.playernotes)) pages.unshift({ number: null, name: LEGACY_PAGE_NAME, exists: false });

  return {
    status: existing ? "update" : "create",
    entryName,
    folderPath: `${MASTERQUEST_FOLDER} / ${PLAYER_NOTES_FOLDER}`,
    pages,
    ownership: PLAYER_NOTES_OWNERSHIP,
    existing: existing ? { uuid: entryUuid(existing), name: existing.name } : null
  };
}

/**
 * Cria (ou reaproveita) a entrada de notas da quest e devolve o ponteiro para gravar.
 *
 * @param {object} options
 * @param {object} options.quest A quest normalizada.
 * @param {object} [options.game] O game do Foundry.
 * @param {Function} [options.JournalEntry] Classe injetavel.
 * @param {Function} [options.Folder] Classe injetavel.
 * @returns {Promise<object>} `{status, uuid, entry}`.
 */
export async function ensurePlayerNotesEntry({
  quest,
  game = globalThis.game,
  JournalEntry = globalThis.JournalEntry,
  Folder = globalThis.Folder
} = {}) {
  if (!quest) return { status: "no-quest", uuid: null, entry: null };

  const entryName = playerNotesEntryName(quest);
  const existing = findEntryByUuidOrName({ uuid: quest.playerNotesUuid, name: entryName, game });
  if (existing) return { status: "reused", uuid: entryUuid(existing), entry: existing };

  if (typeof JournalEntry?.create !== "function") {
    return { status: "missing-journal-entry-create", uuid: null, entry: null };
  }

  const folder = await ensureNestedFolder({ game, Folder, path: [MASTERQUEST_FOLDER, PLAYER_NOTES_FOLDER] });

  // DEC-042: a ENTRADA nasce Owner para que o jogador possa CRIAR paginas proprias. O
  // isolamento entre cadernos nao vem daqui — vem do ownership explicito de cada pagina
  // (ver `ensureSessionPage`). Trocar este valor por OBSERVER devolve o jogador a condicao
  // de so escrever nas paginas que o modulo abriu por ele.
  const entry = await JournalEntry.create({
    name: entryName,
    folder: folder?.id ?? folder?._id ?? null,
    ownership: { default: OWNERSHIP.OWNER },
    flags: { [MODULE_ID]: { playerNotesFor: quest.id ?? null } }
  });

  return { status: "created", uuid: entryUuid(entry), entry };
}

/**
 * Garante a pagina de uma sessao dentro da entrada, com o dono certo.
 *
 * @param {object} options
 * @param {object} options.entry A entrada de Journal.
 * @param {object} options.session A sessao normalizada.
 * @param {string[]} [options.owners] Ids de usuario que recebem OWNER na pagina.
 * @param {string} [options.content] HTML inicial da pagina.
 * @returns {Promise<object>} `{status, uuid, page}`.
 */
export async function ensureSessionPage({ entry, session, owners = [], content = "" } = {}) {
  if (!entry || !session) return { status: "no-target", uuid: null, page: null };

  const name = sessionPageName(session);
  const pages = toArray(entry.pages);
  const existing = pages.find((page) => page?.name === name);
  if (existing) return { status: "reused", uuid: pageUuid(entry, existing), page: existing };

  if (typeof entry.createEmbeddedDocuments !== "function") {
    return { status: "missing-create-embedded", uuid: null, page: null };
  }

  // DEC-042: `default` EXPLICITO, nunca INHERIT. A entrada e Owner (para o jogador poder
  // criar paginas); herdar isso faria cada jogador dono do caderno de todos os outros.
  // Declarado na pagina, o valor menor prevalece sobre o do documento-mae.
  const ownership = { default: OWNERSHIP.OBSERVER };
  for (const userId of owners) ownership[userId] = OWNERSHIP.OWNER;

  const [page] = await entry.createEmbeddedDocuments("JournalEntryPage", [
    {
      name,
      type: "text",
      // `sort` derivado do numero da sessao: a ordem da lista e a ordem da campanha.
      sort: (session.number ?? 1) * 1000,
      title: { show: true, level: 1 },
      text: { format: 1, content: content || "" },
      ownership
    }
  ]);

  return { status: "created", uuid: pageUuid(entry, page), page };
}

/**
 * Anexa linhas ao fim de uma pagina, em HTML LIMPO.
 *
 * Um `<p>` por linha, sem `style` inline. O caminho manual (copiar do painel, colar no
 * editor) arrastava `<span style="scrollbar-color:...">` e colava as linhas umas nas
 * outras — visto no export de 2026-08-06. Escrever pelo modulo elimina os dois defeitos.
 *
 * Idempotencia: cada linha carrega o id da entrada de log de origem num comentario HTML,
 * e a que ja estiver la nao entra de novo. E o remedio para a linha duplicada observada
 * na Session 4 do teste de mesa.
 *
 * @param {object} options
 * @param {object} options.page A pagina de Journal.
 * @param {Array<{id: string, html: string}>} options.lines As linhas a acrescentar.
 * @returns {Promise<object>} `{status, appended, skipped}`.
 */
export async function appendToSessionPage({ page, lines = [] } = {}) {
  if (!page || typeof page.update !== "function") return { status: "no-page", appended: 0, skipped: 0 };

  const current = page.text?.content ?? "";
  const fresh = [];
  let skipped = 0;

  for (const line of lines) {
    const marker = `<!--mq:${line.id}-->`;
    if (line.id && current.includes(marker)) {
      skipped += 1;
      continue;
    }
    fresh.push(`<p>${line.html}${line.id ? marker : ""}</p>`);
  }

  if (!fresh.length) return { status: "nothing-to-append", appended: 0, skipped };

  await page.update({ text: { content: `${current}${fresh.join("")}` } });
  return { status: "appended", appended: fresh.length, skipped };
}

/**
 * Abre um documento de Journal pelo uuid, na pagina certa quando o uuid e de pagina.
 *
 * @param {string} uuid O uuid do documento.
 * @param {object} [options]
 * @returns {Promise<object>} `{status}`.
 */
export async function openJournalByUuid(uuid, { fromUuid = globalThis.fromUuid, ui = globalThis.ui } = {}) {
  if (!uuid || typeof fromUuid !== "function") return { status: "no-uuid" };
  try {
    const doc = await fromUuid(uuid);
    if (!doc) {
      ui?.notifications?.warn?.("MasterQuest: this note no longer exists in the world.");
      return { status: "missing" };
    }
    // Pagina: abre a entrada-mae ja posicionada nela.
    if (doc.parent?.sheet?.render) {
      doc.parent.sheet.render(true, { pageId: doc.id });
      return { status: "opened-page" };
    }
    doc.sheet?.render?.(true);
    return { status: "opened" };
  } catch (error) {
    console.error(`${MODULE_ID} | failed to open journal ${uuid}`, error);
    return { status: "failed" };
  }
}

/* ---------------------------------------------------------------------------------- *
 * Internos
 * ---------------------------------------------------------------------------------- */

function entryUuid(entry) {
  if (!entry) return null;
  return entry.uuid ?? (entry.id ? `JournalEntry.${entry.id}` : null);
}

function pageUuid(entry, page) {
  if (!page) return null;
  if (page.uuid) return page.uuid;
  const base = entryUuid(entry);
  return base && page.id ? `${base}.JournalEntryPage.${page.id}` : null;
}

function findEntryByUuidOrName({ uuid, name, game }) {
  const journal = toArray(game?.journal);
  if (uuid) {
    const byUuid = journal.find((entry) => entryUuid(entry) === uuid);
    if (byUuid) return byUuid;
  }
  return journal.find((entry) => entry?.name === name) ?? null;
}

/**
 * Cria a arvore de pastas do caminho, um nivel por vez, reaproveitando o que existir.
 * `FOLDER_MAX_DEPTH` do core e 4; o caminho usado aqui tem 2.
 */
async function ensureNestedFolder({ game, Folder, path }) {
  let parentId = null;
  let current = null;

  for (const name of path) {
    const folders = toArray(game?.folders);
    const existing = folders.find(
      (folder) =>
        folder?.name === name &&
        (!folder.type || folder.type === JOURNAL_ENTRY_TYPE) &&
        (folder.folder?.id ?? folder.folder ?? null) === parentId
    );

    if (existing) {
      current = existing;
    } else {
      if (typeof Folder?.create !== "function") return current;
      current = await Folder.create({ name, type: JOURNAL_ENTRY_TYPE, folder: parentId, sorting: "m" });
    }

    parentId = current?.id ?? current?._id ?? null;
  }

  return current;
}
