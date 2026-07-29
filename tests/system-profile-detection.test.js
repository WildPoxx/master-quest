import assert from "node:assert/strict";
import test from "node:test";
import { createOlfFqlApi } from "../src/api.js";
import { detectSystemProfile } from "../src/systems/detect-system-profile.js";
import { createSystemProfile } from "../src/systems/system-adapter-registry.js";

test("detectSystemProfile recognizes SWADE from Foundry game.system", () => {
  const profile = detectSystemProfile({
    game: {
      system: {
        id: "swade",
        version: "5.2.6",
        title: "Savage Worlds Adventure Edition"
      }
    }
  });

  assert.equal(profile.id, "swade");
  assert.equal(profile.version, "5.2.6");
  assert.equal(profile.label, "Savage Worlds Adventure Edition");
  assert.equal(profile.mode, "detected");
  assert.equal(profile.adapter, "swade");
  assert.equal(profile.capabilities.rulesAware, true);
  assert.ok(profile.mechanics.suggestedSceneProcedures.includes("dramatic-task"));
});

test("createSystemProfile falls back to generic profile for unknown systems", () => {
  const profile = createSystemProfile({
    id: "dnd5e",
    version: "4.0.0",
    title: "Dungeons & Dragons Fifth Edition"
  }, {
    mode: "detected",
    source: "test"
  });

  assert.equal(profile.id, "dnd5e");
  assert.equal(profile.version, "4.0.0");
  assert.equal(profile.label, "Dungeons & Dragons Fifth Edition");
  assert.equal(profile.adapter, "generic");
  assert.equal(profile.capabilities.rulesAware, false);
});

test("MasterQuest API injects detected SWADE profile into local authoring", () => {
  const api = createOlfFqlApi({
    game: {
      system: {
        id: "swade",
        version: "5.2.6",
        title: "Savage Worlds Adventure Edition"
      },
      journal: []
    }
  });

  const profile = api.masterQuest.detectSystemProfile();
  const draft = api.masterQuest.createDraft({
    title: "Detected System Quest",
    premise: "The module should detect the world system.",
    dramaticQuestion: "Can the core stay agnostic while the profile is SWADE-aware?",
    objectives: ["Create a local draft."],
    threats: ["A false hard dependency."],
    rewards: ["Runtime awareness."]
  });

  assert.equal(profile.id, "swade");
  assert.equal(draft.system, "agnostic");
  assert.equal(draft.systemProfile.id, "swade");
  assert.equal(draft.systemProfile.mode, "detected");
  assert.equal(draft.systemProfile.adapter, "swade");
  assert.ok(draft.systemProfile.suggestions.some((suggestion) => suggestion.includes("SWADE profile")));
});

test("explicit null systemProfile keeps API authoring agnostic", () => {
  const api = createOlfFqlApi({
    game: {
      system: { id: "swade", version: "5.2.6", title: "SWADE" },
      journal: []
    }
  });

  const draft = api.masterQuest.createDraft({
    title: "Manual Agnostic Draft",
    premise: "The GM can suppress runtime profile use.",
    dramaticQuestion: "Can explicit options override detection?",
    objectives: ["Keep this draft generic."],
    threats: ["Accidental coupling."],
    rewards: ["Control."]
  }, {
    systemProfile: null
  });

  assert.equal(draft.system, "agnostic");
  assert.equal(draft.systemProfile, null);
});

test("API does not invoke game getter for system detection unless explicitly requested", () => {
  let touched = false;
  const api = createOlfFqlApi({
    get game() {
      touched = true;
      throw new Error("game getter should not be touched by default");
    }
  });

  const profile = api.masterQuest.detectSystemProfile();
  const draft = api.masterQuest.createDraft("A purely local idea.");

  assert.equal(profile, null);
  assert.equal(touched, false);
  assert.equal(draft.systemProfile, null);
});
