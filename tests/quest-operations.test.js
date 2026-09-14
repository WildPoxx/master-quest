import assert from "node:assert/strict";
import test from "node:test";

import {
  QUEST_STATUS,
  countObjectives,
  normalizeObjective,
  normalizeQuest,
  normalizeReward,
  reorderById,
  withStatus
} from "../src/quest/quest-schema.js";
import { fqlToMasterQuest, importFromFql, previewFqlImport } from "../src/quest/quest-import-fql.js";
import {
  createQuest,
  deleteQuest,
  isAncestor,
  linkSubquest,
  readAllQuests,
  readQuest,
  readQuestById,
  saveQuest,
  setQuestStatus,
  toStoredPayload,
  unlinkSubquest
} from "../src/quest/quest-store.js";
import { buildQuestDetailsViewModel, buildQuestLogViewModel, isQuestHidden } from "../src/quest/quest-view-model.js";
import { cycleObjectiveState, renderQuestDetails } from "../src/ui/quest-details.js";
import { renderQuestLog } from "../src/ui/quest-log.js";
import { esc, safeHtml } from "../src/ui/render-utils.js";
import { MODULE_ID, FQL_MODULE_ID } from "../src/constants.js";

/* ------------------------------------------------------------------ *
 * Fake Foundry world
 * ------------------------------------------------------------------ */

function makeEntry({ id, name = "Quest", quest = null, fql = null, ownership = { default: 0 } }) {
  const entry = {
    id,
    name,
    ownership,
    flags: {},
    getFlag(moduleId, key) {
      return entry.flags?.[moduleId]?.[key] ?? null;
    },
    canUserModify: () => true,
    testUserPermission: (_user, level) => (ownership.default ?? 0) >= (level === "OBSERVER" ? 2 : 3),
    async update(data) {
      if (data.name !== undefined) entry.name = data.name;
      for (const [moduleId, payload] of Object.entries(data.flags ?? {})) {
        entry.flags[moduleId] = { ...(entry.flags[moduleId] ?? {}), ...payload };
      }
      return entry;
    },
    async delete() {
      entry.deleted = true;
    }
  };

  if (quest) entry.flags[MODULE_ID] = { quest };
  if (fql) entry.flags[FQL_MODULE_ID] = { json: fql };
  return entry;
}

function makeGame(entries, { isGM = true } = {}) {
  const journal = {
    contents: entries,
    get: (id) => entries.find((entry) => entry.id === id) ?? null
  };

  const settings = new Map();
  return {
    user: { isGM, id: "user-1" },
    journal,
    folders: { contents: [] },
    settings: {
      get: (_module, key) => settings.get(key) ?? "",
      set: async (_module, key, value) => settings.set(key, value)
    }
  };
}

/* ------------------------------------------------------------------ *
 * Schema
 * ------------------------------------------------------------------ */

test("normalizeQuest survives corrupt input instead of throwing", () => {
  for (const bad of [null, undefined, 42, "quest", [], { status: "nonsense", objectives: "x" }]) {
    const quest = normalizeQuest(bad);
    assert.equal(typeof quest.name, "string");
    assert.ok(QUEST_STATUS[quest.status], `status inválido virou ${quest.status}`);
    assert.ok(Array.isArray(quest.objectives));
    assert.ok(Array.isArray(quest.rewards));
  }
});

test("an objective is never completed and failed at the same time", () => {
  const objective = normalizeObjective({ name: "Alvo", completed: true, failed: true });
  assert.equal(objective.completed, true);
  assert.equal(objective.failed, false);
});

test("rewards default to locked so the party does not see unearned loot", () => {
  assert.equal(normalizeReward({ name: "Espada" }).locked, true);
  assert.equal(normalizeReward({ name: "Espada", locked: false }).locked, false);
});

test("status transitions keep the date bookkeeping honest", () => {
  const base = normalizeQuest({ name: "Q" });

  const active = withStatus(base, QUEST_STATUS.active, 1000);
  assert.equal(active.date.start, 1000);
  assert.equal(active.date.end, null);

  const completed = withStatus(active, QUEST_STATUS.completed, 2000);
  assert.equal(completed.date.start, 1000, "a data de início deve ser preservada");
  assert.equal(completed.date.end, 2000);

  const reset = withStatus(completed, QUEST_STATUS.available, 3000);
  assert.equal(reset.date.start, null);
  assert.equal(reset.date.end, null);
});

test("completing a quest that never started still records a start date", () => {
  const done = withStatus(normalizeQuest({ name: "Q" }), QUEST_STATUS.completed, 500);
  assert.equal(done.date.start, 500);
  assert.equal(done.date.end, 500);
});

test("objective counts can exclude hidden entries", () => {
  const quest = normalizeQuest({
    // DEC-006/DEC-031: o default do schema virou OCULTO, entao visibilidade agora se
    // declara. O que este teste mede e a contagem, nao o default.
    objectives: [
      { name: "a", completed: true, hidden: false },
      { name: "b", hidden: false },
      { name: "c", completed: true, hidden: true }
    ]
  });

  assert.deepEqual(countObjectives(quest), { done: 2, failed: 0, total: 3 });
  assert.deepEqual(countObjectives(quest, { countHidden: false }), { done: 1, failed: 0, total: 2 });
});

