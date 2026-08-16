import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

test("authoring console CSS provides internal scrolling in the Foundry window", async () => {
  const css = await readFile(resolve("styles/masterquest.css"), "utf8");

  assert.match(css, /\.masterquest \.window-content\s*\{[\s\S]*overflow:\s*hidden;/);
  assert.match(css, /\.masterquest-console\s*\{[\s\S]*overflow-y:\s*auto;/);
  assert.match(css, /\.masterquest-console\s*\{[\s\S]*min-height:\s*0;/);
  assert.match(css, /\.masterquest\.masterquest-authoring-console\s*\{[\s\S]*max-height:\s*calc\(100vh - 24px\);/);
  assert.match(css, /\.mq-actions\s*\{[\s\S]*position:\s*sticky;/);
  assert.match(css, /\.mq-suggest-button\s*\{[\s\S]*min-height:\s*24px;/);
});
test("component stylesheet has no hardcoded colors (DEC-012: skins own the values)", async () => {
  const css = await readFile(resolve("styles/masterquest.css"), "utf8");
  const hardcoded = css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [];
  assert.deepEqual(hardcoded, [], "todas as cores devem vir de var(--mq-*) em mq-tokens.css");
});

test("token sheet defines the parchment skin and embeds Cinzel", async () => {
  const css = await readFile(resolve("styles/mq-tokens.css"), "utf8");
  assert.match(css, /--mq-chrome-bg:/);
  assert.match(css, /--mq-danger:/);
  assert.match(css, /--mq-focus:/);
  assert.match(css, /@font-face[\s\S]*Cinzel/);
  assert.doesNotMatch(css, /:root/, "tokens nunca em :root para nao vazar para o Foundry");
});

test("every catalog skin defines the complete shared semantic token set", async () => {
  const css = await readFile(resolve("styles/mq-tokens.css"), "utf8");
  const skins = ["cosmic", "sci-fi", "investigacao-moderna", "fantasia-medieval"];
  const tokens = [
    "surface-0", "surface-1", "surface-2", "chrome-bg", "on-chrome", "text", "text-muted",
    "accent", "accent-bright", "on-accent", "danger", "on-danger", "focus", "highlight-bg",
    "status-available", "status-active", "status-completed", "status-failed", "status-inactive",
    "metal-bronze", "metal-silver", "metal-gold", "chip-outline", "chip-active-bg", "capture-bg",
    "capture-ink", "capture-ink-edge", "border", "border-strong", "shadow-1", "shadow-2", "grain"
  ];

  for (const skin of skins) {
    const selector = new RegExp(`\\[data-mq-skin="${skin}"\\]\\.masterquest,[\\s\\S]*?\\n}`);
    const block = css.match(selector)?.[0];
    assert.ok(block, `${skin} must have its own token block`);
    for (const token of tokens) {
      assert.match(block, new RegExp(`--mq-${token}:`), `${skin} must define --mq-${token}`);
    }
  }
});
