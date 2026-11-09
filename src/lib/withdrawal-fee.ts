export function withdrawalFee(amount: number) {
  return Math.floor((amount + 10) / 20);
}

export function withdrawalPayout(transaction: { amount: number; withdrawal_fee?: number | null }) {
  return Number(transaction.amount) - Number(transaction.withdrawal_fee ?? 0);
}