test("reorderById moves entries and tolerates unknown ids", () => {
  const list = [{ id: "a" }, { id: "b" }, { id: "c" }];

  assert.deepEqual(reorderById(list, "c", "a").map((i) => i.id), ["c", "a", "b"]);
  assert.deepEqual(reorderById(list, "a", null).map((i) => i.id), ["b", "c", "a"]);
  assert.deepEqual(reorderById(list, "zzz", "a").map((i) => i.id), ["a", "b", "c"]);
  assert.deepEqual(reorderById(list, "a", "zzz").map((i) => i.id), ["b", "c", "a"]);
});

test("objective state cycles open -> completed -> failed -> open", () => {
  let objective = normalizeObjective({ name: "Alvo" });

  objective = cycleObjectiveState(objective);
  assert.deepEqual([objective.completed, objective.failed], [true, false]);

  objective = cycleObjectiveState(objective);
  assert.deepEqual([objective.completed, objective.failed], [false, true]);

  objective = cycleObjectiveState(objective);
  assert.deepEqual([objective.completed, objective.failed], [false, false]);
});

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

test("quests are read from and written to the master-quest flag only", async () => {
  const entry = makeEntry({ id: "q1", quest: normalizeQuest({ name: "Alvo", status: "active" }) });
  const quest = readQuest(entry);

  assert.equal(quest.id, "q1");
  assert.equal(quest.name, "Alvo");

  await saveQuest({ ...quest, name: "Renomeada" });

  assert.equal(entry.flags[MODULE_ID].quest.name, "Renomeada");
  assert.equal(entry.name, "Renomeada", "o nome do JournalEntry acompanha o da quest");
  assert.equal(entry.flags[FQL_MODULE_ID], undefined, "nada deve ser escrito no namespace do FQL");
});

test("the stored payload never carries the runtime entry", async () => {
  const entry = makeEntry({ id: "q1", quest: normalizeQuest({ name: "Alvo" }) });
  const payload = toStoredPayload(readQuest(entry));

  assert.equal(Object.hasOwn(payload, "entry"), false);
  assert.equal(Object.hasOwn(payload, "id"), false, "o id vem do JournalEntry, não do payload");
  assert.equal(JSON.stringify(payload).length > 0, true, "o payload deve ser serializável");
});

test("a journal entry without the flag is not a quest", () => {
  assert.equal(readQuest(makeEntry({ id: "plain" })), null);
});

test("players only read quests they can observe", () => {
  const entries = [
    makeEntry({ id: "open", quest: normalizeQuest({ name: "Aberta" }), ownership: { default: 2 } }),
    makeEntry({ id: "secret", quest: normalizeQuest({ name: "Secreta" }), ownership: { default: 0 } })
  ];

  const asGM = readAllQuests({ game: makeGame(entries, { isGM: true }) });
  const asPlayer = readAllQuests({ game: makeGame(entries, { isGM: false }) });

  assert.deepEqual(asGM.map((q) => q.id), ["open", "secret"]);
  assert.deepEqual(asPlayer.map((q) => q.id), ["open"]);
});

test("setQuestStatus persists both the status and the dates", async () => {
  const entry = makeEntry({ id: "q1", quest: normalizeQuest({ name: "Alvo" }) });
  const game = makeGame([entry]);

  await setQuestStatus("q1", QUEST_STATUS.active, { game });

  const stored = entry.flags[MODULE_ID].quest;
  assert.equal(stored.status, QUEST_STATUS.active);
  assert.equal(typeof stored.date.start, "number");
});

test("linking a subquest updates both sides and moves it off the old parent", async () => {
  const entries = [
    makeEntry({ id: "p1", quest: normalizeQuest({ name: "Pai 1" }) }),
    makeEntry({ id: "p2", quest: normalizeQuest({ name: "Pai 2" }) }),
    makeEntry({ id: "c1", quest: normalizeQuest({ name: "Filha" }) })
  ];
  const game = makeGame(entries);

  await linkSubquest("p1", "c1", { game });
  assert.deepEqual(readQuestById("p1", { game }).subquests, ["c1"]);
  assert.equal(readQuestById("c1", { game }).parent, "p1");

  await linkSubquest("p2", "c1", { game });
  assert.deepEqual(readQuestById("p1", { game }).subquests, [], "o pai antigo perde a filha");
  assert.deepEqual(readQuestById("p2", { game }).subquests, ["c1"]);
  assert.equal(readQuestById("c1", { game }).parent, "p2");
});

test("a quest cannot become its own descendant", async () => {
  const entries = [
    makeEntry({ id: "a", quest: normalizeQuest({ name: "A" }) }),
    makeEntry({ id: "b", quest: normalizeQuest({ name: "B" }) })
  ];
  const game = makeGame(entries);

  await linkSubquest("a", "b", { game });
  const result = await linkSubquest("b", "a", { game });

  assert.equal(result.status, "cycle");
  assert.equal(isAncestor("a", "b", { game }), true);
  assert.deepEqual(readQuestById("b", { game }).subquests, [], "o ciclo não pode ser gravado");
});

test("deleting a quest orphans its subquests instead of cascading", async () => {
  const entries = [
    makeEntry({ id: "root", quest: normalizeQuest({ name: "Raiz", subquests: ["child"] }) }),
    makeEntry({ id: "child", quest: normalizeQuest({ name: "Filha", parent: "root" }) })
  ];
  const game = makeGame(entries);

  const result = await deleteQuest("root", { game });

  assert.equal(result.status, "deleted");
  assert.deepEqual(result.orphaned, ["child"]);
  assert.equal(entries[0].deleted, true);
  assert.equal(entries[1].deleted, undefined, "a subquest não pode ser apagada em cascata");
  assert.equal(readQuestById("child", { game }).parent, null);
});

