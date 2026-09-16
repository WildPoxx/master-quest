import { MODULE_ID } from "./constants.js";
import { applyPatchPlan } from "./apply/apply-patch-plan.js";
import {
  assessMasterQuestDraft,
  createMasterQuestDraft,
  generateMasterQuestAuthoringQuestions,
  generateMasterQuestPreview,
  suggestMasterQuestElements
} from "./authoring/master-quest-authoring.js";
import {
  continueMasterQuestAuthoringWizard,
  startMasterQuestAuthoringWizard
} from "./authoring/master-quest-authoring-wizard.js";
import { generateMasterQuestFoundryExportPreview } from "./authoring/master-quest-export-preview.js";
import { generateMasterQuestQuestModel, generateMasterQuestQuestPreviewText } from "./authoring/master-quest-quest-model.js";
import { generatePatchPlan } from "./continuity/patch-plan.js";
import { assessQuestMigration } from "./fql/assess-quest-migration.js";
import { getFoundryGame } from "./foundry/environment.js";
import { saveMasterQuestDraftToJournal } from "./foundry/master-quest-journal-storage.js";
import { generateMasterQuestImportPreview } from "./importing/master-quest-import-preview.js";
import { readQuestStates } from "./fql/read-quest-states.js";
import { readAdventureJournalIndex } from "./journal/read-adventure-journal-index.js";
import { generateGMReport } from "./reports/gm-report.js";
import { generateGMPatchReview } from "./reports/gm-patch-review.js";
import { generatePlayerRecap } from "./reports/player-recap.js";
import { detectSystemProfile } from "./systems/detect-system-profile.js";
import { openMasterQuestAdventureReview } from "./ui/adventure-review.js";
import { openMasterQuestAuthoringConsole } from "./ui/authoring-console.js";
import { startCloseoutWizard } from "./ui/closeout-wizard.js";
import { openMasterQuestHub } from "./ui/master-quest-hub.js";
import { buildQuestSnapshot, downloadQuestSnapshot } from "./quest/quest-snapshot.js";
import { planBlueprintImport, applyBlueprintImport, loadBundledBlueprint, validateBlueprint } from "./quest/quest-blueprint.js";
import { detectPayloadKind, planFileImport, applyFileImport } from "./quest/quest-import-file.js";
import { listPromotableFolders, planJournalPromotion, promoteJournalFolder } from "./quest/quest-import-journal.js";
import { openImportAdventure } from "./ui/import-adventure.js";
import { openFeedReport } from "./ui/feed-report.js";
import { openMasterQuestLog } from "./ui/quest-log.js";
import { openMasterQuestDetails } from "./ui/quest-details.js";
import { importFromFql, previewFqlImport } from "./quest/quest-import-fql.js";
import {
  createQuest,
  deleteQuest,
  readAllQuests,
  readQuestById,
  saveQuest,
  setQuestStatus
} from "./quest/quest-store.js";

