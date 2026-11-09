export function businessBudgetSummary(row: Record<string, unknown>) {
  const amount = (key: string) => {
    const raw = row[key];
    if ((typeof raw !== 'number' && typeof raw !== 'string') || raw === '') throw new Error('Invalid business balance');
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid business balance');
    return value;
  };
  const available = amount('available'), reserved = amount('reserved'), sales = amount('sales'), funded = amount('funded');
  const overall = available + reserved + sales;
  if (!Number.isSafeInteger(overall)) throw new Error('Invalid business balance');
  return { overall:overall/100, available:available/100, reserved:reserved/100, sales:sales/100, funded:funded/100 };
}
