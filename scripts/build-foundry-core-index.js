import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MODULE_ROOT = resolve(__dirname, "..");

export const DEFAULT_FOUNDRY_ZIP_PATH = resolve(MODULE_ROOT, "..", "FoundryVTT-Linux-13.351.zip");
export const DEFAULT_OUTPUT_PATH = resolve(MODULE_ROOT, "fixtures", "foundry_13_351", "core.index.json");

export const FOUNDRY_CORE_KEY_FILES = Object.freeze([
  "resources/app/package.json",
  "resources/app/common/packages/base-package.mjs",
  "resources/app/common/packages/base-module.mjs",
  "resources/app/common/documents/journal-entry.mjs",
  "resources/app/common/documents/journal-entry-page.mjs",
  "resources/app/common/documents/folder.mjs",
  "resources/app/common/documents/macro.mjs",
  "resources/app/client/applications/api/application.mjs",
  "resources/app/client/applications/api/document-sheet.mjs",
  "resources/app/client/applications/sheets/journal/journal-entry-sheet.mjs",
  "resources/app/client/documents/collections/compendium-collection.mjs"
]);

const INTEREST_GROUPS = Object.freeze({
  packages: {
    description: "Package manifest, compatibility, relationships, esmodules, styles, packs, and systems.",
    match: (path) => path === "resources/app/package.json" || path.startsWith("resources/app/common/packages/")
  },
  documents: {
    description: "Core common/client document contracts used by OLF and MasterQuest.",
    match: (path) => path.startsWith("resources/app/common/documents/")
      || path.startsWith("resources/app/client/documents/")
  },
  journalSheets: {
    description: "JournalEntry and JournalEntryPage sheets/templates relevant to native adventure authoring.",
    match: (path) => path.startsWith("resources/app/client/applications/sheets/journal/")
      || path.startsWith("resources/app/templates/journal/")
  },
  applicationApi: {
    description: "ApplicationV2, DocumentSheetV2, Dialog, and HandlebarsApplication APIs.",
    match: (path) => path.startsWith("resources/app/client/applications/api/")
  },
  templates: {
    description: "Foundry core templates most relevant to Journal/UI surface planning.",
    match: (path) => path.startsWith("resources/app/templates/journal/")
      || path.startsWith("resources/app/templates/generic/")
  },
  compendiums: {
    description: "Compendium collection, directory, folder, and pack surfaces.",
    match: (path) => path.toLowerCase().includes("compendium")
  },
  types: {
    description: "Bundled type summary modules for client/common APIs.",
    match: (path) => path.endsWith("_types.mjs")
  }
});

const SELECTED_DEPENDENCIES = [
  "express",
  "handlebars",
  "jquery",
  "pixi.js",
  "classic-level",
  "prosemirror-view",
  "tinymce"
];

