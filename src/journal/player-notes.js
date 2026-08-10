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
/** Subpasta das notas de jogador na raiz do modulo. Hoje so a QUEDA usa este caminho. */
export const PLAYER_NOTES_FOLDER = "Player Notes";
/**
 * A morada nova (Mario, 2026-08-08): o caderno nasce DENTRO da pasta da aventura, numa
 * subpasta com este nome — que veio dele, e nao do modulo: ele a criou a mao no mundo
 * antes de pedir a mudanca.
 *
 * Emenda a resposta que ele mesmo dera em 2026-08-06 (DEC-038), depois de ver o resultado
 * em mesa. O motivo, na leitura do Design: o caderno e materia DAQUELA aventura, nao
 * infraestrutura do modulo — guardado com os fasciculos e os handouts, ele viaja junto se
 * a aventura for exportada; na pasta `MasterQuest` fica orfao da historia que o produziu.
 */
export const PLAYER_NOTES_SUBFOLDER = "Player Notes' Entries";
/** `Folder.MAX_DEPTH` do core 14.365. Guardado aqui para a queda ser explicita, nao muda. */
export const FOLDER_MAX_DEPTH = 4;
/** Titulo da pagina que recebe o que ja existia em `playernotes` antes da migracao. */
export const LEGACY_PAGE_NAME = "Before session records";

export const OWNERSHIP = Object.freeze({ INHERIT: -1, NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 });

/**
 * O desenho de permissao do caderno, num lugar so, para a previa (DEC-004) poder
 * ANUNCIA-LO e o teste poder trava-lo. Mudanca de permissao e o tipo de coisa que uma
 * previa nao pode omitir: e a parte irreversivel-por-descuido da operacao.
 *
 * 0.30 — EMENDA a DEC-042, por decisao de Mario em 2026-08-10, depois de ver o resultado
 * em mesa: *"tem que ser deles, nao apenas observavel por eles. Essas entradas de jornal,
 * eles fazem o que eles quiserem. E o caderninho deles."*
 *
 * A pagina passa a nascer `default: OWNER`. O que isso corrige e o que isso abandona:
 *
 * CORRIGE um defeito real. O desenho anterior marcava dono por dono, a partir de
 * `playerUserIds` — que so lista quem esta CONECTADO. Caderno criado com a mesa offline
 * nascia sem dono nenhum: os cinco jogadores de Mario ficaram em Observer, sem conseguir
 * escrever. Verificado no export do mundo em 2026-08-10.
 *
 * ABANDONA o isolamento entre cadernos, deliberadamente. E a leitura correta do que o
 * documento sempre foi: **a pagina e por SESSAO, nao por jogador** — `sessions[]` nunca
 * teve campo de dono, entao "o jogador daquela sessao" era figura de linguagem que a
 * implementacao nao tinha como cumprir. A pagina e o caderno da MESA.
 *
 * PRECO ACEITO, escrito para nao ser descoberto depois: qualquer jogador pode apagar o
 * que outro escreveu na mesma pagina. E o regime de um caderno passado de mao em mao, e
 * foi pedido nessas palavras.
 */