test("unlinking clears the relationship on both sides", async () => {
  const entries = [
    makeEntry({ id: "root", quest: normalizeQuest({ name: "Raiz", subquests: ["child"] }) }),
    makeEntry({ id: "child", quest: normalizeQuest({ name: "Filha", parent: "root" }) })
  ];
  const game = makeGame(entries);

  await unlinkSubquest("root", "child", { game });

  assert.deepEqual(readQuestById("root", { game }).subquests, []);
  assert.equal(readQuestById("child", { game }).parent, null);
});

test("createQuest writes a normalized quest to a new journal entry", async () => {
  const entries = [];
  const game = makeGame(entries);
  const JournalEntry = {
    async create(data) {
      const entry = makeEntry({ id: `q${entries.length + 1}`, name: data.name });
      entry.flags = data.flags ?? {};
      entries.push(entry);
      return entry;
    }
  };

  const quest = await createQuest({ name: "Nascente", status: "available" }, {
    game,
    JournalEntry,
    Folder: { create: async () => ({ id: "folder-1" }) }
  });

  assert.equal(quest.name, "Nascente");
  assert.equal(quest.status, "available");
  assert.equal(typeof quest.date.create, "number");
});

/* ------------------------------------------------------------------ *
 * FQL import
 * ------------------------------------------------------------------ */

const FQL_SAMPLE = {
  name: "01. The Junkyard Hounds",
  status: "active",
  giver: "Actor.abc",
  giverName: "OLF - Hound of Tindalos",
  description: "<p>Busca do Mainframe.</p>",
  gmnotes: "<p>Uso de mesa.</p>",
  playernotes: "<p>A expedição segue.</p>",
  splash: "worlds/olf/splash.webp",
  splashPos: "top",
  splashAsIcon: true,
  parent: "M02",
  subquests: ["s1"],
  tasks: [
    { uuidv4: "t-1", name: "Conduzir a expedição", completed: true, hidden: false },
    { uuidv4: "t-2", name: "Controlar a Pressão", completed: false, failed: true, hidden: true }
  ],
  rewards: [
    { uuidv4: "r-1", type: "abstract", data: { name: "Mapas Velhos", img: "icons/map.webp" }, hidden: false, locked: false },
    { uuidv4: "r-2", type: "item", data: { name: "Caixa-Preta", uuid: "Item.xyz" }, hidden: true, locked: true }
  ],
  date: { create: 1, start: 2, end: null }
};

test("an FQL payload converts field by field, ids included", () => {
  const quest = fqlToMasterQuest(FQL_SAMPLE);

  assert.equal(quest.name, FQL_SAMPLE.name);
  assert.equal(quest.status, "active");
  assert.equal(quest.parent, "M02");
  assert.deepEqual(quest.subquests, ["s1"]);
  assert.equal(quest.source, "imported-fql");

  // tasks -> objectives, uuidv4 -> id
  assert.equal(quest.objectives.length, 2);
  assert.equal(quest.objectives[0].id, "t-1");
  assert.equal(quest.objectives[0].completed, true);
  assert.equal(quest.objectives[1].hidden, true);
  assert.equal(quest.objectives[1].failed, true);

  // rewards flatten data.name / data.img
  assert.equal(quest.rewards[0].id, "r-1");
  assert.equal(quest.rewards[0].name, "Mapas Velhos");
  assert.equal(quest.rewards[0].img, "icons/map.webp");
  assert.equal(quest.rewards[0].locked, false);
  assert.equal(quest.rewards[1].uuid, "Item.xyz");
  assert.equal(quest.rewards[1].locked, true);

  assert.deepEqual(quest.date, { create: 1, start: 2, end: null });
});

test("the FQL import preview separates pending from already imported", () => {
  const entries = [
    makeEntry({ id: "a", fql: FQL_SAMPLE }),
    makeEntry({ id: "b", fql: FQL_SAMPLE, quest: normalizeQuest({ name: "Já importada" }) }),
    makeEntry({ id: "c" })
  ];

  const preview = previewFqlImport({ game: makeGame(entries) });

  assert.equal(preview.total, 2, "entradas sem flag do FQL ficam de fora");
  assert.equal(preview.pending, 1);
  assert.equal(preview.alreadyImported, 1);
});

test("importing never touches the original FQL flag", async () => {
  const entry = makeEntry({ id: "a", fql: FQL_SAMPLE });
  const game = makeGame([entry]);

  const result = await importFromFql({ game });

  assert.equal(result.imported, 1);
  assert.equal(entry.flags[MODULE_ID].quest.name, FQL_SAMPLE.name);
  assert.deepEqual(entry.flags[FQL_MODULE_ID].json, FQL_SAMPLE, "o flag do FQL deve ficar intacto");
});

test("importing is idempotent unless overwrite is requested", async () => {
  const entry = makeEntry({ id: "a", fql: FQL_SAMPLE });
  const game = makeGame([entry]);

  await importFromFql({ game });
  const second = await importFromFql({ game });
  assert.equal(second.imported, 0);
  assert.equal(second.skipped, 1);

  const third = await importFromFql({ game, overwrite: true });
  assert.equal(third.imported, 1);
});

test("a dry-run import writes nothing", async () => {
  const entry = makeEntry({ id: "a", fql: FQL_SAMPLE });
  const result = await importFromFql({ game: makeGame([entry]), dryRun: true });

  assert.equal(result.status, "dry-run");
  assert.equal(entry.flags[MODULE_ID], undefined);
});

