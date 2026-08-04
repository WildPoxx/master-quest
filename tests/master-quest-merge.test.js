import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTHORED_BY_BLUEPRINT,
  AUTHORED_BY_DRAFT,
  TABLE_OWNED,
  mergeQuest
} from "../src/quest/merge-quest.js";
import { normalizeObjective, normalizeQuest, normalizeReward } from "../src/quest/quest-schema.js";
import { mergeDraftIntoQuest } from "../src/quest/quest-from-draft.js";
import { mergeBlueprintIntoQuestWithOrphans } from "../src/quest/quest-blueprint.js";

/**
 * Preservacao de estado de mesa (DEC-031, correcao bloqueante da 0.20).
 *
 * Ate a 0.19.2 os dois merges listavam o que a MESA preserva, e esqueciam campo com
 * facilidade — `rewards`, `gmcomments`, `designId` e `objectives[].hidden` sumiam numa
 * reimportacao ou numa regravacao de rascunho. A regra agora e invertida: declara-se o que
 * a FONTE governa, e o resto sobrevive.
 *
 * O ultimo teste deste arquivo e o que importa a longo prazo: ele enumera o schema e falha
 * quando alguem acrescenta campo sem decidir de quem ele e.
 */

const COLLECTIONS = ["objectives", "rewards"];

function tableQuest(overrides = {}) {
  return normalizeQuest({
    name: "Echoes of the Tower",
    designId: "cl-m01-q1-p",
    status: "active",
    gmcomments: "<p>Auditoria da mesa: movido em 2026-08-04.</p>",
    playernotes: "<p>O que os jogadores anotaram.</p>",
    splash: "worlds/x/tower.webp",
    location: "Maltram",
    objectives: [
      { id: "o1", name: "Descobrir o destino do menino", completed: true, hidden: false },
      { id: "o2", name: "Reaver o medalhao", hidden: true }
    ],
    rewards: [
      { id: "r1", name: "O mapa de Maltram", hidden: false, granted: true },
      { id: "r2", name: "O desfecho do cofre", hidden: true, granted: false }
    ],
    ...overrides
  });
}

test("reimportar blueprint nao apaga as GM Notes", () => {
  const current = tableQuest();
  const { quest } = mergeBlueprintIntoQuestWithOrphans(current, {
    designId: "cl-m01-q1-p",
    name: "Echoes of the Tower",
    gmnotes: "<h2>Function</h2>"
  });

  assert.equal(quest.gmcomments, current.gmcomments);
});

test("reimportar blueprint preserva estado e ids das recompensas", () => {
  const current = tableQuest();
  const { quest } = mergeBlueprintIntoQuestWithOrphans(current, {
    designId: "cl-m01-q1-p",
    name: "Echoes of the Tower",
    rewards: [
      { id: "r1", name: "O mapa de Maltram, revisado" },
      { id: "r2", name: "O desfecho do cofre" }
    ]
  });

  const [first, second] = quest.rewards;
  // A fonte manda no nome; a mesa manda na posse e na visibilidade.
  assert.equal(first.name, "O mapa de Maltram, revisado");
  assert.equal(first.granted, true);
  assert.equal(first.hidden, false);
  assert.equal(second.granted, false);
  assert.equal(second.hidden, true);
  assert.deepEqual(quest.rewards.map((r) => r.id), ["r1", "r2"]);
});

test("reimportar blueprint preserva a triagem de visibilidade dos objetivos", () => {
  const current = tableQuest();
  const { quest } = mergeBlueprintIntoQuestWithOrphans(current, {
    designId: "cl-m01-q1-p",
    name: "Echoes of the Tower",
    objectives: [
      { id: "o1", name: "Descobrir o destino do menino" },
      { id: "o2", name: "Reaver o medalhao" }
    ]
  });

  assert.equal(quest.objectives[0].completed, true);
  assert.equal(quest.objectives[0].hidden, false);
  assert.equal(quest.objectives[1].hidden, true, "o Mestre escondeu este objetivo em mesa");
});

