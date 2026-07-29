import { readFile } from "node:fs/promises";

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

export function makeMockJournalDocuments(fixtures) {
  return fixtures.map((fixture) => ({
    ...fixture,
    getFlag(moduleId, key) {
      return fixture.flags?.[moduleId]?.[key] ?? null;
    }
  }));
}
