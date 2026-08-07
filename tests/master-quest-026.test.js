/**
 * 0.26 — DEC-042 (ownership do caderno de notas) e DEC-043 (o Wrap Up sela).
 *
 * Os testes travam a REGRA, nao a implementacao. Quem quiser mudar o desenho tera de mudar
 * a decisao junto — foi assim que a 0.25.0 tratou os testes que travavam a regra anterior.
 *
 * O que NENHUM teste daqui prova, e esta declarado na DEC-042: que o Foundry respeite uma
 * pagina OBSERVER dentro de uma entrada OWNER. Isso so o Foundry vivo comprova; aqui se
 * verifica apenas que o modulo PEDE o desenho certo ao core.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  OWNERSHIP,
  PLAYER_NOTES_OWNERSHIP,
  ensurePlayerNotesEntry,
  ensureSessionPage,
  planPlayerNotes
} from "../src/journal/player-notes.js";
import { sessionsToSeal, toggleWrapUp } from "../src/quest/quest-wrapup.js";
import { normalizeQuest } from "../src/quest/quest-schema.js";
import { playerUserIds } from "../src/ui/quest-details.js";

/* --- DEC-042: quem e dono do que ---------------------------------------------------- */

test("a entrada nasce Owner, para o jogador poder criar paginas proprias", async () => {
  // Criar pagina nova no Foundry exige ser Owner da ENTRADA. Com a entrada Observer, o
  // jogador so escreveria nas paginas que o modulo abriu por ele.
  const created = [];
  const result = await ensurePlayerNotesEntry({
    quest: normalizeQuest({ id: "q1", name: "A Torre" }),
    game: { journal: [], folders: [] },
    JournalEntry: {
      create: async (data) => {
        created.push(data);
        return { id: "j1", uuid: "JournalEntry.j1", ...data };
      }
    },
    Folder: { create: async (data) => ({ id: `f-${data.name}`, ...data }) }
  });

  assert.equal(result.status, "created");
  assert.equal(created[0].ownership.default, OWNERSHIP.OWNER);
});

test("a pagina declara o default explicitamente e nunca herda a entrada", async () => {
  // Este e o teste que impede a regressao mais cara: `INHERIT` numa entrada Owner faria
  // cada jogador dono do caderno de todos os outros — o defeito do teste manual de 06/08.
  const created = [];
  const entry = {
    pages: [],
    createEmbeddedDocuments: async (_type, [data]) => {
      created.push(data);
      return [{ id: "p1", ...data }];
    }
  };

  await ensureSessionPage({
    entry,
    session: { number: 3, date: "", title: "" },
    owners: ["user-a", "user-b"]
  });

  const { ownership } = created[0];
  assert.notEqual(ownership.default, OWNERSHIP.INHERIT, "default INHERIT devolveria o defeito");
  assert.equal(ownership.default, OWNERSHIP.OBSERVER);
  assert.equal(ownership["user-a"], OWNERSHIP.OWNER);
  assert.equal(ownership["user-b"], OWNERSHIP.OWNER);
});

test("a previa anuncia o desenho de permissao, nao so os nomes das paginas", () => {
  // DEC-004: previa que omite a mudanca de permissao nao cumpre a regra — permissao e a
  // parte irreversivel-por-descuido da operacao.
  const plan = planPlayerNotes({
    quest: normalizeQuest({ id: "q1", name: "A Torre", sessions: [{ number: 1 }] }),
    game: { journal: [] }
  });

  assert.deepEqual(plan.ownership, PLAYER_NOTES_OWNERSHIP);
  assert.equal(plan.ownership.entry, OWNERSHIP.OWNER);
  assert.equal(plan.ownership.pageDefault, OWNERSHIP.OBSERVER);
});

test("o texto da previa diz ao Mestre quem fica dono do que", () => {
  const source = readFileSync(fileURLToPath(new URL("../src/ui/quest-details.js", import.meta.url)), "utf8");
  const preview = source.slice(source.indexOf("export async function confirmPlan"));
  assert.match(preview, /owned by the players/i);
  assert.match(preview, /read-only to the others/i);
});

test("os dois caminhos que criam pagina usam a mesma lista de donos", () => {
  // Ate a 0.25.0 eles discordavam: o push do Log passava `owners: []`, e a pagina nascia
  // sem dono. Sob INHERIT isso passava despercebido; sob default OBSERVER, o jogador
  // simplesmente nao conseguiria escrever.
  const source = readFileSync(fileURLToPath(new URL("../src/ui/quest-details.js", import.meta.url)), "utf8");
  assert.equal(/owners: \[\]/.test(source), false, "nenhuma criacao de pagina nasce sem dono");
  assert.equal((source.match(/playerUserIds\(this\.game\)/g) ?? []).length, 2);
});

test("a lista de donos e so de jogadores: o Mestre fica de fora, o desativado tambem", () => {
  const ids = playerUserIds({
    users: [
      { id: "gm", isGM: true },
      { id: "ana", isGM: false },
      { id: "beto", isGM: false, active: false },
      { id: "caio" }
    ]
  });

  assert.deepEqual(ids, ["ana", "caio"]);
});

/* --- DEC-043: o Wrap Up sela -------------------------------------------------------- */

test("fechar o caderno sela todas as sessoes", () => {
  const quest = {
    wrappedUp: false,
    sessions: [
      { number: 1, sealed: false },
      { number: 2, sealed: false },
      { number: 3, sealed: true }
    ]
  };

  const closed = toggleWrapUp(quest);

  assert.equal(closed.wrappedUp, true);
  assert.deepEqual(closed.sessions.map((s) => s.sealed), [true, true, true]);
});

test("reabrir o caderno NAO desselar", () => {
  // DEC-039 proibiu desselar em massa: destravar e sessao a sessao. Reabrir tambem nao
  // pode desfazer o selo que o Mestre pos a mao antes do Wrap Up.
  const quest = {
    wrappedUp: true,
    sessions: [
      { number: 1, sealed: true },
      { number: 2, sealed: true }
    ]
  };

  const reopened = toggleWrapUp(quest);

  assert.equal(reopened.wrappedUp, false);
  assert.deepEqual(reopened.sessions.map((s) => s.sealed), [true, true]);
});

test("o gesto nao muta a quest original", () => {
  const sessions = [{ number: 1, sealed: false }];
  const quest = { wrappedUp: false, sessions };

  toggleWrapUp(quest);

  assert.equal(sessions[0].sealed, false);
  assert.equal(quest.wrappedUp, false);
});

test("o Wrap Up nao toca o status: status e ficcao, caderno e registro", () => {
  const closed = toggleWrapUp({ status: "active", wrappedUp: false, sessions: [] });
  assert.equal(closed.status, "active");
});

test("a contagem antecipa quantas sessoes o gesto sela, e zera ao reabrir", () => {
  const quest = { wrappedUp: false, sessions: [{ sealed: false }, { sealed: true }, { sealed: false }] };
  assert.equal(sessionsToSeal(quest), 2);
  assert.equal(sessionsToSeal({ ...quest, wrappedUp: true }), 0);
  assert.equal(sessionsToSeal(null), 0);
});

test("quest sem sessoes atravessa o gesto sem quebrar", () => {
  assert.deepEqual(toggleWrapUp({ wrappedUp: false }).sessions, []);
  assert.equal(toggleWrapUp(null), null);
});
