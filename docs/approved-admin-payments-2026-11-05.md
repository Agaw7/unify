# Approved payment lists

Separate Approved Deposits and Approved Withdrawals buttons added to Administration and status navigation on each management page.

Approved deposits: completed provider-confirmed records. Approved withdrawals: processing, completed or simulated_paid; original status and simulation disclosures remain visible. No approval, payout, balance, API or database changes.

Files: src/components/AdminTransactions.tsx; src/components/legacy/AdminHome.tsx; src/app/admin/deposits/approved/page.tsx; src/app/admin/withdrawals/approved/page.tsx.

Rollback: promote dpl_4LWbxLgxyBf6dAXs1f497GycvARo. Release folder: backups/approved-admin-payments-release-2026-11-05.

Production build passed compilation, TypeScript/lint checks and page generation. Deployment dpl_4J8SzoNhrtBSA45r7y9Dqz56jNCb Ready.

Browser verified both Admin buttons, completed-only deposit result, and separate approved-withdrawal route. No financial actions performed.
