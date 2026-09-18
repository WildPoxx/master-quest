import test from "node:test";
import assert from "node:assert/strict";

import {
  FACTS_END,
  FACTS_START,
  OWNERSHIP,
  QUEST_PAGE_KIT,
  buildEstablishedFacts,
  ensureQuestPagesKit,
  findKitPage,
  grantedAudience,
  mergeFactsIntoContent,
  personalPageOwnership,
  shouldBlockEntryDeletion
} from "../src/journal/quest-pages.js";
import { MODULE_ID } from "../src/constants.js";

/* =====================================================================================
 * 1.6.0 — AS PAGINAS DE JOGADOR (minuta ratificada por Mario em 2026-09-18, com a
 * emenda de posse do mesmo dia)
 *
 * O que estes testes guardam, na ordem do que doeria perder:
 *   1. Nada de oculto vaza para a pagina Fatos Estabelecidos — o filtro e o da minuta.
 *   2. O que o Mestre escreve fora dos marcadores sobrevive a toda atualizacao.
 *   3. A criacao do kit e idempotente: pagina existente e adotada, nunca duplicada.
 *   4. A posse: publico vira OWNER da pagina Anotacoes Pessoais, aditivamente.
 *   5. A rede de seguranca: entrada com quest so o Mestre exclui.
 * ===================================================================================== */

test("1.6.0: o kit tem as cinco paginas do mock, em ordem, e nenhuma nasce vazia", () => {
  assert.deepEqual(QUEST_PAGE_KIT.map((p) => p.key), ["player-safe", "facts", "diary", "personal", "summary"]);
  const sorts = QUEST_PAGE_KIT.map((p) => p.sort);
  assert.deepEqual([...sorts].sort((a, b) => a - b), sorts, "a ordem do mock e a ordem do kit");
  for (const spec of QUEST_PAGE_KIT) {
    assert.ok(spec.name.length > 0);
    assert.ok(spec.birth.length > 0, `${spec.key} nasce com texto, nunca vazia`);
  }
  // 1.6.1 — nomenclatura final da homologacao viva: a pagina sincronizada e o Diario.
  assert.equal(QUEST_PAGE_KIT.find((p) => p.key === "facts").name, "Diário da Quest");
  assert.equal(QUEST_PAGE_KIT.find((p) => p.key === "diary").name, "Registro de Eventos");
  assert.deepEqual(QUEST_PAGE_KIT.find((p) => p.key === "summary").ownership, { default: OWNERSHIP.NONE },
    "o Resumo nasce oculto de todos — so o encerramento o revela");
});

test("1.6.0: Fatos Estabelecidos so espelha o que ja e dos jogadores", () => {
  const quest = {
    objectives: [
      { name: "Visivel em aberto", hidden: false, completed: false, failed: false },
      { name: "Visivel concluido", hidden: false, completed: true, failed: false },
      { name: "Oculto", hidden: true, completed: true }
    ],
    clues: [
      { name: "Pista publica", hidden: false, found: true, known: true },
      { name: "Pista achada mas nao contada", hidden: true, found: true, known: false }
    ],
    rewards: [
      { name: "Paga e sabida", hidden: false, granted: true, known: true },
      { name: "Prometida", hidden: false, granted: false, known: true }
    ],
    outcomes: [
      { name: "Ocorrido e sabido", hidden: false, occurred: true, known: true },
      { name: "Segredo", hidden: true, occurred: true, known: false }
    ],
    dilemmas: [{ name: "NUNCA-APARECE", hidden: false, known: true }],
    complications: [{ name: "NUNCA-APARECE-2", hidden: false, known: true }]
  };

  const html = buildEstablishedFacts(quest);
  assert.match(html, /Visivel em aberto — <em>em aberto<\/em>/);
  assert.match(html, /Visivel concluido — <em>concluído<\/em>/);
  assert.match(html, /Pista publica/);
  assert.match(html, /Paga e sabida/);
  assert.match(html, /Ocorrido e sabido/);
  assert.doesNotMatch(html, /Oculto|nao contada|Prometida|Segredo/);
  assert.doesNotMatch(html, /NUNCA-APARECE/, "dilema e complication sao maquinaria do Mestre");

  assert.match(buildEstablishedFacts({}), /Nenhuma descoberta/, "quest sem nada publico diz isso com todas as letras");
});

test("1.6.0: o texto do Mestre fora dos marcadores sobrevive a atualizacao — e ela e idempotente", () => {
  const antes = `<p>Introducao do Mestre.</p>${FACTS_START}<p>velho</p>${FACTS_END}<p>Posfacio.</p>`;
  const uma = mergeFactsIntoContent(antes, "<p>novo</p>");
  assert.equal(uma, `<p>Introducao do Mestre.</p>${FACTS_START}<p>novo</p>${FACTS_END}<p>Posfacio.</p>`);
  assert.equal(mergeFactsIntoContent(uma, "<p>novo</p>"), uma, "atualizar duas vezes nao muda nada");

  const semMarcador = mergeFactsIntoContent("<p>Pagina feita a mao.</p>", "<p>bloco</p>");
  assert.match(semMarcador, /Pagina feita a mao/);
  assert.ok(semMarcador.includes(`${FACTS_START}<p>bloco</p>${FACTS_END}`), "sem marcadores, o bloco chega demarcado");
});

