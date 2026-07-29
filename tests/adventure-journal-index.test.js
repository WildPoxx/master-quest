import assert from "node:assert/strict";
import test from "node:test";
import { readAdventureJournalIndex } from "../src/journal/read-adventure-journal-index.js";

test("adventure journal index reads Foundry journal metadata by folder", () => {
  const journal = [
    makeJournalEntry({
      id: "act1",
      name: "03. Ato I - The Junkyard Hounds",
      folder: { id: "module2", name: "Modulo 2 - A Sun for Each Destiny" },
      sort: 300000,
      pages: [
        makePage({
          id: "overview",
          name: "01. Visao Geral",
          sort: 100000,
          content: "<p>Mainframe @JournalEntry[abc]{Link}</p>"
        }),
        makePage({
          id: "mechanics",
          name: "02. Mecanicas",
          sort: 200000,
          content: "<p>Relogios e perigos.</p>"
        })
      ]
    }),
    makeJournalEntry({
      id: "outside",
      name: "OLF - Arcane Lore",
      folder: { id: "lore", name: "OLF - Arcane Lore" },
      sort: 100000,
      pages: []
    })
  ];

  const index = readAdventureJournalIndex({
    journal,
    folderName: "Modulo 2 - A Sun for Each Destiny"
  });

  assert.equal(index.length, 1);
  assert.equal(index[0].id, "act1");
  assert.equal(index[0].folderId, "module2");
  assert.equal(index[0].folderName, "Modulo 2 - A Sun for Each Destiny");
  assert.equal(index[0].pageCount, 2);
  assert.deepEqual(index[0].pages.map((page) => page.name), ["01. Visao Geral", "02. Mecanicas"]);
  assert.deepEqual(index[0].pages[0].journalLinks, ["@JournalEntry[abc]{Link}"]);
});

test("adventure journal index does not expose page text unless explicitly requested", () => {
  const journal = [
    makeJournalEntry({
      id: "gm",
      name: "07. Atualizacao Pos-Sessao",
      folder: { id: "module2", name: "Modulo 2 - A Sun for Each Destiny" },
      pages: [
        makePage({
          id: "secret",
          name: "GM Notes",
          content: "<p>Segredo de mestre.</p>"
        })
      ]
    })
  ];

  const [safeEntry] = readAdventureJournalIndex({ journal });
  const [openEntry] = readAdventureJournalIndex({ journal, includePageContent: true });

  assert.equal(safeEntry.pages[0].textLength, 25);
  assert.equal(Object.hasOwn(safeEntry.pages[0], "textContent"), false);
  assert.equal(openEntry.pages[0].textContent, "<p>Segredo de mestre.</p>");
});

test("adventure journal index supports Foundry collection-like inputs", () => {
  const journal = {
    contents: [
      makeJournalEntry({ id: "two", name: "02. Elenco", sort: 200000 }),
      makeJournalEntry({ id: "one", name: "01. Premissa", sort: 100000 })
    ]
  };

  const index = readAdventureJournalIndex({ journal, namePattern: /^\d\d\./ });

  assert.deepEqual(index.map((entry) => entry.id), ["one", "two"]);
});

function makeJournalEntry({ id, name, folder = null, sort = 0, pages = [] }) {
  return {
    id,
    uuid: `JournalEntry.${id}`,
    name,
    folder,
    sort,
    pages
  };
}

function makePage({ id, name, type = "text", sort = 0, content = "" }) {
  return {
    id,
    uuid: `JournalEntryPage.${id}`,
    name,
    type,
    sort,
    text: { content }
  };
}
