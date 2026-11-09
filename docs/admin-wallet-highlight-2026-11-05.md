# Prominent admin wallet and paid-today metric

PayMongo Live Wallet moved to a full-width top card with a larger responsive label/balance. Today's Paid Withdrawals added, based on completed live withdrawals and their immutable settle ledger timestamps in Asia/Manila. Duplicate ledger entries counted once; pending/processing excluded.

Modified: src/components/legacy/AdminHome.tsx; src/app/ui-theme.css; src/app/api/admin/live-dashboard/route.ts; tests/money-live-dashboard.test.cjs.

No migration or environment changes. Targeted test executed and passed (1). Rollback: promote dpl_2xyLDe1KvixcLwFE1meQ7H4bXqPM.

Production build succeeded and deployment dpl_6HaZ1CtKN2QuFqnboete7TvcF3vT is Ready, aliased to production.