/* ------------------------------------------------------------------ *
 * View models
 * ------------------------------------------------------------------ */

function questFixture(overrides = {}) {
  const entry = makeEntry({
    id: overrides.id ?? "q1",
    ownership: overrides.ownership ?? { default: 2 }
  });
  return { ...normalizeQuest(overrides), id: overrides.id ?? "q1", entry };
}

test("the log groups quests by status and hides the inactive tab from players", () => {
  const quests = [
    questFixture({ id: "a", name: "A", status: "active" }),
    questFixture({ id: "b", name: "B", status: "completed" }),
    questFixture({ id: "c", name: "C", status: "inactive" })
  ];

  const gm = buildQuestLogViewModel(quests, { isGM: true });
  assert.deepEqual(gm.tabs.map((t) => t.id), ["available", "active", "completed", "failed", "inactive"]);
  assert.equal(gm.quests.active.length, 1);

  const player = buildQuestLogViewModel(quests, { isGM: false });
  assert.equal(player.tabs.some((t) => t.id === "inactive"), false);
});

test("players never receive status action buttons", () => {
  const quests = [questFixture({ id: "a", name: "A", status: "active" })];

  assert.ok(buildQuestLogViewModel(quests, { isGM: true }).quests.active[0].statusActions.length > 0);
  assert.equal(buildQuestLogViewModel(quests, { isGM: false }).quests.active[0].statusActions.length, 0);
});

test("a quest with no player ownership is hidden, and players do not see it", () => {
  const secret = questFixture({ id: "s", name: "Secreta", status: "active", ownership: { default: 0 } });
  const open = questFixture({ id: "o", name: "Aberta", status: "active", ownership: { default: 2 } });

  assert.equal(isQuestHidden(secret), true);
  assert.equal(isQuestHidden(open), false);

  const player = buildQuestLogViewModel([secret, open], { isGM: false });
  assert.deepEqual(player.quests.active.map((r) => r.id), ["o"]);
});

test("the log row shows the objective badge and the parent name", () => {
  const parent = questFixture({ id: "p", name: "Mãe", status: "active" });
  const child = questFixture({
    id: "c",
    name: "Filha",
    status: "active",
    parent: "p",
    objectives: [{ name: "a", completed: true }, { name: "b" }]
  });

  const model = buildQuestLogViewModel([parent, child], { isGM: true });
  const row = model.quests.active.find((r) => r.id === "c");

  assert.equal(row.objectiveBadge, "1/2");
  assert.equal(row.isSubquest, true);
  assert.equal(row.parentName, "Mãe");
});

test("the details view hides GM-only material from players", () => {
  const quest = questFixture({
    id: "q",
    name: "Q",
    status: "active",
    objectives: [{ name: "visível", hidden: false }, { name: "oculto", hidden: true }],
    rewards: [
      { name: "aberta", hidden: false },
      { name: "escondida", hidden: true }
    ]
  });

  const gm = buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true });
  assert.equal(gm.objectives.length, 2);
  assert.equal(gm.rewards.length, 2);
  assert.equal(gm.tabs.some((t) => t.id === "gmnotes"), true);

  const player = buildQuestDetailsViewModel(quest, { isGM: false, canEdit: false });
  assert.equal(player.objectives.length, 1);
  assert.equal(player.rewards.length, 1);
  assert.equal(player.tabs.some((t) => t.id === "gmnotes"), false);
  assert.equal(player.tabs.some((t) => t.id === "management"), false);
});

test("DEC-031: recompensa oculta nao chega ao jogador; a visivel chega com o nome aberto", () => {
  // O cadeado saiu na 0.20 e com ele o meio-termo "Recompensa nao revelada": ou o jogador
  // nao ve a linha, ou ve a linha inteira. Quem decide e so `hidden`.
  const quest = questFixture({
    id: "q",
    rewards: [
      { name: "Segredo", hidden: true },
      { name: "Aberta", hidden: false }
    ]
  });

  const gm = buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true });
  assert.equal(gm.rewards.length, 2);

  const player = buildQuestDetailsViewModel(quest, { isGM: false });
  assert.deepEqual(player.rewards.map((r) => r.name), ["Aberta"]);
  assert.equal(player.rewards.every((r) => "revealed" in r), false, "`revealed` saiu do modelo");
});

test("DEC-031: `granted` e eixo proprio, sem relacao com visibilidade", () => {
  const quest = questFixture({
    id: "q",
    rewards: [
      { name: "Conquistada e visivel", hidden: false, granted: true },
      { name: "Conquistada e oculta", hidden: true, granted: true }
    ]
  });

  const gm = buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true });
  assert.equal(gm.allRewardsGranted, true);
  assert.equal(gm.allRewardsVisible, false);
});

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

test("quest names are escaped when rendered into the log", () => {
  const quest = questFixture({ id: "x", name: '<img src=x onerror="alert(1)">', status: "active" });
  const html = renderQuestLog(buildQuestLogViewModel([quest], { isGM: true }));

  // The payload must survive only as inert text: no tag ever opens.
  assert.equal(html.includes("<img"), false, "nenhuma tag <img> pode ser aberta pelo nome da quest");
  assert.ok(html.includes("&lt;img src=x onerror=&quot;"), "o nome deve aparecer inteiramente escapado");
});

