// Run by the root `npm test` (node's own runner, no dependencies): the sign-in page's files stay
// inside what Cognito's Hosted UI (classic) accepts, so an upload never fails on a rule we know.
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
