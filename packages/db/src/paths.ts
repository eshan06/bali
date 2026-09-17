import { fileURLToPath } from 'node:url';

/** Absolute path to the committed migrations, for the migrator (tests and deploy). */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations', import.meta.url));
