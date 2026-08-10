/**
 * 0.29 — a morada do caderno e o indice de sessoes na aba de notas.
 *
 * Teste de mesa da 0.28.0 (Mario, 2026-08-08), dois pedidos:
 *
 * 1. *"eu preferia que (...) em vez de vir o texto dentro do campo de texto do Player
 *    Notes, viria o link que levaria ao Player Notes nos journals"* — a aba vira indice:
 *    cabecalho da sessao, regua, link para a pagina daquela sessao.
 * 2. *"esse botao preso la em cima, padrao para aquela ultima sessao, isso e totalmente
 *    desnecessario"* — a tira fixa sai.
 *
 * E a morada muda: o caderno nasce dentro da pasta da aventura, na subpasta que o proprio
 * Mario criou a mao no mundo. Emenda a resposta que ele dera em 2026-08-06 (DEC-038).
 *
 * O que NENHUM teste daqui prova: que o Foundry vivo honre o desenho. Aqui se verifica que
 * o modulo PEDE o certo — a mesma ressalva da 0.26.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PLAYER_NOTES_SUBFOLDER,
  ensurePlayerNotesEntry,
  planNotesFolder,
  planPlayerNotes
} from "../src/journal/player-notes.js";
import { normalizeQuest } from "../src/quest/quest-schema.js";
import { buildQuestDetailsViewModel } from "../src/quest/quest-view-model.js";
import { renderQuestDetails } from "../src/ui/quest-details.js";

const MODULO = { id: "f-mod", name: "Módulo 01 — As Rodas de Karavazyan", type: "JournalEntry", folder: null };
const ANTIGA = { id: "f-old", name: "Player Notes", type: "JournalEntry", folder: "f-mq" };
const RAIZ_MQ = { id: "f-mq", name: "MasterQuest", type: "JournalEntry", folder: null };

/** Uma quest normalizada com o documento de Journal pendurado, como o store a entrega. */
function questIn(folder, extra = {}) {
  return { ...normalizeQuest({ id: "q1", name: "A Sombra", ...extra }), entry: { folder } };
}

/* --- 1. onde o caderno mora ---------------------------------------------------------- */

test("o caderno nasce dentro da pasta da aventura, na subpasta que Mario nomeou", () => {
  const plan = planNotesFolder({ quest: questIn(MODULO), game: { folders: [MODULO] } });

  assert.equal(plan.mode, "adventure");
  assert.equal(plan.parent, MODULO);
  assert.deepEqual(plan.path, [PLAYER_NOTES_SUBFOLDER]);
  assert.equal(plan.label, `${MODULO.name} / ${PLAYER_NOTES_SUBFOLDER}`);
});

test("quest fora de qualquer pasta CAI no caminho antigo, e a queda se declara", () => {
  // Queda, nao erro: sem pasta da quest nao ha de onde derivar a morada.
  const plan = planNotesFolder({ quest: questIn(null), game: { folders: [] } });

  assert.equal(plan.mode, "module-root");
  assert.deepEqual(plan.path, ["MasterQuest", "Player Notes"]);
  assert.ok(plan.reason, "a queda tem de dizer por que caiu");
});

test("pasta de aventura no nivel maximo do core recebe a entrada SEM subpasta", () => {
  // FOLDER_MAX_DEPTH e 4. Criar filha de uma pasta de nivel 4 falha em silencio no
  // Foundry — e caderno que nao nasce e pior que caderno em pasta feia.
  const n1 = { id: "n1", name: "1", folder: null };
  const n2 = { id: "n2", name: "2", folder: "n1" };
  const n3 = { id: "n3", name: "3", folder: "n2" };
  const n4 = { id: "n4", name: "4", folder: "n3" };
  const game = { folders: [n1, n2, n3, n4] };

  const plan = planNotesFolder({ quest: questIn(n4), game });

  assert.equal(plan.mode, "adventure-flat");
  assert.deepEqual(plan.path, []);
  assert.equal(plan.parent, n4);
});

/* --- 2. a previa anuncia a mudanca de morada (DEC-004) -------------------------------- */

