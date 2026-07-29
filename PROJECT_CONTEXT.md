# Project Context

## Purpose

MasterQuest is a Foundry VTT adventure and quest authoring module for GM operations, campaign continuity, structured quest planning, and controlled export previews.

It is no longer architected as a Forien's Quest Log hack. FQL remains useful as a legacy data source and snapshot importer, but MasterQuest must be able to stand on its own.

The technical module id remains `master-quest` for now to avoid breaking the current local development path and existing tests.

## Technical Baseline

- Foundry VTT: generation 13, build 351, version 13.351.0.
- Core module: system-agnostic.
- First real runtime profile: SWADE 5.2.6 for OutsiderS - Lost Frontier.
- Legacy import source: Forien's Quest Log 0.9.0 snapshots and `flags["forien-quest-log"].json`.

The public module must not require SWADE or FQL in `module.json`. It detects the active Foundry system at runtime through `game.system` and attaches an optional system profile when available.

## Architecture Direction

MasterQuest should become a native Foundry layer for adventure management:

- create quest drafts from partial GM briefings;
- turn adventure text, Journal-like sources, and future imports into structured quest operations;
- organize objectives, scenes, threats, clues, rewards, clocks, secrets, factions, and locations;
- generate GM previews and player-safe previews;
- prepare future Foundry Journal export plans without writing to the live world by default;
- support system profiles such as SWADE while keeping the core data model agnostic.

For OLF, the first practical target is SWADE. For public release, SWADE must remain an adapter/profile, not a structural dependency.

## Current Safety Boundary

The current MasterQuest authoring, import-preview, export-preview, and system-profile layers are read-only by default.

The one controlled write path is explicit draft persistence:

- `api.masterQuest.saveDraftToJournal(draft)`;
- the `Salvar em Journal` button in the Authoring Console.

That action creates or updates only MasterQuest draft Journals under `MasterQuest Drafts`. It stores the structured draft in MasterQuest flags and creates readable Journal pages for the GM.

All other layers must not:

- create or update `JournalEntry`;
- call `setFlag`;
- write FQL payloads;
- create actors, items, combats, or settings;
- mutate the live Foundry world.

Any future write adapter beyond draft Journal storage must require GM review, backup policy, explicit approval, and post-write validation.

## Public API Shape

Preferred namespace:

```js
const api = game.modules.get("master-quest").api;

api.masterQuest.detectSystemProfile();
api.masterQuest.createDraft(seed, options);
api.masterQuest.assessDraft(draft);
api.masterQuest.generateAuthoringQuestions(seedOrDraft, options);
api.masterQuest.generatePreview(draft, { audience: "gm" });
api.masterQuest.suggestElements(seedOrDraft, options);
api.masterQuest.saveDraftToJournal(draft, options);
api.masterQuest.generateFoundryExportPreview(draft, options);
api.masterQuest.generateImportPreview(source, options);
api.masterQuest.startAuthoringWizard(seedOrDraft, options);
api.masterQuest.continueAuthoringWizard(sessionOrDraft, answers, options);
api.masterQuest.openAuthoringConsole(options);
```

Legacy FQL operations are grouped under:

```js
api.legacyFql
```

Flat aliases are kept temporarily for compatibility with earlier local tests and macros.

## Runtime System Profile

System detection is handled through a small adapter registry.

Current behavior:

- no active Foundry system: draft remains `system: "agnostic"`;
- SWADE detected: draft receives an optional `systemProfile` with SWADE metadata and light GM suggestions;
- unknown systems: draft remains agnostic with a generic profile path available later.

This means MasterQuest can run in SWADE now without becoming a SWADE-only module.

## Legacy FQL Role

FQL is a legacy/import source, not the MasterQuest core.

Future FQL work should focus on:

- reading snapshots;
- generating import previews;
- mapping old FQL quest/task/reward state into MasterQuest drafts;
- never requiring FQL installation for native MasterQuest authoring.

The old FQL analysis docs and fixtures remain valuable as migration research.

## Project Corpora

Important local baseline fixtures and docs include:

- `fixtures/foundry_13_351/core.index.json`
- `fixtures/swade_5_2_6/technical.index.json`
- `fixtures/module_1/session_03_closeout/reports.index.json`
- `fixtures/module_2/a_sun_for_each_destiny/journal-corpus.index.json`
- `docs/36_MasterQuest_Native_Authoring_Model_v0_1.md`
- `docs/40_MasterQuest_Architecture_Reset_v0_2.md`
- `docs/41_MasterQuest_Runtime_System_Profile_v0_1.md`
- `docs/44_MasterQuest_Journal_Draft_Storage_v0_5.md`
- `docs/45_MasterQuest_Adventure_Review_And_Quest_Board_Flow.md`
- `docs/48_Claude_MasterQuest_Project_Handoff_2026_06_21.md`
- `docs/49_Claude_VSCode_Foundry_Autodeploy_Handoff_2026_06_21.md`

## Current Foundry-Tested Surface

The Authoring Console currently opens from a GM-only `MasterQuest` button in the Journal sidebar/footer and from:

```js
MasterQuest.masterQuest.openAuthoringConsole()
```

The console supports manual input, targeted suggestions, GM/player-safe previews, clipboard copies, and explicit Journal draft saving.

The next UX pass should clarify copy buttons, add `partyAnchors` and `storyAnchors` fields, and add an `Avancar` path from a saved draft into an Adventure Review window.

The next architectural phase is:

```text
Authoring Console -> Adventure Review -> Native Quest Board
```

This flow replaces FQL operationally without making FQL a dependency.

## External Agent Handoff

For Claude Code or any other assistant continuing from GitHub, start with the current handoff:

```text
docs/50_Claude_Code_MasterQuest_Handoff_2026_06_26.md
```

The earlier Claude handoff remains useful as historical context:

```text
docs/48_Claude_MasterQuest_Project_Handoff_2026_06_21.md
```

The current handoff explains the GitHub repository, deploy workflow, Foundry/SWADE/FQL boundaries, code map, next backlog, and communication style for working with Mario.

For Claude running inside VS Code and operating deploy to the Foundry server, also read:

```text
docs/49_Claude_VSCode_Foundry_Autodeploy_Handoff_2026_06_21.md
```

## Repository Posture

The initial GitHub repository is a private development baseline.

Before any public release, review and sanitize:

- live-world notes;
- local paths;
- private campaign logs;
- GM-only campaign spoilers;
- experimental FQL migration reports;
- any machine-specific documentation.

The public-facing package should eventually expose the agnostic MasterQuest core, the optional system-profile architecture, and only safe sample data.

