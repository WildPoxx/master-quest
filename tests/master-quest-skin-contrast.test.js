import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

function luminance(hex) {
  const rgb = hex.match(/\w\w/g).map((part) => Number.parseInt(part, 16) / 255);
  const linear = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrast(foreground, background) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function skinBlock(css, skin) {
  const selector = new RegExp(`\\[data-mq-skin="${skin}"\\]\\.masterquest,[\\s\\S]*?\\n}`);
  return css.match(selector)?.[0] ?? "";
}

function skinColor(block, token) {
  const match = block.match(new RegExp(`--mq-${token}:\\s*#([0-9A-F]{6})`, "i"));
  assert.ok(match, `${token} precisa ser uma cor hexadecimal opaca na skin`);
  return match[1];
}

test("every non-default catalog skin keeps functional text at WCAG AA contrast", async () => {
  const css = await readFile(resolve("styles/mq-tokens.css"), "utf8");
  for (const skin of ["cosmic", "sci-fi", "investigacao-moderna", "fantasia-medieval"]) {
    const block = skinBlock(css, skin);
    const colors = {
      text: skinColor(block, "text"), surface0: skinColor(block, "surface-0"),
      muted: skinColor(block, "text-muted"), surface1: skinColor(block, "surface-1"),
      onChrome: skinColor(block, "on-chrome"), chrome: skinColor(block, "chrome-bg"),
      onAccent: skinColor(block, "on-accent"), accent: skinColor(block, "accent"),
      onDanger: skinColor(block, "on-danger"), danger: skinColor(block, "danger")
    };
    for (const [foreground, background, label] of [
      [colors.text, colors.surface0, "texto"],
      [colors.muted, colors.surface1, "texto secundario"],
      [colors.onChrome, colors.chrome, "chrome"],
      [colors.onAccent, colors.accent, "acao"],
      [colors.onDanger, colors.danger, "erro"]
    ]) {
      assert.ok(contrast(foreground, background) >= 4.5, `${skin}: ${label} precisa atingir 4.5:1`);
    }
  }
});
