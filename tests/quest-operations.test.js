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
    objectives: [
      { name: "a", completed: true },
      { name: "b" },
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
    objectives: [{ name: "visível" }, { name: "oculto", hidden: true }],
    rewards: [
      { name: "aberta", hidden: false, locked: false },
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

test("a locked reward is not revealed to players but is to the GM", () => {
  const quest = questFixture({ id: "q", rewards: [{ name: "Segredo", locked: true }] });

  assert.equal(buildQuestDetailsViewModel(quest, { isGM: true, canEdit: true }).rewards[0].revealed, true);
  assert.equal(buildQuestDetailsViewModel(quest, { isGM: false }).rewards[0].revealed, false);
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