export const PLAYER_NOTES_OWNERSHIP = Object.freeze({
  entry: OWNERSHIP.OWNER,
  pageDefault: OWNERSHIP.OWNER,
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
 * Onde o caderno desta quest deve morar, e por que.
 *
 * Puro: nao cria pasta, nao grava nada, nao depende de o Foundry estar rodando. So le a
 * arvore e devolve o plano — para a previa poder anuncia-lo e o teste poder trava-lo.
 *
 * Tres modos, e as duas quedas existem porque a arvore do Mestre nao e obrigada a ter a
 * forma que o modulo prefere:
 *
 * ```text
 * adventure       o caso normal: <pasta da quest> / Player Notes' Entries
 * adventure-flat  a pasta da aventura ja esta no nivel maximo do core, e nao cabe
 *                 subpasta: a entrada nasce direto nela
 * module-root     a quest nao esta em pasta nenhuma: cai no caminho antigo,
 *                 MasterQuest / Player Notes. Queda declarada, nao erro
 * ```
 *
 * @param {object} options
 * @param {object} options.quest A quest normalizada (usa `quest.entry.folder`).
 * @param {object} [options.game] O game do Foundry.
 * @returns {object} `{mode, parent, path, label, reason}`.
 */
export function planNotesFolder({ quest, game = globalThis.game } = {}) {
  const questFolder = resolveFolder(quest?.entry?.folder ?? quest?.folder ?? null, game);

  if (!questFolder) {
    return {
      mode: "module-root",
      parent: null,
      path: [MASTERQUEST_FOLDER, PLAYER_NOTES_FOLDER],
      label: `${MASTERQUEST_FOLDER} / ${PLAYER_NOTES_FOLDER}`,
      reason: "the quest is not inside any folder"
    };
  }

  if (folderDepth(questFolder, game) >= FOLDER_MAX_DEPTH) {
    return {
      mode: "adventure-flat",
      parent: questFolder,
      path: [],
      label: folderLabel(questFolder, game),
      reason: "the adventure folder is already at the core's maximum depth"
    };
  }

  return {
    mode: "adventure",
    parent: questFolder,
    path: [PLAYER_NOTES_SUBFOLDER],
    label: `${folderLabel(questFolder, game)} / ${PLAYER_NOTES_SUBFOLDER}`,
    reason: ""
  };
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
      folderMode: "",
      moveFrom: "",
      willMove: false,
      pages: [],
      ownership: PLAYER_NOTES_OWNERSHIP,
      existing: null
    };
  }

  const entryName = playerNotesEntryName(quest);
  const existing = findEntryByUuidOrName({ uuid: quest.playerNotesUuid, name: entryName, game });
  const sessions = toArray(quest.sessions);
  const target = planNotesFolder({ quest, game });

  // Mover e mudanca de estado, logo a previa TEM de dizer de onde para onde (DEC-004).
  // Trocar `folder` nao muda o UUID do documento, entao `playerNotesUuid` e os `pageUuid`
  // continuam validos — mas isso e razao para a operacao ser segura, nao para ser calada.
  const moveFrom = existing ? folderLabel(resolveFolder(existing.folder ?? null, game), game) : "";
  const willMove = Boolean(existing) && moveFrom !== target.label;

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
    folderPath: target.label,
    folderMode: target.mode,
    moveFrom,
    willMove,
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
  const target = planNotesFolder({ quest, game });

  // Caderno que ja existe nao se recria: muda de pasta, se a morada mudou. Trocar `folder`
  // preserva o UUID, entao nenhum ponteiro se perde — nem `playerNotesUuid`, nem os
  // `pageUuid` das sessoes, nem os links que o Mestre tenha espalhado pelo mundo.
  if (existing) {
    const moved = await moveEntryToFolder({ entry: existing, target, game, Folder });
    return { status: moved ? "moved" : "reused", uuid: entryUuid(existing), entry: existing };
  }

  if (typeof JournalEntry?.create !== "function") {
    return { status: "missing-journal-entry-create", uuid: null, entry: null };
  }

  const folder = await ensureFolderForPlan({ game, Folder, target });

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
export async function ensureSessionPage({ entry, session, owners = [], content = "", name: forcedName } = {}) {
  if (!entry || !session) return { status: "no-target", uuid: null, page: null };

  const name = text(forcedName) || sessionPageName(session);
  const pages = toArray(entry.pages);
  const existing = pages.find((page) => page?.name === name);
  if (existing) return { status: "reused", uuid: pageUuid(entry, existing), page: existing };

  if (typeof entry.createEmbeddedDocuments !== "function") {
    return { status: "missing-create-embedded", uuid: null, page: null };
  }

  // 0.30: `default` EXPLICITO e OWNER — a pagina e o caderno da MESA. Continua explicito,
  // nunca INHERIT, porque valor declarado na pagina e o que se pode ler no diagrama de
  // permissao sem adivinhar de onde ele veio. Os donos nomeados seguem sendo marcados,
  // quando houver lista, mas a permissao nao DEPENDE mais dela — foi essa dependencia que
  // produziu paginas sem dono nenhum quando a mesa estava offline.
  const ownership = { default: PLAYER_NOTES_OWNERSHIP.pageDefault };
  for (const userId of owners) ownership[userId] = PLAYER_NOTES_OWNERSHIP.pageOwner;

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
 * Idempotencia por TEXTO VISIVEL, e a mudanca merece explicacao porque contradiz o que o
 * projeto acreditava.
 *
 * Ate a 0.29 cada linha levava o id da entrada de log num comentario HTML invisivel
 * (`<!--mq:id-->`), e a garantia de nao duplicar dependia dele. **O carimbo nao sobrevive
 * ao Foundry.** Verificado no export do mundo de Mario em 2026-08-10: a pagina da Sessao 3
 * tinha cinco paragrafos escritos pelo modulo e ZERO carimbos — e, por isso, duas linhas
 * repetidas. O nucleo higieniza o HTML da pagina e come o comentario.
 *
 * Isso derruba a afirmacao da DEC-038 de que o push para a PAGINA era idempotente
 * enquanto o push para o campo nao era: os dois duplicavam. Ninguem tinha olhado dentro da
 * pagina ate agora.
 *
 * Comparar o texto visivel resolve o caso real (clicar duas vezes) e nao depende de nada
 * que um editor possa apagar. Limite honesto: se o Mestre EDITAR a linha depois, ela deixa
 * de ser identica e um push novo entra outra vez.
 *
 * @param {object} options
 * @param {object} options.page A pagina de Journal.
 * @param {Array<{id: string, html: string}>} options.lines As linhas a acrescentar.
 * @returns {Promise<object>} `{status, appended, skipped}`.
 */
export async function appendToSessionPage({ page, lines = [] } = {}) {
  if (!page || typeof page.update !== "function") return { status: "no-page", appended: 0, skipped: 0 };

  const current = page.text?.content ?? "";
  const seen = new Set(paragraphsOf(current).map(plainText));
  const fresh = [];
  let skipped = 0;

  for (const line of lines) {
    const key = plainText(line.html);
    if (key && seen.has(key)) {
      skipped += 1;
      continue;
    }
    if (key) seen.add(key);
    fresh.push(`<p>${line.html}</p>`);
  }

  if (!fresh.length) return { status: "nothing-to-append", appended: 0, skipped };

  await page.update({ text: { content: `${current}${fresh.join("")}` } });
  return { status: "appended", appended: fresh.length, skipped };
}

/**
 * Os paragrafos de um HTML, na ordem, sem os vazios.
 *
 * @param {string} html O conteudo.
 * @returns {string[]} O HTML INTERNO de cada `<p>`.
 */
export function paragraphsOf(html) {
  const out = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = re.exec(String(html ?? "")))) {
    const inner = match[1];
    if (plainText(inner)) out.push(inner);
  }
  return out;
}