test("quest details escape names and neutralize stored HTML", () => {
  const quest = questFixture({
    id: "x",
    name: 'Quest "perigosa" <b>x</b>',
    status: "active",
    description: '<p>ok</p><script>alert(1)</script><a href="javascript:alert(1)">x</a>'
  });

  const html = renderQuestDetails(buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true }));

  assert.equal(html.includes("<script"), false, "nenhuma tag <script> pode ser aberta");
  assert.equal(html.includes('href="javascript:'), false, "nenhum href executável pode sobreviver");
  assert.equal(html.includes("<b>x</b>"), false, "o nome não pode injetar marcação");
  assert.ok(html.includes("&quot;perigosa&quot;"), "as aspas do nome devem estar escapadas");
});

test("esc neutralizes every HTML metacharacter", () => {
  assert.equal(esc(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
});

test("safeHtml falls back to escaping when no DOM is available", () => {
  // Node has no document, so safeHtml must not silently pass raw HTML through.
  const output = safeHtml("<script>alert(1)</script>");
  assert.equal(output.includes("<script>"), false);
});

/**
 * Foundry v14 regression: FQL cannot be enabled (its manifest caps at v13), so any
 * `getFlag("forien-quest-log", …)` throws `Flag scope … is not valid or not currently
 * active` — even though the payload is still on the JournalEntry. Reading the flag data
 * directly must keep working, or the hub cannot render at all.
 */
function makeV14Entry(options) {
  const entry = makeEntry(options);
  const activeScopes = new Set(["core", "swade", MODULE_ID]);
  const reject = (scope) => {
    if (!activeScopes.has(scope)) {
      throw new Error(`Flag scope "${scope}" is not valid or not currently active`);
    }
  };

  entry.getFlag = (scope, key) => {
    reject(scope);
    return entry.flags?.[scope]?.[key] ?? null;
  };
  entry.setFlag = async (scope, key, value) => {
    reject(scope);
    entry.flags[scope] = { ...(entry.flags[scope] ?? {}), [key]: value };
    return entry;
  };

  return entry;
}

test("the FQL preview survives a world where the FQL module cannot be activated", () => {
  const entries = [
    makeV14Entry({ id: "a", fql: FQL_SAMPLE }),
    makeV14Entry({ id: "b", fql: FQL_SAMPLE, quest: normalizeQuest({ name: "Já importada" }) }),
    makeV14Entry({ id: "c" })
  ];

  const preview = previewFqlImport({ game: makeGame(entries) });

  assert.equal(preview.total, 2);
  assert.equal(preview.pending, 1);
  assert.equal(preview.alreadyImported, 1);
});

test("importing works with the FQL module disabled, without calling getFlag on its scope", async () => {
  const entry = makeV14Entry({ id: "a", fql: FQL_SAMPLE });
  const game = makeGame([entry]);

  const result = await importFromFql({ game });

  assert.equal(result.failed, 0);
  assert.equal(result.imported, 1);
  assert.equal(entry.flags[MODULE_ID].quest.name, FQL_SAMPLE.name);
  assert.deepEqual(entry.flags[FQL_MODULE_ID].json, FQL_SAMPLE, "o flag do FQL deve ficar intacto");
});

/* ------------------------------------------------------------------ *
 * DEC-035 — Problems, Complications e os dois eixos
 * ------------------------------------------------------------------ */

test("DEC-035: a linha de Dilema nao tem checkbox, e resolve preserva o desfecho", () => {
  const quest = questFixture({
    id: "q",
    name: "Q",
    status: "active",
    dilemmas: [{ id: "p1", name: "O destino de Ygerr", state: "open", table: "Cofre", hidden: false, known: true }]
  });

  // 1.1.0: o Dilema desceu para a Manage. O contrato do gesto (Resolve, nunca checkbox)
  // e o mesmo — DEC-035 nao mudou, so mudou de aba.
  const gm = buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab: "management" });
  const html = renderQuestDetails(gm);

  assert.ok(html.includes("Dilemmas"), "a secao existe");
  assert.equal(html.includes('data-action="cycle-objective" data-objective-id="p1"'), false, "problema nunca usa o controle de objetivo");
  assert.ok(html.includes('data-action="toggle-dilemma-state"'), "o gesto e Resolve, nao checkbox");
  assert.ok(html.includes(">Resolve<"), "problema aberto oferece Resolve");
});

test("DEC-035: 'nao sabe mas ve' marca a linha; 'sabe mas nao ve' nao marca", () => {
  const quest = questFixture({
    id: "q",
    name: "Q",
    status: "active",
    objectives: [
      { id: "o1", name: "spoiler", hidden: false, known: false },
      { id: "o2", name: "legitimo", hidden: true, known: true }
    ]
  });

  const gm = buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true });
  const [o1, o2] = gm.objectives;
  assert.equal(o1.spoiler, true, "painel entregou spoiler: sinaliza");
  assert.equal(o2.spoiler, false, "a mesa descobriu em jogo: nao e erro");

  const html = renderQuestDetails(gm);
  assert.ok(html.includes("is-spoiler"), "o filete aparece");

  // jogador nunca ve a calha diegetica nem o filete
  const player = buildQuestDetailsViewModel(quest, { isGM: false });
  const playerHtml = renderQuestDetails(player);
  assert.equal(playerHtml.includes("mq-known"), false, "eixo D e instrumento do Mestre");
  assert.equal(playerHtml.includes("is-spoiler"), false);
});

