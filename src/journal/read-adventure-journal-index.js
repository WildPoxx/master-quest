import { extractJournalLinks } from "./links.js";

export function readAdventureJournalIndex({
  journal,
  folderId = null,
  folderName = null,
  namePattern = null,
  includePageContent = false
} = {}) {
  if (!journal) {
    return [];
  }

  return toArray(journal)
    .filter((doc) => matchesFolder(doc, { folderId, folderName }))
    .filter((doc) => matchesName(doc.name, namePattern))
    .map((doc) => summarizeJournalEntry(doc, { includePageContent }))
    .sort(compareBySortThenName);
}

export function summarizeJournalEntry(doc, { includePageContent = false } = {}) {
  const pages = toArray(doc.pages).map((page) => summarizeJournalPage(page, { includePageContent }));

  return {
    id: doc.id ?? doc._id ?? null,
    uuid: doc.uuid ?? getDocumentUuid("JournalEntry", doc.id ?? doc._id),
    name: doc.name ?? "Unnamed Journal Entry",
    folderId: getFolderId(doc),
    folderName: getFolderName(doc),
    sort: getSort(doc),
    pageCount: pages.length,
    pages
  };
}

export function summarizeJournalPage(page, { includePageContent = false } = {}) {
  const textContent = getPageTextContent(page);
  const summary = {
    id: page.id ?? page._id ?? null,
    uuid: page.uuid ?? getDocumentUuid("JournalEntryPage", page.id ?? page._id),
    name: page.name ?? "Unnamed Page",
    type: page.type ?? "unknown",
    sort: getSort(page),
    textLength: textContent.length,
    journalLinks: extractJournalLinks(textContent)
  };

  if (includePageContent) {
    summary.textContent = textContent;
  }

  return summary;
}

function matchesFolder(doc, { folderId, folderName }) {
  if (folderId && getFolderId(doc) !== folderId) {
    return false;
  }

  if (folderName && getFolderName(doc) !== folderName) {
    return false;
  }

  return true;
}

function matchesName(name, pattern) {
  if (!pattern) {
    return true;
  }

  if (pattern instanceof RegExp) {
    return pattern.test(String(name ?? ""));
  }

  return String(name ?? "").includes(String(pattern));
}

function getFolderId(doc) {
  if (typeof doc.folder === "string") {
    return doc.folder;
  }

  return doc.folder?.id ?? doc.folder?._id ?? doc.folderId ?? null;
}

function getFolderName(doc) {
  if (typeof doc.folder === "string") {
    return doc.folderName ?? null;
  }

  return doc.folder?.name ?? doc.folderName ?? null;
}

function getPageTextContent(page) {
  return String(page.text?.content ?? page.system?.content ?? "");
}

function getSort(doc) {
  const sort = Number(doc.sort ?? 0);
  return Number.isFinite(sort) ? sort : 0;
}

function getDocumentUuid(type, id) {
  return id ? `${type}.${id}` : null;
}

function compareBySortThenName(left, right) {
  return left.sort - right.sort || left.name.localeCompare(right.name);
}

function toArray(collection) {
  if (!collection) {
    return [];
  }

  if (Array.isArray(collection)) {
    return collection;
  }

  if (Array.isArray(collection.contents)) {
    return collection.contents;
  }

  if (typeof collection.values === "function") {
    return Array.from(collection.values());
  }

  if (typeof collection[Symbol.iterator] === "function") {
    return Array.from(collection);
  }

  return Object.values(collection);
}