/** O texto puro de um trecho de HTML, normalizado para comparacao. */
function plainText(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

/** As tags que sobrevivem ao sumario: enfase, e nada mais. */
const SUMMARY_TAGS = /<(?!\/?(?:strong|em|b|i)\b)[^>]*>/gi;

/**
 * O sumario de uma pagina, para o painel exibir sem abrir o documento.
 *
 * Puro e sem Foundry: recebe HTML, devolve as primeiras linhas e quantas ficaram de fora.
 * Mantem so marcacao de enfase — link, imagem e script saem, porque o painel nao e o
 * documento e nao deve tentar se passar por ele.
 *
 * @param {string} html O conteudo da pagina.
 * @param {object} [options]
 * @param {number} [options.limit] Quantas linhas mostrar.
 * @returns {object} `{lines, more}`.
 */
export function summarizePageContent(html, { limit = 4 } = {}) {
  const all = paragraphsOf(html).map((line) => line.replace(SUMMARY_TAGS, "").trim()).filter(Boolean);
  return { lines: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/**
 * Le o sumario da pagina de cada sessao. Async porque resolve UUID contra o mundo; fica
 * FORA dos desenhadores, que sao puros e testaveis sem Foundry.
 *
 * @param {object} options
 * @param {object} options.quest A quest normalizada.
 * @param {Function} [options.fromUuid] Resolvedor de UUID, injetavel.
 * @param {number} [options.limit] Linhas por sessao.
 * @returns {Promise<object>} Mapa `numero da sessao -> {lines, more}`.
 */
export async function readSessionSummaries({ quest, fromUuid = globalThis.fromUuid, limit = 4 } = {}) {
  const out = {};
  if (!quest || typeof fromUuid !== "function") return out;

  for (const session of toArray(quest.sessions)) {
    if (!session?.pageUuid) continue;
    try {
      const page = await fromUuid(session.pageUuid);
      out[session.number] = summarizePageContent(page?.text?.content ?? "", { limit });
    } catch (error) {
      console.error(`${MODULE_ID} | failed to read session page ${session.pageUuid}`, error);
    }
  }

  return out;
}

/**
 * Poe as paginas ja existentes no desenho de permissao vigente (0.30: `default: OWNER`).
 *
 * Existe porque decisao de permissao nao alcanca retroativamente o que ja foi criado: o
 * caderno de Mario nasceu com as paginas em Observer e os cinco jogadores nao conseguiam
 * escrever. Sem este gesto, cada caderno antigo precisaria ser consertado a mao, pagina
 * por pagina, no dialogo do Foundry.
 *
 * @param {object} options
 * @param {object} options.entry A entrada de Journal.
 * @returns {Promise<object>} `{status, fixed, total}`.
 */
export async function applyPageOwnership({ entry } = {}) {
  const pages = toArray(entry?.pages);
  if (!pages.length) return { status: "no-pages", fixed: 0, total: 0 };

  let fixed = 0;
  for (const page of pages) {
    if (page?.ownership?.default === PLAYER_NOTES_OWNERSHIP.pageDefault) continue;
    if (typeof page?.update !== "function") continue;
    await page.update({ ownership: { ...(page.ownership ?? {}), default: PLAYER_NOTES_OWNERSHIP.pageDefault } });
    fixed += 1;
  }

  return { status: "done", fixed, total: pages.length };
}

/**
 * Quantas paginas ainda estao fora do desenho de permissao vigente. Leitura pura, para a
 * previa poder dizer o numero antes de qualquer escrita.
 *
 * @param {object} entry A entrada de Journal.
 * @returns {number} Quantas paginas seriam alteradas.
 */
export function pagesNeedingOwnership(entry) {
  return toArray(entry?.pages).filter(
    (page) => page?.ownership?.default !== PLAYER_NOTES_OWNERSHIP.pageDefault
  ).length;
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

/** Uma pasta, venha ela como documento ou como id solto — o core devolve as duas formas. */
function resolveFolder(raw, game) {
  if (!raw) return null;
  if (typeof raw === "string") {
    return toArray(game?.folders).find((folder) => (folder?.id ?? folder?._id) === raw) ?? null;
  }
  return raw;
}

/** Id de uma pasta, tolerante as duas formas. */
function folderId(raw) {
  if (!raw) return null;
  return typeof raw === "string" ? raw : raw.id ?? raw._id ?? null;
}

/** Quantos niveis a pasta tem acima de si, contando a propria. Raiz da arvore = 1. */
function folderDepth(folder, game) {
  let depth = 0;
  let current = folder;
  // A guarda de 16 e contra ciclo de pasta — que nao deveria existir, e que travaria o
  // laco para sempre se existisse.
  while (current && depth < 16) {
    depth += 1;
    current = resolveFolder(current.folder ?? null, game);
  }
  return depth;
}

/** O caminho legivel de uma pasta, do topo para baixo. Pasta nula = raiz, string vazia. */
function folderLabel(folder, game) {
  const parts = [];
  let current = folder;
  while (current && parts.length < 16) {
    parts.unshift(current.name ?? "");
    current = resolveFolder(current.folder ?? null, game);
  }
  return parts.join(" / ");
}

/** Garante a pasta de destino do plano, criando o que faltar. */
async function ensureFolderForPlan({ game, Folder, target }) {
  if (!target?.path?.length) return target?.parent ?? null;
  return ensureNestedFolder({
    game,
    Folder,
    path: target.path,
    parentId: folderId(target.parent)
  });
}

/**
 * Move a entrada para a pasta do plano, se ela ja nao estiver la.
 *
 * Nao apaga a pasta de origem, ainda que ela fique vazia: nenhum caminho do modulo
 * destroi documento ou pasta do mundo (DEC-038).
 *
 * @returns {Promise<boolean>} `true` se moveu de fato.
 */
async function moveEntryToFolder({ entry, target, game, Folder }) {
  if (!entry || typeof entry.update !== "function") return false;
  const desired = await ensureFolderForPlan({ game, Folder, target });
  const desiredId = folderId(desired);
  if (desiredId === folderId(entry.folder ?? null)) return false;
  await entry.update({ folder: desiredId });
  return true;
}

/**
 * Cria a arvore de pastas do caminho, um nivel por vez, reaproveitando o que existir.
 * `parentId` diz de onde partir — a raiz da arvore, ou a pasta da aventura.
 */
async function ensureNestedFolder({ game, Folder, path, parentId = null }) {
  let current = resolveFolder(parentId, game);

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
