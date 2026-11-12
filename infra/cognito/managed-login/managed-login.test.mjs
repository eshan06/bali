// Run by the root `npm test` (node's own runner, no dependencies): Bali's managed-login style
// (README.md beside this file) keeps its words readable and its fields' edges visible, and the
// request that applies it stays inside what Cognito accepts, so an apply never fails on a rule we
// know.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// What `request.mjs` prints for each pool, as the owner's aws command sends it.
const requests = ['dev', 'prod'].map((env) => {
  const json = execFileSync(process.execPath, [resolve(here, 'request.mjs'), env], {
    encoding: 'utf8',
  });
  return { env, json, ...JSON.parse(json) };
});
const { components: c, componentClasses: cc, categories } = requests[0].Settings;

// WCAG 2's contrast ratio between two colours as Cognito writes them, rrggbbaa.
const contrast = (one, two) => {
  const luminance = (hex) => {
    const [r, g, b] = [0, 2, 4].map((at) => {
      const v = parseInt(hex.slice(at, at + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
const holds = (minimum, pairs) => {
  for (const [what, ink, ground] of pairs) {
    // Opaque only: a see-through colour's contrast depends on what shows through it.
    for (const colour of [ink, ground]) {
      assert.match(colour ?? '', /^[0-9a-f]{6}ff$/i, `${what}: ${colour} is no opaque colour`);
    }
    const ratio = contrast(ink, ground);
    assert.ok(ratio >= minimum, `${what}: ${ink} on ${ground}, ${ratio.toFixed(2)}:1`);
  }
};
const card = c.form.lightMode.backgroundColor;
const page = c.pageBackground.lightMode.color;
const field = cc.input.lightMode.defaults.backgroundColor;
const text = c.pageText.lightMode;

test("light mode only: the style's dark mode is still AWS's blue", () => {
  assert.equal(categories.global.colorSchemeMode, 'LIGHT');
});

test('every word stands 4.5:1 from what it sits on (WCAG 1.4.3)', () => {
  const alert = c.alert.lightMode.error.backgroundColor;
  holds(4.5, [
    ['the heading', text.headingColor, card],
    ['the heading, on the page', text.headingColor, page],
    ['the body', text.bodyColor, card],
    ['the body, on the page', text.bodyColor, page],
    ['a description', text.descriptionColor, card],
    ["a field's label", cc.inputLabel.lightMode.textColor, card],
    ["a field's help", cc.inputDescription.lightMode.textColor, card],
    ["a field's placeholder", cc.input.lightMode.placeholderColor, field],
    ['a link', cc.link.lightMode.defaults.textColor, card],
    ['a link, hovered', cc.link.lightMode.hover.textColor, card],
    ["an error's heading", text.headingColor, alert],
    ["an error's words", text.bodyColor, alert],
    ...['defaults', 'hover', 'active'].flatMap((state) =>
      ['primaryButton', 'secondaryButton'].map((button) => {
        const { textColor, backgroundColor } = c[button].lightMode[state];
        return [`${button}, ${state}`, textColor, backgroundColor];
      }),
    ),
    ...['success', 'warning', 'error'].map((kind) => {
      const { indicatorColor, backgroundColor } = cc.statusIndicator.lightMode[kind];
      return [`a ${kind} line`, indicatorColor, backgroundColor];
    }),
  ]);
});

test("a field's edge and the focus ring stand 3:1 from the field and the card (WCAG 1.4.11)", () => {
  const edge = cc.input.lightMode.defaults.borderColor;
  const focus = cc.focusState.lightMode.borderColor;
  holds(3, [
    ["a field's edge", edge, field],
    ["a field's edge, on the card", edge, card],
    ['the focus ring', focus, field],
    ['the focus ring, on the card', focus, card],
  ]);
});

test('the typography keys, which AWS does not document, hold only what Cognito took (2026-11-12)', () => {
  const { fontWeight = {}, fontSize = {} } = categories.global.typography ?? {};
  const headings = ['headingXl', 'headingL', 'headingM', 'headingS', 'headingXs'];
  for (const [key, weight] of Object.entries(fontWeight)) {
    assert.ok([...headings, 'button'].includes(key), `fontWeight.${key}: not a key Cognito took`);
    assert.ok(
      [300, 400, 700].includes(weight),
      `fontWeight.${key}: ${weight}, not 300, 400 or 700`,
    );
  }
  for (const [key, size] of Object.entries(fontSize)) {
    const keys = ['displayL', ...headings, 'bodyM', 'bodyS'];
    assert.ok(keys.includes(key), `fontSize.${key}: not a key Cognito took`);
    assert.ok(size > 0, `fontSize.${key}: ${size}`);
  }
});

test('each logo is a PNG between 1:1 and 4:1, the shapes Cognito takes for a form logo', () => {
  for (const { env, Assets } of requests) {
    const logo = Buffer.from(Assets.find((a) => a.Category === 'FORM_LOGO').Bytes, 'base64');
    const png = Buffer.from('89504e470d0a1a0a', 'hex'); // the signature every PNG starts with
    assert.ok(logo.subarray(0, 8).equals(png), `${env}'s logo is not a PNG`);
    const ratio = logo.readUInt32BE(16) / logo.readUInt32BE(20); // IHDR's width over its height
    assert.ok(ratio >= 1 && ratio <= 4, `${env}'s logo is ${ratio.toFixed(3)}:1`);
  }
});

test("each request holds only assets Cognito knows, in a type it takes, within AWS's limits", () => {
  // AWS's API reference (AssetType) and its developer guide's table of accepted file types.
  const graphic = ['PNG', 'SVG', 'JPEG'];
  const types = {
    FAVICON_ICO: ['ICO'],
    FAVICON_SVG: ['SVG'],
    IDP_BUTTON_ICON: ['ICO', 'SVG'],
    ...Object.fromEntries(
      [
        'EMAIL_GRAPHIC',
        'SMS_GRAPHIC',
        'AUTH_APP_GRAPHIC',
        'PASSWORD_GRAPHIC',
        'PASSKEY_GRAPHIC',
        'PAGE_HEADER_LOGO',
        'PAGE_HEADER_BACKGROUND',
        'PAGE_FOOTER_LOGO',
        'PAGE_FOOTER_BACKGROUND',
        'PAGE_BACKGROUND',
        'FORM_BACKGROUND',
        'FORM_LOGO',
      ].map((category) => [category, graphic]),
    ),
  };
  for (const { env, json, Assets } of requests) {
    assert.ok(json.length <= 2_000_000, `${env}: ${json.length} bytes, over a request's 2 MB`);
    for (const { Category, ColorMode, Extension, Bytes } of Assets) {
      const what = `${env}'s ${Category}`;
      assert.ok(types[Category]?.includes(Extension), `${what}: ${Extension} is not taken`);
      assert.ok(['LIGHT', 'DARK', 'DYNAMIC'].includes(ColorMode), `${what}: ${ColorMode}`);
      assert.ok(Bytes.length <= 1_000_000, `${what}: ${Bytes.length} characters, over 1,000,000`);
    }
  }
});