test("1.6.0: o kit adota pagina existente por nome (o mock de Mario) e cria so o que falta", async () => {
  const updates = [];
  const page = (name, flags = {}) => ({ name, flags, ownership: {}, update: async (data) => updates.push([name, data]) });
  const existentes = [
    page("Player-Safe — Esfera e Quest"),
    page("Anotações Pessoais")
  ];
  const criadas = [];
  const entry = {
    name: "The Unnamed Metal",
    flags: { [MODULE_ID]: { quest: { name: "The Unnamed Metal" } } },
    ownership: { default: 0, gmid: 3, fox: 2 },
    pages: { contents: existentes },
    createEmbeddedDocuments: async (type, specs) => criadas.push(...specs)
  };
  const game = { users: { contents: [{ id: "gmid", isGM: true }, { id: "fox", isGM: false }] } };

  const result = await ensureQuestPagesKit(entry, { game });

  assert.deepEqual(result.created, ["Diário da Quest", "Registro de Eventos", "Resumo da Quest"],
    "player-safe casa por prefixo e Anotacoes por nome — nada duplica");
  const resumo = criadas.find((spec) => spec.name === "Resumo da Quest");
  assert.deepEqual(resumo.ownership, { default: 0 }, "o Resumo ja nasce escondido dos jogadores");
  assert.deepEqual(result.adopted, ["Player-Safe — Esfera e Quest", "Anotações Pessoais"]);
  assert.ok(criadas.every((spec) => spec.flags[MODULE_ID].page && spec.text.content.length > 0));
  const adocoes = updates.filter(([, data]) => data[`flags.${MODULE_ID}.page`]);
  assert.equal(adocoes.length, 2, "adotar e ganhar a flag, nao ser reescrita");
  const posse = updates.find(([nome, data]) => nome === "Anotações Pessoais" && data.ownership);
  assert.ok(posse, "o publico vira dono da pagina de anotacoes");
  assert.equal(posse[1].ownership.fox, OWNERSHIP.OWNER);
  assert.equal(posse[1].ownership.gmid, undefined, "GM nao entra na lista — ja manda em tudo");
});

test("1.6.0: a posse e aditiva e le o publico da entrada", () => {
  const audience = grantedAudience({ default: 0, fox: 2, moe: 3, beto: 1, gm: 3 }, [
    { id: "gm", isGM: true }, { id: "fox", isGM: false }, { id: "moe", isGM: false }, { id: "beto", isGM: false }
  ]);
  assert.deepEqual(audience, { userIds: ["fox", "moe"], defaultGranted: false }, "Limited nao e publico; GM nao conta");

  const mesa = grantedAudience({ default: 2 }, [{ id: "fox", isGM: false }]);
  assert.equal(mesa.defaultGranted, true);

  const posse = personalPageOwnership({ default: -1, fox: 3 }, { userIds: ["fox", "moe"], defaultGranted: true });
  assert.equal(posse.default, OWNERSHIP.OWNER);
  assert.equal(posse.fox, OWNERSHIP.OWNER, "quem ja e dono continua dono");
  assert.equal(posse.moe, OWNERSHIP.OWNER);
});

test("1.6.0: entrada que carrega quest so o Mestre exclui — pagina sim, quest nao", () => {
  const entradaQuest = { flags: { [MODULE_ID]: { quest: { name: "X" } } } };
  const entradaComum = { flags: {} };

  assert.equal(shouldBlockEntryDeletion(entradaQuest, { isGM: false }), true);
  assert.equal(shouldBlockEntryDeletion(entradaQuest, { isGM: true }), false, "o gesto do Mestre segue livre");
  assert.equal(shouldBlockEntryDeletion(entradaComum, { isGM: false }), false, "journal comum nao e da nossa conta");
});

test("1.6.0: findKitPage prefere a flag ao nome — renomear pagina do kit nao a perde", () => {
  const spec = QUEST_PAGE_KIT.find((p) => p.key === "diary");
  const renomeada = { name: "Cronicas da Esfera", flags: { [MODULE_ID]: { page: "diary" } } };
  const homonima = { name: "Registro de Eventos", flags: {} };
  assert.equal(findKitPage([homonima, renomeada], spec), renomeada);
  assert.equal(findKitPage([homonima], spec), homonima);
  assert.equal(findKitPage([], spec), null);
});

test("1.6.2: a Manage oferece os gestos explicitos — Kit e Diario, lado a lado", async () => {
  const { normalizeQuest } = await import("../src/quest/quest-schema.js");
  const { buildQuestDetailsViewModel } = await import("../src/quest/quest-view-model.js");
  const { renderQuestDetails } = await import("../src/ui/quest-details.js");

  const q = { ...normalizeQuest({ name: "P", status: "active", type: "main" }), id: "P", entry: { ownership: { default: 2 } } };
  const html = renderQuestDetails(buildQuestDetailsViewModel(q, { isGM: true, canEdit: true, allQuests: [q], activeTab: "management" }));

  assert.match(html, /data-action="create-kit"/, "o kit nasce por botao, nao por efeito colateral de permissao");
  assert.match(html, /data-action="sync-facts"/);
  assert.match(html, /data-action="configure-ownership"/);
});
