// Run by the root `npm test` (node's own runner, no dependencies).
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { handler } from './pre-signup.mjs';

const signUp = (email, triggerSource = 'PreSignUp_SignUp') => ({
  triggerSource,
  userPoolId: 'us-east-1_test',
  request: { userAttributes: email === undefined ? {} : { email } },
  response: { autoConfirmUser: false, autoVerifyEmail: false, autoVerifyPhone: false },
});

const refusedWith = (pattern) => (err) => err instanceof Error && pattern.test(err.message);
const SCHOOL = /^Use your school email address to sign up\. It ends in @vanderbilt\.edu\.$/;
const CLOSED = /^Sign-up isn't working right now\./;

let saved;
beforeEach(() => {
  saved = process.env.ALLOWED_EMAIL_DOMAINS;
  process.env.ALLOWED_EMAIL_DOMAINS = 'vanderbilt.edu';
});
afterEach(() => {
  if (saved === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
  else process.env.ALLOWED_EMAIL_DOMAINS = saved;
});

test('a school address signs up, and the event comes back unchanged', async () => {
  const event = signUp('ada@vanderbilt.edu');
  const before = structuredClone(event);
  assert.deepEqual(await handler(event), before);
});

test('the domain matches in any case, the allow-list too', async () => {
  await handler(signUp('Ada@VanderBilt.EDU'));
  process.env.ALLOWED_EMAIL_DOMAINS = ' VANDERBILT.edu ';
  await handler(signUp('ada@vanderbilt.edu'));
});

test('any other domain is refused, with the school email named', async () => {
  await assert.rejects(handler(signUp('ada@gmail.com')), refusedWith(SCHOOL));
});

test('lookalike domains are refused', async () => {
  for (const email of [
    'x@evil-vanderbilt.edu',
    'x@vanderbilt.edu.evil.com',
    'x@vanderbiIt.edu',
    'x@vanderbilt.edu@evil.com',
    'x@vanderbilt.edu.',
    'vanderbilt.edu@evil.com',
  ]) {
    await assert.rejects(handler(signUp(email)), refusedWith(SCHOOL), email);
  }
});

test('a subdomain is refused unless it is listed itself', async () => {
  await assert.rejects(handler(signUp('x@mc.vanderbilt.edu')), refusedWith(SCHOOL));
  process.env.ALLOWED_EMAIL_DOMAINS = 'vanderbilt.edu,mc.vanderbilt.edu';
  await handler(signUp('x@mc.vanderbilt.edu'));
});

test('a missing or malformed email is refused', async () => {
  for (const email of [undefined, '', 'vanderbilt.edu', '@vanderbilt.edu', 'x@', 42]) {
    await assert.rejects(handler(signUp(email)), refusedWith(SCHOOL), String(email));
  }
  await assert.rejects(
    handler({ triggerSource: 'PreSignUp_SignUp', request: {} }),
    refusedWith(SCHOOL),
  );
});

test('an unset or empty allow-list refuses everyone (fail closed)', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const value of [undefined, '', ' ', ',', ' , ']) {
    if (value === undefined) delete process.env.ALLOWED_EMAIL_DOMAINS;
    else process.env.ALLOWED_EMAIL_DOMAINS = value;
    await assert.rejects(handler(signUp('ada@vanderbilt.edu')), refusedWith(CLOSED), `${value}`);
  }
  assert.equal(console.error.mock.callCount(), 5);
});

test('several domains: each signs up, and the refusal names them all', async () => {
  process.env.ALLOWED_EMAIL_DOMAINS = 'vanderbilt.edu, @belmont.edu';
  await handler(signUp('a@vanderbilt.edu'));
  await handler(signUp('b@belmont.edu'));
  await assert.rejects(
    handler(signUp('c@gmail.com')),
    refusedWith(/It ends in @vanderbilt\.edu or @belmont\.edu\.$/),
  );
});

test('a first sign-in through Apple or Google is checked like a sign-up', async () => {
  await assert.rejects(
    handler(signUp('abc@privaterelay.appleid.com', 'PreSignUp_ExternalProvider')),
    refusedWith(SCHOOL),
  );
  await handler(signUp('ada@vanderbilt.edu', 'PreSignUp_ExternalProvider'));
});

test('an account the owner makes in the console passes, even closed', async () => {
  await handler(signUp('reviewer@example.com', 'PreSignUp_AdminCreateUser'));
  delete process.env.ALLOWED_EMAIL_DOMAINS;
  await handler(signUp('reviewer@example.com', 'PreSignUp_AdminCreateUser'));
});