test("DEC-035: jogador ve dilema/complicacao nao-ocultos, sem controles", () => {
  const quest = questFixture({
    id: "q",
    name: "Q",
    status: "active",
    dilemmas: [
      { id: "p1", name: "visivel", hidden: false },
      { id: "p2", name: "oculto", hidden: true }
    ],
    complications: [{ id: "c1", name: "incidiu", trigger: "x", severity: "grave", hidden: false }]
  });

  const player = buildQuestDetailsViewModel(quest, { isGM: false, canEdit: false });
  assert.deepEqual(player.dilemmas.map((p) => p.name), ["visivel"]);
  assert.equal(player.complications.length, 1);

  const html = renderQuestDetails(player);
  assert.equal(html.includes("toggle-dilemma-state"), false, "sem gesto de resolver para jogador");
  assert.equal(html.includes("delete-complication"), false);
});

/* ------------------------------------------------------------------ *
 * 0.22.0 — Clues, Outcomes, Log e o bloco derivado
 * ------------------------------------------------------------------ */

import { diffQuestForLog, logToMarkdown } from "../src/quest/quest-log-diff.js";

test("1.1.0: a ordem canonica sobrevive, agora repartida entre Overview e Manage", () => {
  // Ate a 1.0.1 as seis colecoes desciam numa coluna so, nesta ordem: Dilemmas,
  // Objectives, Clues, Rewards, Complications, Outcomes (Mario, 2026-08-06: o dilema
  // define o tom da quest e abre a coluna).
  //
  // A 1.1.0 corta essa coluna em duas telas, pelo criterio de Mario de 2026-08-19:
  //   OVERVIEW  a trajetoria, o que o jogador pode ver: Objectives, Clues, Rewards
  //   MANAGE    a maquinaria do Mestre: Dilemmas, Complications, Outcomes
  // A ordem RELATIVA de cada metade continua sendo verificada aqui.
  const quest = questFixture({
    id: "q", name: "Q", status: "active",
    clues: [{ id: "c1", name: "A pagina arrancada", hidden: false }],
    outcomes: [{ id: "o1", name: "O desfecho do cofre", hidden: false }]
  });
  const render = (activeTab) =>
    renderQuestDetails(buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab }));

  const emOrdem = (html, marcas) => {
    let pos = -1;
    for (const marca of marcas) {
      const i = html.indexOf(marca);
      assert.ok(i > pos, `${marca} fora de ordem`);
      pos = i;
    }
  };

  emOrdem(render("details"), [">Objectives<", ">Clues<", ">Rewards"]);
  emOrdem(render("management"), [">Dilemmas<", ">Complications<", ">Outcomes<"]);
});

test("0.23: o diff do Log registra so FICCAO \u2014 revelar/ocultar e gerenciamento e fica fora", () => {
  const before = normalizeQuest({
    name: "Q",
    rewards: [{ id: "r1", name: "Mapa", hidden: true, granted: false }],
    dilemmas: [{ id: "d1", name: "Ygerr", state: "open" }]
  });
  const after = normalizeQuest({
    ...before,
    rewards: [{ id: "r1", name: "Mapa", hidden: false, granted: true }],
    dilemmas: [{ id: "d1", name: "Ygerr", state: "resolved" }]
  });

  const entries = diffQuestForLog(before, after, 1754400000000);
  const changes = entries.map((e) => `${e.target}: ${e.change}`).sort();
  // "Mapa: revealed" NAO aparece: hidden e curadoria de painel, nao acontecimento.
  assert.deepEqual(changes, ["Mapa: granted", "Ygerr: open \u2192 resolved"]);
  assert.ok(entries.every((e) => e.reason === ""), "a razao nasce vazia e pendente");
  assert.ok(entries.every((e) => e.origin === "auto"), "diff central assina como auto");

  const md = logToMarkdown("Q", entries);
  assert.ok(md.includes("reason pending"));
});

test("0.23: adicionar e remover item nao entram no Log \u2014 edicao de estrutura nao e ficcao", () => {
  const before = normalizeQuest({ name: "Q", clues: [{ id: "c1", name: "Pista" }] });
  const after = normalizeQuest({ name: "Q", clues: [{ id: "c2", name: "Outra" }] });
  assert.deepEqual(diffQuestForLog(before, after, 1), []);
});

test("0.23: o carimbo de sessao entra em cada linha e o Markdown agrupa por sessao", () => {
  const before = normalizeQuest({ name: "Q", clues: [{ id: "c1", name: "Pista", found: false }] });
  const after = normalizeQuest({ ...before, clues: [{ id: "c1", name: "Pista", found: true }] });

  const entries = diffQuestForLog(before, after, 1754400000000, 3);
  assert.equal(entries[0].session, 3);

  const sessions = [{ number: 3, date: "2026-08-06", title: "A sombra no cofre" }];
  const md = logToMarkdown("Q", entries, sessions);
  assert.ok(md.includes("## Session 3 \u2014 2026-08-06 \u2014 A sombra no cofre"));

  // sem carimbo: grupo inicial, nunca uma sessao inventada
  const legacy = logToMarkdown("Q", [{ ...entries[0], session: null }], sessions);
  assert.ok(legacy.includes("## Before session records"));
});

