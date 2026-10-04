// Cognito Pre sign-up trigger: only the school's email domains may sign up.
//
// Deployed by hand, not by CI: the owner pastes this file into a Lambda
// (Node.js 22, file `index.mjs`, handler `index.handler`) and attaches it to
// the production pool as its Pre sign-up trigger (docs/RUNBOOKS.md, runbook 2,
// step 4). It has no dependencies on purpose, so the paste is the whole deploy.
//
// ALLOWED_EMAIL_DOMAINS: comma-separated, case-insensitive, e.g. `vanderbilt.edu`.
// A domain matches exactly: `mc.vanderbilt.edu` is not `vanderbilt.edu`; list
// it too to let it in. Unset or empty refuses every sign-up (fail closed).
//
// Trigger sources:
// - PreSignUp_SignUp (the hosted page's Sign up) and PreSignUp_ExternalProvider
//   (a first sign-in through Apple or Google) are checked: either would
//   otherwise hand anyone an account.
// - PreSignUp_AdminCreateUser passes: only someone with AWS access to the pool
//   can make one (the owner, e.g. App Review's demo account).
//
// Cognito shows a thrown error's message on the hosted page, after its own
// "PreSignUp failed with error ".

export const handler = async (event) => {
  if (event.triggerSource === 'PreSignUp_AdminCreateUser') return event;

  const allowed = allowedDomains(process.env.ALLOWED_EMAIL_DOMAINS);
  if (allowed.length === 0) {
    console.error('ALLOWED_EMAIL_DOMAINS is unset or empty: every sign-up is refused');
    throw new Error('Sign-up is closed right now. Try again later.');
  }

  if (!allowed.includes(emailDomain(event.request?.userAttributes?.email))) {
    throw new Error(`Use your ${listed(allowed.map((d) => '@' + d))} email address to sign up.`);
  }
  return event;
};

export function allowedDomains(value) {
  return (value ?? '')
    .split(',')
    .map((d) => d.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean);
}

// The part after the last `@`, lowercased, nothing trimmed; '' when there is no usable address.
export function emailDomain(email) {
  if (typeof email !== 'string') return '';
  const at = email.lastIndexOf('@');
  return at < 1 ? '' : email.slice(at + 1).toLowerCase();
}

// "a", "a or b", "a, b or c".
function listed(items) {
  return items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
}
