import { config } from 'dotenv';
// Same path in backend/src/platform and backend/dist/platform.
config({ path: new URL('../../../.env', import.meta.url), quiet: true });