test("a previa diz de onde para onde o caderno existente vai se mudar", () => {
  const entry = { id: "j1", uuid: "JournalEntry.j1", name: "Player Notes — A Sombra", folder: ANTIGA };
  const quest = questIn(MODULO, { playerNotesUuid: "JournalEntry.j1" });
  const plan = planPlayerNotes({ quest, game: { journal: [entry], folders: [RAIZ_MQ, ANTIGA, MODULO] } });

  assert.equal(plan.willMove, true, "mover e mudanca de estado; previa que a omite nao cumpre a DEC-004");
  assert.equal(plan.moveFrom, "MasterQuest / Player Notes");
  assert.equal(plan.folderPath, `${MODULO.name} / ${PLAYER_NOTES_SUBFOLDER}`);
});

test("caderno que ja esta no lugar certo nao anuncia mudanca nenhuma", () => {
  const nova = { id: "f-new", name: PLAYER_NOTES_SUBFOLDER, folder: "f-mod" };
  const entry = { id: "j1", uuid: "JournalEntry.j1", name: "Player Notes — A Sombra", folder: nova };
  const quest = questIn(MODULO, { playerNotesUuid: "JournalEntry.j1" });

  const plan = planPlayerNotes({ quest, game: { journal: [entry], folders: [MODULO, nova] } });
  assert.equal(plan.willMove, false);
});

/* --- 3. o que a criacao e a mudanca fazem de fato ------------------------------------- */

test("a criacao abre a subpasta DENTRO da pasta da aventura, nao na raiz", async () => {
  const criadas = [];
  const result = await ensurePlayerNotesEntry({
    quest: questIn(MODULO),
    game: { journal: [], folders: [MODULO] },
    JournalEntry: { create: async (data) => ({ id: "j1", uuid: "JournalEntry.j1", ...data }) },
    Folder: {
      create: async (data) => {
        criadas.push(data);
        return { id: `f-${criadas.length}`, ...data };
      }
    }
  });

  assert.equal(result.status, "created");
  assert.equal(criadas.length, 1, "so a subpasta e nova — a pasta da aventura ja existe");
  assert.equal(criadas[0].name, PLAYER_NOTES_SUBFOLDER);
  assert.equal(criadas[0].folder, "f-mod", "a subpasta pendura na pasta da aventura");
});

test("caderno existente MUDA de pasta e conserva o uuid — nada se recria, nada se copia", async () => {
  // O ponto que torna a mudanca segura: trocar `folder` nao muda o id do documento, entao
  // playerNotesUuid e todos os pageUuid das sessoes continuam validos.
  const updates = [];
  const entry = {
    id: "j1",
    uuid: "JournalEntry.j1",
    name: "Player Notes — A Sombra",
    folder: ANTIGA,
    update: async (data) => updates.push(data)
  };
  const nova = { id: "f-new", name: PLAYER_NOTES_SUBFOLDER, folder: "f-mod" };

  const result = await ensurePlayerNotesEntry({
    quest: questIn(MODULO, { playerNotesUuid: "JournalEntry.j1" }),
    game: { journal: [entry], folders: [RAIZ_MQ, ANTIGA, MODULO, nova] },
    JournalEntry: { create: async () => assert.fail("nao pode criar entrada nova: ela ja existe") },
    Folder: { create: async () => assert.fail("a subpasta ja existe; nao se cria de novo") }
  });

  assert.equal(result.status, "moved");
  assert.equal(result.uuid, "JournalEntry.j1", "o endereco do caderno nao muda ao mudar de pasta");
  assert.deepEqual(updates, [{ folder: "f-new" }]);
});

/* --- 4. o indice de sessoes na aba ---------------------------------------------------- */

const COM_CADERNO = {
  id: "q1",
  name: "A Sombra",
  playerNotesUuid: "JournalEntry.j1",
  sessions: [
    { number: 2, date: "2026-08-17", title: "A 3ª Roda", pageUuid: "JournalEntry.j1.JournalEntryPage.p2" },
    { number: 1, date: "2026-08-10", title: "Sonhos e Sombras sobre Rodas", pageUuid: "JournalEntry.j1.JournalEntryPage.p1" }
  ]
};

/** O que `_prepareContext` entrega pronto ao desenho: os renderizadores sao puros. */
function view(source, { isGM = true, canEdit = true, notesFolder = { willMove: false } } = {}) {
  const model = buildQuestDetailsViewModel(normalizeQuest(source), {
    isGM,
    canEdit,
    activeTab: "playernotes"
  });
  model.notesFolder = notesFolder;
  return renderQuestDetails(model);
}