test("0.30.3: o bloco derivado do Player Notes separa progresso e mostra so clues encontradas, conhecidas e visiveis", () => {
  const quest = questFixture({
    id: "q", name: "Q", status: "active",
    playernotes: "<p>anotacao do jogador</p>",
    objectives: [
      { id: "o1", name: "feito e visivel", completed: true, hidden: false },
      { id: "o2", name: "feito e oculto", completed: true, hidden: true }
    ],
    rewards: [
      { id: "r1", name: "ganho visivel", granted: true, hidden: false },
      { id: "r2", name: "ganho oculto", granted: true, hidden: true }
    ],
    clues: [
      { id: "c1", name: "pista encontrada, conhecida e visivel", found: true, known: true, hidden: false },
      { id: "c2", name: "pista encontrada mas oculta", found: true, known: true, hidden: true },
      { id: "c3", name: "pista encontrada mas ainda desconhecida", found: true, known: false, hidden: false },
      { id: "c4", name: "pista conhecida mas nao encontrada", found: false, known: true, hidden: false }
    ]
  });

  const player = buildQuestDetailsViewModel(quest, { isGM: false, canEdit: false, activeTab: "playernotes" });
  const html = renderQuestDetails(player);
  assert.ok(html.includes("Progress so far"));
  assert.ok(html.includes("feito e visivel"));
  assert.equal(html.includes("feito e oculto"), false, "objetivo oculto nunca entra, mesmo completo");
  assert.ok(html.includes("ganho visivel"));
  assert.equal(html.includes("ganho oculto"), false);
  assert.ok(html.includes(">Objectives<"));
  assert.ok(html.includes(">Rewards<"));
  assert.ok(html.includes(">Clues<"));
  assert.ok(html.includes("fa-magnifying-glass-plus"));
  assert.ok(html.includes("pista encontrada, conhecida e visivel"));
  assert.equal(html.includes("pista encontrada mas oculta"), false);
  assert.equal(html.includes("pista encontrada mas ainda desconhecida"), false);
  assert.equal(html.includes("pista conhecida mas nao encontrada"), false);
  assert.ok(html.indexOf(">Rewards<") < html.indexOf(">Clues<"), "Clues ficam logo abaixo de Rewards");
  assert.equal(html.includes('contenteditable="true" data-log'), false);

  // bloco vazio nao se desenha
  const semNada = questFixture({ id: "q2", name: "Q2", status: "active", playernotes: "" });
  const html2 = renderQuestDetails(buildQuestDetailsViewModel(semNada, { isGM: false, activeTab: "playernotes" }));
  assert.equal(html2.includes("Progress so far"), false);
});

test("0.22: aba Log existe so para o GM e a razao pendente e visivel", () => {
  const quest = questFixture({
    id: "q", name: "Q", status: "active",
    log: [{ id: "l1", at: 1754400000000, target: "Mapa", targetType: "reward", change: "granted", reason: "" }]
  });

  const gm = buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab: "log" });
  assert.ok(gm.tabs.some((t) => t.id === "log"));
  const html = renderQuestDetails(gm);
  assert.ok(html.includes("is-pending"), "razao vazia aparece tracejada");
  assert.ok(html.includes("Copy Markdown"));

  const player = buildQuestDetailsViewModel(quest, { isGM: false, activeTab: "log" });
  assert.equal(player.tabs.some((t) => t.id === "log"), false, "jogador nao tem a aba");
});

/* ------------------------------------------------------------------ *
 * 0.23.0 — severidade do dilema, Sessions, Log editorial, Wrap Up
 * ------------------------------------------------------------------ */

import { currentSession, normalizeDilemma, normalizeLogEntry, normalizeSession } from "../src/quest/quest-schema.js";
import { buildWrapupReport, makeWrapupFilename } from "../src/reports/quest-wrapup-report.js";

test("0.23: dilema tem a mesma escada leve/grave/severa, default leve", () => {
  assert.equal(normalizeDilemma({ name: "d" }).severity, "leve");
  assert.equal(normalizeDilemma({ name: "d", severity: "severa" }).severity, "severa");
  assert.equal(normalizeDilemma({ name: "d", severity: "absurda" }).severity, "leve", "valor fora da escada degrada");
});

test("0.23: sessions normalizam, deduplicam por numero e a corrente e a maior", () => {
  const quest = normalizeQuest({
    name: "Q",
    sessions: [
      { number: 2, date: "2026-08-01", title: "velha" },
      { number: 1, date: "2026-07-20" },
      { number: 2, date: "2026-08-02", title: "editada" }
    ]
  });
  assert.deepEqual(quest.sessions.map((s) => s.number), [1, 2], "ordenadas; duplicata fica com a ULTIMA (edicao)");
  assert.equal(quest.sessions[1].title, "editada");
  assert.equal(currentSession(quest).number, 2);
  assert.equal(currentSession(normalizeQuest({ name: "Q" })), null, "sem sessao aberta, corrente e null");
  assert.equal(normalizeSession({}).number, 1, "numero minimo e 1");
});

test("0.23: log entry carrega session e origin; manual e reconhecido", () => {
  const auto = normalizeLogEntry({ target: "x", change: "granted" });
  assert.equal(auto.session, null);
  assert.equal(auto.origin, "auto");
  const manual = normalizeLogEntry({ target: "x", change: "note", session: 4, origin: "manual" });
  assert.equal(manual.session, 4);
  assert.equal(manual.origin, "manual");
});

test("0.23: wrappedUp e flag da mesa, reversivel, default false", () => {
  assert.equal(normalizeQuest({ name: "Q" }).wrappedUp, false);
  assert.equal(normalizeQuest({ name: "Q", wrappedUp: true }).wrappedUp, true);
});

