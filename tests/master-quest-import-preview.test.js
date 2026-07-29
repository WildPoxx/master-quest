import assert from "node:assert/strict";
import test from "node:test";
import { generateMasterQuestImportPreview } from "../src/importing/master-quest-import-preview.js";

test("text import preview creates a local agnostic draft candidate", () => {
  const preview = generateMasterQuestImportPreview(
    "# The Glass Border\n\nA strange light silences the border station.",
    { title: "The Glass Border" }
  );

  assert.equal(preview.schemaVersion, 1);
  assert.equal(preview.mode, "import-preview-only");
  assert.equal(preview.sourceType, "text");
  assert.equal(preview.writeMode, "none");
  assert.equal(preview.readyForDraft, true);
  assert.equal(preview.readyForWrite, false);
  assert.equal(preview.candidateCount, 1);
  assert.equal(preview.candidates[0].draft.system, "agnostic");
  assert.equal(preview.candidates[0].draft.systemProfile, null);
  assert.ok(preview.operations.every((operation) => operation.writeCapable === false));
});

test("journal index import preview maps journal entries into source scenes", () => {
  const preview = generateMasterQuestImportPreview({
    title: "Modulo 2 Source",
    entries: [
      {
        id: "act-1",
        uuid: "JournalEntry.act-1",
        name: "Ato I - The Junkyard Hounds",
        pages: [
          {
            name: "Premise",
            text: { content: "<p>The posse follows a memory signal.</p>" }
          }
        ]
      },
      {
        id: "act-2",
        uuid: "JournalEntry.act-2",
        name: "Ato II - A Cacada de Kryll"
      }
    ]
  });

  const draft = preview.candidates[0].draft;

  assert.equal(preview.sourceType, "journal-index");
  assert.equal(draft.title, "Modulo 2 Source");
  assert.equal(draft.scenes.length, 2);
  assert.equal(draft.storyAnchors.length, 2);
  assert.match(draft.gmSummary, /The Junkyard Hounds/);
  assert.equal(preview.operations[0].operation, "would-create-master-quest-draft");
});

test("FQL snapshot import preview treats legacy quests as source material only", () => {
  const preview = generateMasterQuestImportPreview({
    questStates: [
      {
        id: "quest-a",
        uuid: "JournalEntry.quest-a",
        name: "01. The Junkyard Hounds",
        fqlPayload: {
          description: "Busca do Mainframe / Sinal Memoria.",
          tasks: [
            { title: "Enter the Junkyard", completed: false },
            { title: "Recover the signal cache", completed: true }
          ],
          rewards: [{ title: "Old field map", unlocked: false }]
        }
      }
    ]
  });

  const draft = preview.candidates[0].draft;

  assert.equal(preview.sourceType, "fql-snapshot");
  assert.equal(preview.candidateCount, 1);
  assert.equal(draft.title, "01. The Junkyard Hounds");
  assert.equal(draft.objectives.length, 2);
  assert.equal(draft.rewards.length, 1);
  assert.equal(draft.foundryMapping.writeMode, "none");
  assert.ok(preview.safety.some((line) => line.includes("No legacy FQL payload is written")));
});