test("cada sessao vira uma secao, com cabecalho, regua e o link da PROPRIA pagina", () => {
  const html = view(COM_CADERNO);

  assert.ok(html.includes("<h4>Session 1: Sonhos e Sombras sobre Rodas</h4>"));
  assert.ok(html.includes("<h4>Session 2: A 3ª Roda</h4>"));
  assert.ok(html.includes('data-action="open-session-page" data-uuid="JournalEntry.j1.JournalEntryPage.p1"'));
  assert.ok(html.includes('data-action="open-session-page" data-uuid="JournalEntry.j1.JournalEntryPage.p2"'));
});

test("a ordem e CRESCENTE, como na lista de sessoes e no Log desde a 0.27", () => {
  const html = view(COM_CADERNO);
  assert.ok(html.indexOf("Session 1:") < html.indexOf("Session 2:"), "o caderno se le na ordem em que se jogou");
});

test("sessao sem pagina APARECE, dizendo por que esta vazia", () => {
  // A licao da 0.27.0: esconder a sessao unica fez Mario concluir que ela nao fora gravada.
  const html = view({
    ...COM_CADERNO,
    sessions: [{ number: 1, date: "2026-08-10", title: "Sonhos", pageUuid: "" }]
  });

  assert.ok(html.includes("<h4>Session 1: Sonhos</h4>"), "a sessao existe e a aba tem de dize-lo");
  assert.ok(html.includes("No page yet"), "e tem de dizer por que ainda nao ha link");
});

test("a tira FIXA do topo saiu: nao ha mais botao 'Open Session N' preso acima do indice", () => {
  const html = view(COM_CADERNO);
  assert.equal(html.includes("Open Session 2"), false, "era o botao que Mario chamou de desnecessario");
  assert.equal(html.includes("this tab mirrors it"), false, "a legenda da tira sai com ela");
});

test("sem caderno, o botao de criar continua onde sempre esteve", () => {
  const html = view({ id: "q1", name: "A Sombra", sessions: [{ number: 1 }] });
  assert.ok(html.includes('data-action="player-notes-create"'));
  assert.equal(html.includes("mq-notes-index"), false, "sem caderno nao ha indice a desenhar");
});

test("caderno fora do lugar novo oferece a mudanca; no lugar certo, nao oferece nada", () => {
  // Sem esta metade, um caderno criado antes da 0.29 nunca teria como se mudar.
  const fora = view(COM_CADERNO, {
    notesFolder: { willMove: true, folderPath: "Módulo 01 / Player Notes' Entries" }
  });
  // 0.30: mover ganhou gesto PROPRIO. Reusar o de criar fazia a migracao rodar junto, e
  // Mario clicou em "mover" e ganhou uma pagina nova que nao pediu.
  assert.ok(fora.includes('data-action="player-notes-move"'), "mover e mover, e nada mais");
  assert.ok(fora.includes("Move to"));

  const dentro = view(COM_CADERNO);
  assert.equal(dentro.includes("Move to"), false);
});

test("caderno sem sessao nenhuma ainda oferece como abri-lo — nao vira beco sem saida", () => {
  const html = view({ id: "q1", name: "A Sombra", playerNotesUuid: "JournalEntry.j1", sessions: [] });
  assert.ok(html.includes('data-uuid="JournalEntry.j1"'), "aqui, e so aqui, o link e o da entrada inteira");
});

test("o jogador ve o indice, e nao ve caixa de texto vazia embaixo dele", () => {
  const html = view(COM_CADERNO, { isGM: false, canEdit: false });

  assert.ok(html.includes("mq-notes-index"), "o indice e de todos: e o caderno da mesa");
  assert.equal(html.includes("Nothing here yet"), false, "caixa vazia sem rotulo foi o defeito que originou a rodada");
  assert.equal(html.includes("player-notes-create"), false, "criar o caderno segue sendo gesto do Mestre");
});

test("prosa livre gravada no campo NAO se perde quando o indice aparece", () => {
  const html = view({ ...COM_CADERNO, playernotes: "<p>recado a mesa</p>" }, { isGM: false, canEdit: false });
  assert.ok(html.includes("recado a mesa"), "nada do que ja estava escrito desaparece da tela");
});