test("1.1.0: a MANAGE mostra a sessao corrente e o botao New session", () => {
  const quest = questFixture({
    id: "q", name: "Q", status: "active",
    sessions: [{ number: 2, date: "2026-08-06", title: "A sombra" }]
  });
  // 1.1.0: o controle de sessao saiu da aba que o jogador ve. Sessao e instrumento puro
  // do Mestre, e o criterio novo poe isso atras da cortina.
  const html = renderQuestDetails(
    buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab: "management" })
  );
  assert.ok(html.includes("mq-session"), "controle de sessao presente");
  assert.ok(html.includes("New session"));
  assert.ok(html.includes("A sombra"));

  const player = renderQuestDetails(buildQuestDetailsViewModel(quest, { isGM: false }));
  assert.equal(player.includes("mq-session"), false, "sessao e instrumento do Mestre");
});

test("0.23: aba Log agrupa por sessao, tem + Entry, delete e push-to-notes por linha", () => {
  const quest = questFixture({
    id: "q", name: "Q", status: "active",
    sessions: [{ number: 1, date: "2026-08-06", title: "Abertura" }],
    log: [
      { id: "l1", at: 1, target: "Mapa", targetType: "reward", change: "granted", reason: "", session: 1, origin: "auto" },
      { id: "l2", at: 2, target: "Nota do Mestre", targetType: "note", change: "aconteceu", reason: "", session: 1, origin: "manual" }
    ]
  });
  const html = renderQuestDetails(buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab: "log" }));
  assert.ok(html.includes("Session 1"), "heading de sessao");
  assert.ok(html.includes("log-add-manual"), "inclusao manual");
  assert.ok(html.includes("log-delete"), "toda linha se apaga");
  assert.ok(html.includes("log-push-gm") && html.includes("log-push-player"), "herdar e gesto por linha");
  assert.ok(html.includes("data-log-target") && html.includes("data-log-change"), "toda coluna se edita");
  assert.ok(html.includes("mq-log-manual"), "linha manual e marcada");
});

test("0.23: Wrap Up reversivel no rodape; Report so com o caderno fechado", () => {
  const quest = questFixture({ id: "q", name: "Q", status: "active" });
  // 1.1.0: o rodape com Wrap Up e Snapshot desceu para a Manage e ganhou Permissions.
  const open = renderQuestDetails(
    buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true, activeTab: "management" })
  );
  assert.ok(open.includes("toggle-wrapup") && open.includes("Wrap Up"));
  assert.equal(open.includes("wrapup-report"), false, "sem relatorio antes do encerramento");

  const wrapped = questFixture({ id: "q2", name: "Q", status: "completed", wrappedUp: true });
  const closed = renderQuestDetails(
    buildQuestDetailsViewModel(wrapped, { isGM: true, canEdit: true, activeTab: "management" })
  );
  assert.ok(closed.includes("Reopen"), "gesto reversivel");
  assert.ok(closed.includes("wrapup-report"), "a ata aparece");
  assert.ok(closed.includes("wrapped up"), "selo no cabecalho");
});

test("0.23: o relatorio de Wrap Up conta ficcao, metajogo e o log por sessao", () => {
  const quest = normalizeQuest({
    name: "O destino de Ygerr",
    status: "completed",
    designId: "MQ-ATO1-01",
    sessions: [{ number: 1, date: "2026-08-01", title: "Abertura" }],
    dilemmas: [{ id: "d1", name: "O cofre", severity: "grave", state: "resolved", resolution: "Entregaram a chave" }],
    objectives: [
      { id: "o1", name: "Achar o cofre", completed: true },
      { id: "o2", name: "Poupar Sabotei", completed: false }
    ],
    clues: [
      { id: "c1", name: "A pagina arrancada", found: true },
      { id: "c2", name: "O selo quebrado", found: false }
    ],
    rewards: [{ id: "r1", name: "Mapa", granted: true }, { id: "r2", name: "Anel", granted: false }],
    complications: [{ id: "k1", name: "Os Chacais", severity: "severa", trigger: "inimizade", fired: true }],
    outcomes: [
      { id: "u1", name: "O cofre aberto", occurred: true, record: "Abriram na calada" },
      { id: "u2", name: "A fuga", occurred: false }
    ],
    log: [{ id: "l1", at: 1, target: "Mapa", targetType: "reward", change: "granted", reason: "pagamento", session: 1 }]
  });

  const md = buildWrapupReport(quest, { generatedAt: "2026-08-06T12:00:00Z" });
  assert.ok(md.includes("# Wrap-Up — O destino de Ygerr"));
  assert.ok(md.includes("## The question the quest posed"));
  assert.ok(md.includes("severity: grave"));
  assert.ok(md.includes("Entregaram a chave"));
  assert.ok(md.includes("[x] Achar o cofre"));
  assert.ok(md.includes("[ ] Poupar Sabotei — left open"));
  assert.ok(md.includes("A pagina arrancada"));
  assert.ok(md.includes("Os Chacais"));
  assert.ok(md.includes("Abriram na calada"));
  // metajogo: o que ficou na mesa e insumo de follow-up
  assert.ok(md.includes("Clue never found: O selo quebrado"));
  assert.ok(md.includes("Reward never granted: Anel"));
  assert.ok(md.includes("Ending that did not come to pass: A fuga"));
  // log por sessao, com razao
  assert.ok(md.includes("### Session 1 — 2026-08-01 — Abertura"));
  assert.ok(md.includes("_pagamento_"));

  assert.ok(makeWrapupFilename(quest, "2026-08-06T12:00:00Z").startsWith("masterquest-wrapup-o-destino-de-ygerr-"));
});
