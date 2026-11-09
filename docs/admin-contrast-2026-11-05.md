# Admin readability correction — 2026-11-05

Only src/app/ui-theme.css changed. Fixed missing light-theme overrides for bg-slate-950 inputs/selects, legacy inline admin-page backgrounds, member/transaction table rows and labels, selected bg-cyan-950 withdrawal settings, native select options, error/success notices and buttons. Forms use explicit dark foreground/light background pairs and light color-scheme; selected radio/checkbox accents are plum. Destructive buttons retain a red treatment.

No account data, table queries, approval settings, payment logic, sandbox labels or API behavior was modified. The screenshots included real sandbox controls, so their Test Mode/simulation labels remain accurate rather than being relabeled live.

Isolated release backups/admin-contrast-release-2026-11-05 over prior AUREVIA branding release. Rollback by promoting dpl_EEZNBZp2KroddESpv9bjVeRqsBsT. No database/environment changes or financial actions.
Production deployment dpl_CTjSEWBvooWLvB9r7mTb8ivB8mPU Ready; production build passed. Browser verified light free-plan fields, readable member rows, and transaction cards. Data and settings were not modified.