test("regravar rascunho nao apaga GM Notes, designId nem recompensas", () => {
  const current = tableQuest();
  const quest = mergeDraftIntoQuest(current, {
    title: "Echoes of the Tower",
    premise: "Uma sombra seguiu o grupo.",
    objectives: [{ title: "Descobrir o destino do menino" }]
  });

  assert.equal(quest.gmcomments, current.gmcomments, "GM Notes e da mesa (DEC-028)");
  assert.equal(quest.designId, "cl-m01-q1-p", "designId e a chave da reimportacao");
  assert.equal(quest.splash, current.splash);
  assert.equal(quest.location, "Maltram");
  assert.equal(quest.rewards.length, 2, "o rascunho nao lista recompensas; elas sobrevivem");
  assert.equal(quest.rewards[0].granted, true);
});

test("item que some da fonte sobrevive e e reportado, nunca apagado em silencio", () => {
  const current = tableQuest();
  const { quest, orphans } = mergeBlueprintIntoQuestWithOrphans(current, {
    designId: "cl-m01-q1-p",
    name: "Echoes of the Tower",
    objectives: [{ id: "o1", name: "Descobrir o destino do menino" }],
    rewards: [{ id: "r1", name: "O mapa de Maltram" }]
  });

  assert.equal(quest.objectives.length, 2);
  assert.equal(quest.rewards.length, 2);
  assert.deepEqual(orphans.objectives.map((o) => o.id), ["o2"]);
  assert.deepEqual(orphans.rewards.map((r) => r.id), ["r2"]);
});

test("a fonte manda no que e dela", () => {
  const current = tableQuest();
  const { quest } = mergeBlueprintIntoQuestWithOrphans(current, {
    designId: "cl-m01-q1-p",
    name: "Echoes of the Tower, revised",
    description: "<p>Nova abertura.</p>",
    gmnotes: "<h2>Function</h2>",
    type: "subquest",
    priority: 3
  });

  assert.equal(quest.name, "Echoes of the Tower, revised");
  assert.equal(quest.description, "<p>Nova abertura.</p>");
  assert.equal(quest.type, "subquest");
  assert.equal(quest.priority, 3);
  assert.equal(quest.status, "active", "status segue sendo da mesa");
});

test("quest nova, sem estado anterior, entra inteira", () => {
  const { quest, orphans } = mergeQuest(null, normalizeQuest({ name: "Nova" }), {
    authoredBy: AUTHORED_BY_BLUEPRINT
  });
  assert.equal(quest.name, "Nova");
  assert.deepEqual(orphans, { objectives: [], rewards: [] });
});

test("DEC-006 e DEC-031: objetivo e recompensa nascem ocultos", () => {
  assert.equal(normalizeObjective({ name: "x" }).hidden, true);
  assert.equal(normalizeReward({ name: "x" }).hidden, true);
  assert.equal(normalizeReward({ name: "x" }).granted, false);
  // Sem migracao retroativa: dado ja gravado traz a chave e nao muda de valor.
  assert.equal(normalizeObjective({ name: "x", hidden: false }).hidden, false);
  assert.equal(normalizeReward({ name: "x", hidden: false }).hidden, false);
});

test("todo campo do schema tem dono declarado", () => {
  const declared = (kind) =>
    new Set([
      ...AUTHORED_BY_DRAFT[kind],
      ...AUTHORED_BY_BLUEPRINT[kind],
      ...TABLE_OWNED[kind]
    ]);

  const cases = [
    ["quest", Object.keys(normalizeQuest({})).filter((f) => !COLLECTIONS.includes(f))],
    ["objective", Object.keys(normalizeObjective({}))],
    ["reward", Object.keys(normalizeReward({}))]
  ];

  for (const [kind, fields] of cases) {
    const known = declared(kind);
    const orphanFields = fields.filter((field) => !known.has(field));
    assert.deepEqual(
      orphanFields,
      [],
      `campo sem dono em ${kind}: ${orphanFields.join(", ")}. ` +
        "Acrescente-o a AUTHORED_BY_DRAFT, a AUTHORED_BY_BLUEPRINT ou a TABLE_OWNED " +
        "em src/quest/merge-quest.js. Campo sem dono e o defeito que esta lista existe " +
        "para impedir."
    );
  }
});
