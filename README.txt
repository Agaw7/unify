AUREVIA

Local development
1. Install dependencies with npm install.
2. Copy .env.example to .env.local and set the Supabase URL, anon key, and
   server-only service role key.
3. Run npm run dev.

Payment status
- Automated payment-provider integrations have been removed: checkout creation,
  payment/payout reconciliation, provider balance lookups, and webhook handling.
- /deposit is paused. Payment-related APIs do not submit automated payments.
- Existing member accounts, wallet records, transaction history, and database
  migrations were preserved. No database reset or migration was performed.
- The production financial-operations lock remains off. Manual financial
  approval and transfer actions remain unavailable until independently
  authorized.
- Remove any old payment-provider credentials from Vercel project environment
  settings separately; this repository cannot change Vercel configuration.
- Historical documents in docs/ describe older implementations. Do not use
  their provider setup instructions for the current application.

No deployment was performed.
