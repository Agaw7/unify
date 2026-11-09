// Local configuration checks only. This command never contacts a payment provider or moves funds.
const path = require('node:path');
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--env')) {
  console.error('Usage: node scripts/check-money-launch.cjs [--env path-to-env-file]');
  process.exit(1);
}
const envFile = args.length ? path.resolve(args[1]) : path.join(__dirname, '../.env.local');
if (!fs.existsSync(envFile)) {
  console.error('Environment file not found. Configure the selected environment before checking readiness.');
  process.exit(1);
}
require('dotenv').config({ path: envFile, quiet: true, override: Boolean(args.length) });
const env = process.env;
const checks = [
  ['Supabase URL configured', Boolean(env.NEXT_PUBLIC_SUPABASE_URL)],
  ['Supabase server key configured', Boolean(env.SUPABASE_SERVICE_ROLE_KEY)],
  ['HTTPS application origin configured', (() => {
    try { return new URL(env.NEXT_PUBLIC_APP_URL).protocol === 'https:'; }
    catch { return false; }
  })()],
  ['Cron secret has at least 32 characters', Boolean(env.CRON_SECRET?.length >= 32)],
];
for (const [label, ready] of checks) console.log(`${ready ? 'CONFIGURED' : 'MISSING'}: ${label}`);
console.log('Automated deposits and payouts: DISABLED');
console.log('Manual account balances are not live-verified by this application.');
console.log('NOT LAUNCH APPROVAL: this command performs local configuration checks only.');
if (checks.some(([, ready]) => !ready)) process.exitCode = 1;
