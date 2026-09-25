import { detailOf } from './demo/cognito.js';
import { runDevTeacher } from './demo/dev-teacher.js';

/*
 * A teacher on a deployed API (Railway dev) from the terminal, for the iPhone
 * device checks: `npm run dev:teacher -- <command>`. The commands live in
 * ./demo/dev-teacher.ts; the recipe is ios/README.md, "To run it on your iPhone".
 * A failure prints its message and cause chain — never a stack or a credential.
 */
runDevTeacher(process.argv.slice(2), {
  env: process.env,
  print: (line) => console.log(line),
}).catch((err: unknown) => {
  console.error(`dev-teacher: ${detailOf(err)}`);
  process.exitCode = 1;
});