export async function buildFoundryCoreIndex({
  zipPath = DEFAULT_FOUNDRY_ZIP_PATH,
  outputPath = DEFAULT_OUTPUT_PATH
} = {}) {
  if (!existsSync(zipPath)) {
    throw new Error(`Foundry ZIP not found: ${zipPath}`);
  }

  const zip = await readZip(zipPath);
  const packageJson = JSON.parse(readZipEntryText(zip, "resources/app/package.json"));
  const entriesByPath = new Map(zip.entries.map((entry) => [entry.path, entry]));
  const keyFiles = FOUNDRY_CORE_KEY_FILES.map((path) => summarizeEntry(entriesByPath.get(path), path));
  const groups = Object.fromEntries(
    Object.entries(INTEREST_GROUPS).map(([name, group]) => [
      name,
      {
        description: group.description,
        count: zip.entries.filter((entry) => group.match(entry.path)).length,
        paths: zip.entries
          .filter((entry) => group.match(entry.path))
          .map((entry) => entry.path)
          .sort()
      }
    ])
  );

  const index = {
    schemaVersion: 1,
    source: {
      zipPath: toPosix(relative(MODULE_ROOT, zipPath)),
      zipFileName: "FoundryVTT-Linux-13.351.zip",
      zipSizeBytes: zip.buffer.byteLength,
      entryCount: zip.entries.length,
      totalUncompressedBytes: zip.entries.reduce((sum, entry) => sum + entry.uncompressedSize, 0)
    },
    release: {
      productName: packageJson.productName,
      version: packageJson.version,
      generation: packageJson.release?.generation,
      channel: packageJson.release?.channel,
      suffix: packageJson.release?.suffix,
      build: packageJson.release?.build,
      nodeVersion: packageJson.release?.node_version,
      engines: packageJson.engines
    },
    packageMetadata: {
      name: packageJson.name,
      main: packageJson.main,
      private: packageJson.private,
      selectedDependencies: Object.fromEntries(
        SELECTED_DEPENDENCIES
          .filter((name) => packageJson.dependencies?.[name])
          .map((name) => [name, packageJson.dependencies[name]])
      )
    },
    keyFiles,
    interestGroups: groups,
    operationalRules: [
      "Use ApplicationV2 and DocumentSheetV2 for new MasterQuest UI surfaces.",
      "Treat appv1 surfaces as compatibility references, not new UI targets.",
      "Journal writes must respect JournalEntry.pages and JournalEntryPage.text.content.",
      "Journal, page, folder, macro, and compendium writes must preserve ownership and flags.",
      "Script macros require MACRO_SCRIPT permission awareness.",
      "Compendiums in Foundry v13 have indexes, folders, ownership, and lock state."
    ]
  };

  if (outputPath) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }

  return index;
}

export async function readZip(zipPath) {
  const buffer = await readFile(zipPath);
  const centralDirectory = findCentralDirectory(buffer);
  const entries = readCentralDirectoryEntries(buffer, centralDirectory);
  return { buffer, entries };
}

export function readZipEntryText(zip, path) {
  const entry = zip.entries.find((candidate) => candidate.path === path);
  if (!entry) {
    throw new Error(`ZIP entry not found: ${path}`);
  }

  return readZipEntryBuffer(zip.buffer, entry).toString("utf8");
}

function findCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);

  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) {
      return {
        entryCount: buffer.readUInt16LE(offset + 10),
        size: buffer.readUInt32LE(offset + 12),
        offset: buffer.readUInt32LE(offset + 16)
      };
    }
  }

  throw new Error("Could not find ZIP end of central directory.");
}

function readCentralDirectoryEntries(buffer, centralDirectory) {
  const entries = [];
  let offset = centralDirectory.offset;

  for (let index = 0; index < centralDirectory.entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error(`Invalid central directory header at offset ${offset}.`);
    }

    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const path = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);

    entries.push({
      path,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntryBuffer(buffer, entry) {
  const offset = entry.localHeaderOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error(`Invalid local file header for ${entry.path}.`);
  }

  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.compressionMethod === 0) {
    return compressed;
  }

  if (entry.compressionMethod === 8) {
    return inflateRawSync(compressed);
  }

  throw new Error(`Unsupported ZIP compression method ${entry.compressionMethod} for ${entry.path}.`);
}

function summarizeEntry(entry, path) {
  return {
    path,
    present: Boolean(entry),
    compressedSize: entry?.compressedSize ?? null,
    uncompressedSize: entry?.uncompressedSize ?? null,
    compressionMethod: entry?.compressionMethod ?? null
  };
}

function toPosix(path) {
  return path.split("\\").join("/");
}

if (process.argv[1] && resolve(process.argv[1]) === __filename) {
  const zipPath = process.argv[2] ? resolve(process.argv[2]) : DEFAULT_FOUNDRY_ZIP_PATH;
  const outputPath = process.argv[3] ? resolve(process.argv[3]) : DEFAULT_OUTPUT_PATH;
  const index = await buildFoundryCoreIndex({ zipPath, outputPath });
  console.log(`Foundry core index written: ${outputPath}`);
  console.log(`Foundry ${index.release.version} build ${index.release.build}; entries: ${index.source.entryCount}`);
}

