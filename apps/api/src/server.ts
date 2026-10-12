import { main } from './main.js';

// The process entry (the Dockerfile's CMD, `npm start`): the API with no deps beyond its env.
await main();
