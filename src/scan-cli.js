// Run one scan from the command line (useful for testing or system-cron instead of node-cron):
//   npm run scan
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env') });

const { runDailyScan } = await import('./scan.js');

const result = await runDailyScan();
console.log(JSON.stringify(result, null, 2));
process.exit(0);