export function createOlfFqlApi(context = {}) {
  const getGame = () => context.game ?? getFoundryGame();
  const getRuntimeSystemProfile = (options = {}) => {
    if (Object.hasOwn(options, "systemProfile")) {
      return options.systemProfile;
    }

    if (Object.hasOwn(context, "systemProfile")) {
      return context.systemProfile;
    }

    const game = getGameForSystemDetection(context, options);
    if (!game && !options.system) {
      return null;
    }

    return detectSystemProfile({ game, system: options.system });
  };
  const withRuntimeSystemProfile = (options = {}) => {
    if (Object.hasOwn(options, "systemProfile")) {
      return options;
    }

    const systemProfile = getRuntimeSystemProfile(options);
    return systemProfile ? { ...options, systemProfile } : options;
  };

  const api = {
    readQuestStates(options = {}) {
      const journal = options.journal ?? getGame()?.journal;
      return readQuestStates({ ...options, journal });
    },

    assessQuestMigration(options = {}) {
      const journal = options.journal ?? getGame()?.journal;
      return assessQuestMigration({ ...options, journal });
    },

    readAdventureJournalIndex(options = {}) {
      const journal = options.journal ?? getGame()?.journal;
      return readAdventureJournalIndex({ ...options, journal });
    },

    generateGMReport(options = {}) {
      const questStates = options.questStates ?? api.readQuestStates(options);
      return generateGMReport(questStates, options);
    },

    generatePlayerRecap(options = {}) {
      const questStates = options.questStates ?? api.readQuestStates(options);
      return generatePlayerRecap(questStates, options);
    },

    generatePatchPlan(options = {}) {
      const questStates = options.questStates ?? api.readQuestStates(options);
      return generatePatchPlan(questStates, options);
    },

    generateGMPatchReview(options = {}) {
      const questStates = options.questStates ?? api.readQuestStates(options);
      const patchPlan = options.patchPlan ?? generatePatchPlan(questStates, options);
      return generateGMPatchReview(patchPlan, questStates, options);
    },

    async applyPatchPlan(options = {}) {
      const patchPlan = options.patchPlan ?? api.generatePatchPlan(options);
      const journal = options.journal ?? getGame()?.journal;
      return applyPatchPlan(patchPlan, { ...options, journal });
    },

    detectMasterQuestSystemProfile(options = {}) {
      return getRuntimeSystemProfile(options);
    },

    createMasterQuestDraft(seed = {}, options = {}) {
      return createMasterQuestDraft(seed, withRuntimeSystemProfile(options));
    },

    generateMasterQuestQuestModel(draftOrSeed = {}, options = {}) {
      return generateMasterQuestQuestModel(draftOrSeed, withRuntimeSystemProfile(options));
    },

    generateMasterQuestQuestPreviewText(model = {}) {
      return generateMasterQuestQuestPreviewText(model);
    },

    assessMasterQuestDraft(draft = {}, options = {}) {
      return assessMasterQuestDraft(draft, withRuntimeSystemProfile(options));
    },

    generateMasterQuestAuthoringQuestions(seedOrDraft = {}, options = {}) {
      return generateMasterQuestAuthoringQuestions(seedOrDraft, withRuntimeSystemProfile(options));
    },

    generateMasterQuestPreview(draft = {}, options = {}) {
      return generateMasterQuestPreview(draft, withRuntimeSystemProfile(options));
    },

    suggestMasterQuestElements(seedOrDraft = {}, options = {}) {
      return suggestMasterQuestElements(seedOrDraft, withRuntimeSystemProfile(options));
    },

    generateMasterQuestFoundryExportPreview(draft = {}, options = {}) {
      return generateMasterQuestFoundryExportPreview(draft, withRuntimeSystemProfile(options));
    },

    generateMasterQuestImportPreview(source = {}, options = {}) {
      return generateMasterQuestImportPreview(source, withRuntimeSystemProfile(options));
    },

    async saveMasterQuestDraftToJournal(seedOrDraft = {}, options = {}) {
      return saveMasterQuestDraftToJournal(seedOrDraft, {
        ...withRuntimeSystemProfile(options),
        game: options.game ?? getGame()
      });
    },

    startMasterQuestAuthoringWizard(seedOrDraft = {}, options = {}) {
      return startMasterQuestAuthoringWizard(seedOrDraft, withRuntimeSystemProfile(options));
    },

    continueMasterQuestAuthoringWizard(sessionOrDraft = {}, answers = {}, options = {}) {
      return continueMasterQuestAuthoringWizard(sessionOrDraft, answers, withRuntimeSystemProfile(options));
    },

    async openMasterQuestAuthoringConsole(options = {}) {
      return openMasterQuestAuthoringConsole({
        ...options,
        api,
        game: options.game ?? getGame(),
        ui: options.ui ?? context.ui ?? globalThis.ui
      });
    },

    async openMasterQuestAdventureReview(options = {}) {
      return openMasterQuestAdventureReview({
        ...options,
        api,
        game: options.game ?? getGame(),
        ui: options.ui ?? context.ui ?? globalThis.ui
      });
    },

    async startCloseoutWizard(options = {}) {
      return startCloseoutWizard({
        ...options,
        api,
        game: options.game ?? getGame(),
        ui: options.ui ?? context.ui ?? globalThis.ui
      });
    },

    async openImportAdventure(options = {}) {
      return openImportAdventure({
        ...options,
        api,
        game: options.game ?? getGame(),
        ui: options.ui ?? context.ui ?? globalThis.ui
      });
    },

    detectPayloadKind(payload) {
      return detectPayloadKind(payload);
    },

    planFileImport(options = {}) {
      return planFileImport({ ...options, game: options.game ?? getGame() });
    },

    async applyFileImport(options = {}) {
      return applyFileImport({ ...options, game: options.game ?? getGame() });
    },

    listPromotableFolders(options = {}) {
      return listPromotableFolders({ ...options, game: options.game ?? getGame() });
    },

    planJournalPromotion(options = {}) {
      return planJournalPromotion({ ...options, game: options.game ?? getGame() });
    },

    async promoteJournalFolder(options = {}) {
      return promoteJournalFolder({ ...options, game: options.game ?? getGame() });
    },

    validateBlueprint(blueprint) {
      return validateBlueprint(blueprint);
    },

    async loadBundledBlueprint(blueprintId) {
      return loadBundledBlueprint(blueprintId);
    },

    planBlueprintImport(options = {}) {
      return planBlueprintImport({ ...options, game: options.game ?? getGame() });
    },

    async applyBlueprintImport(options = {}) {
      return applyBlueprintImport({ ...options, game: options.game ?? getGame() });
    },

    /** Convenience: load a bundled blueprint and import it. Dry-run by default. */
    async importAdventure(blueprintId = "ecos-da-torre", options = {}) {
      const blueprint = options.blueprint ?? (await loadBundledBlueprint(blueprintId));
      if (!blueprint) return { status: "missing-blueprint", blueprintId };
      return applyBlueprintImport({
        dryRun: options.dryRun !== false,
        ...options,
        blueprint,
        game: options.game ?? getGame()
      });
    },

    buildQuestSnapshot(options = {}) {
      return buildQuestSnapshot({ ...options, game: options.game ?? getGame() });
    },

    downloadQuestSnapshot(options = {}) {
      return downloadQuestSnapshot({ ...options, game: options.game ?? getGame() });
    },

    // DEC-063 aplicada por analogia: gerador e leitor de relatorio entram na API. Funcao
    // que nao esta na API e funcao cuja assinatura cada chamador redescobre — foi assim que
    // `buildWrapupReport` passou versoes sendo chamada errado.
    async openFeedReport(options = {}) {
      return openFeedReport({
        ...options,
        api,
        game: options.game ?? getGame(),
        ui: options.ui ?? context.ui ?? globalThis.ui
      });
    },

    async openMasterQuestHub(options = {}) {
      return openMasterQuestHub({
        ...options,
        api,
        game: options.game ?? getGame(),
        ui: options.ui ?? context.ui ?? globalThis.ui
      });
    },

    async openMasterQuestLog(options = {}) {
      return openMasterQuestLog({
        ...options,
        api,
        game: options.game ?? getGame(),
        ui: options.ui ?? context.ui ?? globalThis.ui
      });
    },

    async openMasterQuestDetails(questId, options = {}) {
      return openMasterQuestDetails({
        ...options,
        questId,
        api,
        game: options.game ?? getGame(),
        ui: options.ui ?? context.ui ?? globalThis.ui
      });
    },

    readQuests(options = {}) {
      return readAllQuests({ game: options.game ?? getGame() });
    },

    readQuest(questId, options = {}) {
      return readQuestById(questId, { game: options.game ?? getGame() });
    },

    createQuest(seed = {}, options = {}) {
      return createQuest(seed, { ...options, game: options.game ?? getGame() });
    },

    saveQuest(quest, options = {}) {
      return saveQuest(quest, options);
    },

    deleteQuest(questId, options = {}) {
      return deleteQuest(questId, { game: options.game ?? getGame() });
    },

    setQuestStatus(questId, status, options = {}) {
      return setQuestStatus(questId, status, { game: options.game ?? getGame() });
    },

    previewFqlImport(options = {}) {
      return previewFqlImport({ game: options.game ?? getGame() });
    },

    importFromFql(options = {}) {
      return importFromFql({ ...options, game: options.game ?? getGame() });
    }
  };

  api.masterQuest = Object.freeze({
    detectSystemProfile: api.detectMasterQuestSystemProfile,
    createDraft: api.createMasterQuestDraft,
    generateQuestModel: api.generateMasterQuestQuestModel,
    generateQuestPreviewText: api.generateMasterQuestQuestPreviewText,
    assessDraft: api.assessMasterQuestDraft,
    generateAuthoringQuestions: api.generateMasterQuestAuthoringQuestions,
    generatePreview: api.generateMasterQuestPreview,
    suggestElements: api.suggestMasterQuestElements,
    generateFoundryExportPreview: api.generateMasterQuestFoundryExportPreview,
    generateImportPreview: api.generateMasterQuestImportPreview,
    saveDraftToJournal: api.saveMasterQuestDraftToJournal,
    startAuthoringWizard: api.startMasterQuestAuthoringWizard,
    continueAuthoringWizard: api.continueMasterQuestAuthoringWizard,
    openAuthoringConsole: api.openMasterQuestAuthoringConsole,
    openAdventureReview: api.openMasterQuestAdventureReview,

    // Quest operations: the FQL-equivalent management surface.
    open: api.openMasterQuestHub,
    openHub: api.openMasterQuestHub,
    openQuestLog: api.openMasterQuestLog,
    openQuestDetails: api.openMasterQuestDetails,
    readQuests: api.readQuests,
    readQuest: api.readQuest,
    createQuest: api.createQuest,
    saveQuest: api.saveQuest,
    deleteQuest: api.deleteQuest,
    setQuestStatus: api.setQuestStatus,
    previewFqlImport: api.previewFqlImport,
    importFromFql: api.importFromFql,
    buildSnapshot: api.buildQuestSnapshot,
    downloadSnapshot: api.downloadQuestSnapshot,
    validateBlueprint: api.validateBlueprint,
    loadBlueprint: api.loadBundledBlueprint,
    planBlueprintImport: api.planBlueprintImport,
    applyBlueprintImport: api.applyBlueprintImport,
    importAdventure: api.importAdventure,
    openImport: api.openImportAdventure,
    openFeedReport: api.openFeedReport,
    detectPayloadKind: api.detectPayloadKind,
    planFileImport: api.planFileImport,
    applyFileImport: api.applyFileImport,
    listPromotableFolders: api.listPromotableFolders,
    planJournalPromotion: api.planJournalPromotion,
    promoteJournalFolder: api.promoteJournalFolder
  });

  api.legacyFql = Object.freeze({
    readQuestStates: api.readQuestStates,
    assessQuestMigration: api.assessQuestMigration,
    generateGMReport: api.generateGMReport,
    generatePlayerRecap: api.generatePlayerRecap,
    generatePatchPlan: api.generatePatchPlan,
    generateGMPatchReview: api.generateGMPatchReview,
    applyPatchPlan: api.applyPatchPlan,
    startCloseoutWizard: api.startCloseoutWizard
  });

  Object.defineProperty(api, "moduleId", {
    enumerable: true,
    value: MODULE_ID
  });

  return Object.freeze(api);
}

function getGameForSystemDetection(context, options) {
  if (Object.hasOwn(options, "game")) {
    return options.game;
  }

  const descriptor = Object.getOwnPropertyDescriptor(context, "game");
  if (descriptor && Object.hasOwn(descriptor, "value")) {
    return descriptor.value;
  }

  if (descriptor?.get && (options.detectSystemProfile === true || context.detectSystemProfile === true)) {
    try {
      return context.game;
    } catch {
      return null;
    }
  }

  return null;
}