import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import test from "node:test";

/**
 * Foundry v14 compatibility contract.
 *
 * The expectations below were verified against the real Foundry 14.365 core and against
 * SWADE 6.0.4 running on v14:
 *
 * - `Hooks.callAll("getSceneControlButtons", controls)` passes a Record keyed by control name
 *   (client/applications/ui/scene-controls.mjs).
 * - SceneControl  = { name, order, title, icon, visible?, tools?, activeTool?, onChange? }
 * - SceneControlTool = { name, order, title, icon, visible?, button?, onChange? }
 * - The directory footer part renders `<footer class="directory-footer action-buttons flexcol">`
 *   (templates/sidebar/directory/footer.hbs).
 * - Sidebar render hooks pass `html` as an HTMLElement, not jQuery.
 * - `ApplicationV2#render(options)` accepts a boolean and normalizes it to `{force}`.
 * - `CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML === 1` (common/constants.mjs).
 */

const SCENE_CONTROL_KEYS = ["name", "order", "title", "icon"];
const SCENE_CONTROL_TOOL_KEYS = ["name", "order", "title", "icon"];

async function loadInitWithMockedFoundry({ isGM = true } = {}) {
  const handlers = { once: new Map(), on: new Map() };
  const openCalls = [];

  const api = {
    masterQuest: {
      openAuthoringConsole: () => {
        openCalls.push(Date.now());
        return true;
      }
    }
  };

  const modulePackage = { id: "master-quest", api: null };

  globalThis.Hooks = {
    once: (event, fn) => handlers.once.set(event, fn),
    on: (event, fn) => handlers.on.set(event, fn)
  };
  globalThis.game = {
    modules: { get: () => modulePackage },
    user: { isGM },
    keybindings: { register: () => {} }
  };
  globalThis.ui = { notifications: {} };

  // Cache-bust so each scenario gets a fresh module evaluation.
  await import(`../scripts/init.js?v14compat=${Math.random()}`);

  const initHook = handlers.once.get("init");
  assert.equal(typeof initHook, "function", "init.js must register an `init` hook");
  initHook();

  return { handlers, api, modulePackage, openCalls };
}

test("getSceneControlButtons handler writes a v14 Record-shaped SceneControl", async () => {
  const { handlers } = await loadInitWithMockedFoundry({ isGM: true });

  const handler = handlers.on.get("getSceneControlButtons");
  assert.equal(typeof handler, "function", "init.js must register getSceneControlButtons");

  // v14 passes a Record keyed by control name, never an array.
  const controls = {};
  handler(controls);

  assert.equal(Array.isArray(controls), false, "v14 controls must stay a Record");
  const control = controls.masterquest;
  assert.ok(control, "MasterQuest must register a `masterquest` control");

  for (const key of SCENE_CONTROL_KEYS) {
    assert.ok(control[key] !== undefined, `SceneControl is missing required key \`${key}\``);
  }
  assert.equal(typeof control.order, "number", "SceneControl.order must be an integer");
  assert.equal(control.visible, true, "control must be visible to a GM");

  assert.equal(typeof control.tools, "object");
  assert.equal(Array.isArray(control.tools), false, "v14 tools must be a Record, not an array");

  const tool = control.tools[control.activeTool];
  assert.ok(tool, "activeTool must point at a real tool in the tools Record");
  for (const key of SCENE_CONTROL_TOOL_KEYS) {
    assert.ok(tool[key] !== undefined, `SceneControlTool is missing required key \`${key}\``);
  }
  assert.equal(tool.button, true, "the console tool resolves on click instead of becoming active");
  assert.equal(typeof tool.onChange, "function", "v14 tools use onChange, not the v12 onClick");
});

test("getSceneControlButtons stays out of the way for non-GM users", async () => {
  const { handlers } = await loadInitWithMockedFoundry({ isGM: false });

  const controls = {};
  handlers.on.get("getSceneControlButtons")(controls);

  assert.equal(controls.masterquest, undefined, "players must not receive the GM control");
});

test("renderJournalDirectory handler is registered for the v14 sidebar", async () => {
  const { handlers } = await loadInitWithMockedFoundry();

  assert.equal(
    typeof handlers.on.get("renderJournalDirectory"),
    "function",
    "init.js must register renderJournalDirectory"
  );
});

test("journal directory button targets the v14 footer and never assumes jQuery", async () => {
  const source = await readFile(resolve("src/ui/journal-directory-button.js"), "utf8");

  // v14 renders `<footer class="directory-footer action-buttons flexcol">`.
  assert.match(source, /\.directory-footer/);
  // v14 renders the entries as `<ol class="directory-list">`.
  assert.match(source, /\.directory-list/);
  assert.match(source, /instanceof HTMLElement/, "the injector must accept a raw HTMLElement");
});

test("no source file relies on jQuery", async () => {
  const offenders = [];

  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.name.endsWith(".js")) continue;
      const source = await readFile(full, "utf8");
      if (/\$\(|jQuery|\.find\(["']|\bhtml\.on\(/.test(source)) offenders.push(full);
    }
  }

  await walk(resolve("src"));
  await walk(resolve("scripts"));

  assert.deepEqual(offenders, [], "v14 sidebar hooks deliver HTMLElement, so jQuery must not be used");
});

test("ApplicationV2 lookup uses the namespace that exists in v14", async () => {
  for (const file of ["src/ui/authoring-console.js", "src/ui/adventure-review.js"]) {
    const source = await readFile(resolve(file), "utf8");
    assert.match(
      source,
      /foundry\?\.applications\?\.api\?\.ApplicationV2/,
      `${file} must resolve ApplicationV2 through the v14 namespace`
    );
    assert.match(source, /_renderHTML/, `${file} must implement _renderHTML`);
    assert.match(source, /_replaceHTML/, `${file} must implement _replaceHTML`);
  }
});

test("journal draft pages always declare an explicit page type", async () => {
  // SWADE 6.0.4 registers a `headquarters` JournalEntryPage subtype, so an implicit
  // page type is ambiguous in a SWADE v14 world. Every page must say `text`.
  const { buildMasterQuestDraftJournalPages } = await import(
    "../src/foundry/master-quest-journal-storage.js"
  );

  const pages = buildMasterQuestDraftJournalPages({
    id: "mq-v14-compat",
    title: "V14 Compatibility Draft",
    premise: "Ensure explicit page types survive the migration.",
    dramaticQuestion: "Does the draft still write text pages?"
  });

  assert.ok(pages.length > 0, "a draft must produce at least one page");
  for (const page of pages) {
    assert.equal(page.type, "text", `page \`${page.name}\` must declare type "text"`);
    assert.equal(page.text.format, 1, "CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML is 1 in v14");
  }
});
