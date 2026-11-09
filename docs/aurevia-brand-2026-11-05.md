# AUREVIA branding — 2026-11-05

User-facing UNIFY wording is now AUREVIA across login/registration, dashboard, profile/team/support, deposit, admin and legacy archive presentation. Page metadata and the SVG favicon use the new name/A mark. New PayMongo checkout line-item descriptions say AUREVIA wallet deposit. Existing provider sessions and historical record descriptions are not rewritten.

Internal CSS classes, storage keys, environment variables, project/domain identity, database objects and existing MFA enrollment identifiers are preserved. Phone-number/password authentication and all financial calculation/authorization behavior remain unchanged. No database/environment changes or financial actions.

Presentation file list: docs/aurevia-brand-files.json (33 TSX files). Additional changes: src/app/ui-theme.css decorative brand badge, src/app/api/money/route.ts display description only, public/favicon.svg. Isolated release backups/aurevia-brand-release-2026-11-05 applies the same textual changes directly over the previously deployed pastel release, excluding unrelated local functional changes.

Rollback: promote dpl_Chy3sMo6NEeGom7ubWvpUhZURWxi in Vercel. Do not reset accounts, wallet records or transactions.
Validation: TypeScript passed; nine login/deposit regression tests passed. Existing MFA enrollment names intentionally retained to avoid breaking administrator verification.
Deployment dpl_EEZNBZp2KroddESpv9bjVeRqsBsT Ready and canonical alias updated; production build passed. Existing dependency audit reported moderate advisories; no dependencies were changed for this branding task.
