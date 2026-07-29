import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";
import { readQuestStates } from "../src/fql/read-quest-states.js";
import { makeMockJournalDocuments, readJson } from "./helpers.js";

test("reads FQL quest states from JournalEntry flags and preserves unknown fields", async () => {
  const fixtures = await readJson(resolve("fixtures/fql/sample-journal-quests.json"));
  const journal = makeMockJournalDocuments(fixtures);
  const states = readQuestStates({ journal });

  assert.equal(states.length, 2);

  const visibleQuest = states.find((quest) => quest.id === "quest-visible");
  assert.equal(visibleQuest.status, "active");
  assert.equal(visibleQuest.visibility.playersVisible, true);
  assert.equal(visibleQuest.tasks.length, 2);
  assert.equal(visibleQuest.rewards.length, 2);
  assert.equal(visibleQuest.playerNotes, "The convoy case remains open and politically dangerous.");
  assert.deepEqual(visibleQuest.unknownFields.customMystery, { preserve: true });
  assert.deepEqual(visibleQuest.source.customMystery, { preserve: true });
  assert.equal(visibleQuest.journalLinks[0], "@JournalEntry[secretPage]{GM page}");

  const hiddenQuest = states.find((quest) => quest.id === "quest-hidden");
  assert.equal(hiddenQuest.visibility.playersVisible, false);
  assert.equal(hiddenQuest.visibility.gmOnly, true);
});

test("can filter hidden quests out of read results", async () => {
  const fixtures = await readJson(resolve("fixtures/fql/sample-journal-quests.json"));
  const journal = makeMockJournalDocuments(fixtures);
  const states = readQuestStates({ journal, includeHidden: false });

  assert.deepEqual(states.map((quest) => quest.id), ["quest-visible"]);
});

test("reads gmNotes legacy casing without treating it as an unknown field", () => {
  const [state] = readQuestStates({
    journal: makeMockJournalDocuments([
      {
        id: "quest-gm-notes-casing",
        name: "Quest With gmNotes",
        flags: {
          "forien-quest-log": {
            json: {
              name: "Quest With gmNotes",
              status: "active",
              gmNotes: "GM note using legacy camel-case.",
              playerNotes: "Player note using legacy camel-case.",
              tasks: [],
              rewards: []
            }
          }
        }
      }
    ])
  });

  assert.equal(state.gmnotes, "GM note using legacy camel-case.");
  assert.equal(state.playerNotes, "Player note using legacy camel-case.");
  assert.equal(state.unknownFields.gmNotes, undefined);
  assert.equal(state.unknownFields.playerNotes, undefined);
});
