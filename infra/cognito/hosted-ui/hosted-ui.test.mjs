// Run by the root `npm test` (node's own runner, no dependencies): the sign-in page's files stay
// inside what Cognito's Hosted UI (classic) accepts, so an upload never fails on a rule we know,
// and a field's edge stays visible.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, 'hosted-ui.css'), 'utf8');
const logos = ['logo-dev.png', 'logo-prod.png'].map((name) => ({
  name,
  bytes: readFileSync(resolve(here, name)),
}));

// Cognito's list, with the two states it allows (the developer guide, "Customizing hosted UI
// (classic) branding").
const ALLOWED = new Set([
  '.background-customizable',
  '.banner-customizable',
  '.errorMessage-customizable',
  '.idpButton-customizable',
  '.idpButton-customizable:hover',
  '.idpDescription-customizable',
  '.inputField-customizable',
  '.inputField-customizable:focus',
  '.label-customizable',
  '.legalText-customizable',
  '.logo-customizable',
  '.passwordCheck-valid-customizable',
  '.passwordCheck-notValid-customizable',
  '.redirect-customizable',
  '.socialButton-customizable',
  '.submitButton-customizable',
  '.submitButton-customizable:hover',
  '.textDescription-customizable',
]);
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');

test('no at-rule: Cognito rejects @import, @supports, @page and @media, and allows no other', () => {
  assert.equal(bare.match(/@[\w-]+/)?.[0], undefined);
});

test('every selector is one of the class names Cognito allows, on its own', () => {
  const selectors = [...bare.matchAll(/([^{}]+)\{/g)].flatMap((rule) =>
    rule[1].split(',').map((selector) => selector.trim()),
  );
  assert.ok(selectors.length > 0, 'no rules found');
  for (const selector of selectors) {
    assert.ok(ALLOWED.has(selector), `not in Cognito's list, so refused or ignored: ${selector}`);
  }
});

// WCAG 2's contrast ratio between two #rrggbb colours.
const contrast = (one, two) => {
  const luminance = (hex) => {
    const [r, g, b] = [1, 3, 5].map((at) => {
      const c = parseInt(hex.slice(at, at + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(one), luminance(two)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};

// The #rrggbb a class's rule gives one property, e.g. colour('inputField-customizable', 'border').
const colour = (name, property) =>
  bare.match(new RegExp(`\\.${name}\\s*\\{[^}]*?\\b${property}:[^;}]*?(#[0-9a-f]{6})`, 'i'))?.[1];

test("a field's edge stands 3:1 from the field's own fill and from the card (WCAG 1.4.11)", () => {
  const edge = colour('inputField-customizable', 'border');
  const grounds = [
    colour('inputField-customizable', 'background-color'),
    colour('background-customizable', 'background-color'),
  ];
  assert.ok(edge && grounds.every(Boolean), `a colour is missing: ${edge}, ${grounds}`);
  for (const ground of grounds) {
    const ratio = contrast(edge, ground);
    assert.ok(ratio >= 3, `${edge} on ${ground}: ${ratio.toFixed(2)}:1`);
  }
});

test('each logo is a PNG of at most 100 KB, the limit the console states', () => {
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (const { name, bytes } of logos) {
    assert.deepEqual([...bytes.subarray(0, 8)], PNG, `${name} is not a PNG`);
    assert.ok(bytes.length <= 100 * 1024, `${name}: ${bytes.length} bytes`);
  }
});

test('an upload fits Cognito: its CSS and its logo, Base64-encoded, inside one 135 KB request', () => {
  // AWS: the request may be 135 KB; Base64 grows the logo by a third; 5 KB is kept for headers.
  // SetUICustomization also caps each field at 131072.
  assert.ok(css.length <= 131072, `CSS: ${css.length} characters`);
  for (const { name, bytes } of logos) {
    const base64 = Math.ceil(bytes.length / 3) * 4;
    assert.ok(base64 <= 131072, `${name}: ${base64} bytes once encoded`);
    assert.ok(base64 + css.length <= 130 * 1024, `${name} + CSS: ${base64 + css.length} bytes`);
  }
});
