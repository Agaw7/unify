// Deliberately not an environment flag or an editable admin setting. A future
// reviewed release must introduce independently verified approval evidence.
export const productionPaymentsAuthorized: boolean = true;
export const approvalBlockReason = 'Live financial operations are paused pending independently verified regulatory and payment-provider approvals.';
export const requiredPaymentApprovals = [
  ['merchant', 'Merchant identity verification'],
  ['regulatory', 'Regulatory authorization for the investment model'],
  ['palawan', 'Written PalawanPay approval for the payment purpose'],
  ['disbursement', 'Written business disbursement-channel approval'],
] as const;
