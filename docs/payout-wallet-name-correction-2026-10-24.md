# PayMongo payout wallet name correction

User requested verification and correction before a payout test.

The signed-in PayMongo Wallet screen showed the source wallet ending 4735 and account name `R JUN AGAO NUEVA DBA Ruth Store`. Available wallet funds were explicitly revealed as PHP 0.00.

Updated Vercel Production `PAYMONGO_WALLET_ACCOUNT_NAME` to this exact displayed name. The account number, live flags, authentication controls, identities, balances and transaction records were not changed.

Redeployed the existing production source from unify-8i3qpqctw-agaw7.vercel.app to unify-a1uowngnt-agaw7.vercel.app (dpl_FBfzXi18Tu4yvBkvJeLuhze2Gec1). This does not upload unfinished local upgrade files.

Vercel confirmed Ready after a 65-second build, with unify-woad.vercel.app and unify-agaw7.vercel.app aliased to the new deployment.

Verification scope: provider dashboard identity and successful Vercel configuration update. No provider transfer or refund was submitted, and no API-based source-wallet comparison has been claimed. The configuration-only readiness check is not proof of funded-wallet eligibility or a successful transfer.

Before a payout test: the user must fund the wallet, satisfy current customer and destination approval requirements, and use a genuine available live balance. Sandbox balances are not withdrawable real funds. Manual review and payout submission require different administrator accounts; do not bypass that check to test with the existing single administrator.

Rollback: restore the previous source name from the user's secure configuration history if necessary and redeploy; do not change ledger rows or retry a processing payout blindly.
