// Prints the request that gives one app client Bali's managed-login style (README.md beside this
// file): the input of Cognito's CreateManagedLoginBranding or UpdateManagedLoginBranding for the
// AWS CLI's --cli-input-json, the pool and the client or style named on the aws command line.
//
//   node infra/cognito/managed-login/request.mjs dev > /tmp/bali-style.json
//
// `dev` or `prod` picks the logo. Two assets only: an update leaves every image it doesn't name as
// it was, and an image a style doesn't hold is Cognito's own (README.md, "Applying it").
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const env = process.argv[2];
if (env !== 'dev' && env !== 'prod') {
  console.error('Say which pool: node infra/cognito/managed-login/request.mjs dev|prod');
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const base64 = (path) => readFileSync(resolve(here, path)).toString('base64');

const request = {
  UseCognitoProvidedValues: false,
  Settings: JSON.parse(readFileSync(resolve(here, 'settings.json'), 'utf8')),
  Assets: [
    {
      Category: 'FORM_LOGO',
      ColorMode: 'LIGHT',
      Extension: 'PNG',
      Bytes: base64(`logo-${env}.png`),
    },
    {
      Category: 'FAVICON_SVG',
      ColorMode: 'LIGHT',
      Extension: 'SVG',
      Bytes: base64('../../../apps/web/public/icon.svg'),
    },
  ],
};
console.log(JSON.stringify(request, null, 2));
