import { createOlfFqlApi } from "../src/api.js";
import { injectMasterQuestJournalDirectoryButton } from "../src/ui/journal-directory-button.js";
import { MODULE_ID, MODULE_TITLE } from "../src/constants.js";
import { PRIMARY_QUEST_SETTING } from "../src/quest/quest-store.js";
import { registerWindowControlSettings } from "../src/foundry/window-controls.js";

Hooks.once("init", () => {
  const api = createOlfFqlApi({ game: globalThis.game, ui: globalThis.ui });
  const modulePackage = game.modules.get(MODULE_ID);

  if (modulePackage) {
    modulePackage.api = api;
  }

  globalThis.OLFFQLCampaignOps = api;
  globalThis.MasterQuest = api;
  console.log(`${MODULE_ID} | ${MODULE_TITLE} API ready`);

  if (game.settings?.register) {
    // Which quest the table is currently focused on. Stored per world, GM-controlled.
    game.settings.register(MODULE_ID, PRIMARY_QUEST_SETTING, {
      name: "MasterQuest: quest principal",
      hint: "Id da quest destacada como principal para a mesa.",
      scope: "world",
      config: false,
      type: String,
      default: ""
    });
  }

  registerWindowControlSettings({ game });

  if (game.keybindings?.register) {
    game.keybindings.register(MODULE_ID, "openMasterQuest", {
      name: "MasterQuest: abrir",
      hint: "Abre o MasterQuest com as opções de criação e gerenciamento de quests.",
      editable: [],
      restricted: true,
      onDown: () => {
        api?.masterQuest?.open?.();
        return true;
      }
    });

    game.keybindings.register(MODULE_ID, "openQuestLog", {
      name: "MasterQuest: abrir Quest Log",
      hint: "Vai direto para o gerenciamento de quests.",
      editable: [],
      restricted: false,
      onDown: () => {
        api?.masterQuest?.openQuestLog?.();
        return true;
      }
    });
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  const api = game.modules.get(MODULE_ID)?.api ?? globalThis.MasterQuest;
  if (!controls || typeof controls !== "object" || !api?.masterQuest?.open) return;

  // 0.25: o grupo passa a existir TAMBEM para o jogador — ate a 0.23 a guarda `isGM`
  // barrava o registro inteiro, e o jogador so alcancava o Quest Log pelo rodape da aba
  // de Journals (relatado por Mario em 2026-08-06). Consulta e dele; autoria nao: das
  // quatro ferramentas, so o Quest Log e comum, e as outras tres seguem GM-only.
  const isGM = game.user?.isGM === true;

  const authoringTools = isGM
    ? {
        "authoring-console": {
          name: "authoring-console",
          order: 2,
          title: "Create Quest",
          icon: "fa-solid fa-wand-magic-sparkles",
          button: true,
          onChange: () => api.masterQuest.openAuthoringConsole()
        },
        "import-adventure": {
          name: "import-adventure",
          order: 3,
          title: "Import Adventure",
          icon: "fa-solid fa-book-atlas",
          button: true,
          onChange: () => api.masterQuest.openImport()
        },
        hub: {
          name: "hub",
          order: 4,
          title: "MasterQuest",
          icon: "fa-solid fa-scroll",
          button: true,
          onChange: () => api.masterQuest.open()
        }
      }
    : {};

  controls.masterquest = {
    name: "masterquest",
    // Vizinho do controle Notes do core, que e `order: 8` (verificado no core 14.365,
    // NotesLayer.prepareSceneControls). O valor fracionario poe o MasterQuest logo depois
    // dele, antes do que os modulos costumam registrar mais abaixo.
    order: 8.5,
    title: "MasterQuest",
    icon: "fa-solid fa-scroll",
    visible: true,
    // NO `activeTool` HERE. Every tool below is `button: true`, and Foundry v14's
    // SceneControls##onChangeTool bails out with `if (tool === this.tool) return;` BEFORE
    // it reaches the button branch. Naming a button as `activeTool` therefore makes that
    // button permanently unclickable, while #postActivate fires its onChange whenever the
    // control layer activates — the quest log opened on layer change instead of on click.
    // With no activeTool the group's active tool stays null (scene-controls.mjs:411) and
    // every click resolves immediately.
    tools: {
      "quest-log": {
        name: "quest-log",
        order: 1,
        title: "Quest Log",
        icon: "fa-solid fa-list-check",
        button: true,
        onChange: () => api.masterQuest.openQuestLog()
      },
      ...authoringTools
    }
  };
});

Hooks.on("renderJournalDirectory", (app, element) => {
  const api = game.modules.get(MODULE_ID)?.api ?? globalThis.MasterQuest;
  if (!api?.masterQuest?.open) return;

  // Players reach the Quest Log directly; only the GM gets the authoring side too.
  const isGM = game.user?.isGM === true;

  injectMasterQuestJournalDirectoryButton(element, {
    onClick: () => (isGM ? api.masterQuest.open() : api.masterQuest.openQuestLog())
  });
});
