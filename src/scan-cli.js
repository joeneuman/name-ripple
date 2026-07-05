// Run one scan from the command line (useful for testing or system-cron instead of node-cron):
//   npm run scan
import 'dotenv/config';
import { runDailyScan } from './scan.js';

const result = await runDailyScan();
console.log(JSON.stringify(result, null, 2));
process.exit(0);
