const peso = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' });

export function formatPhp(amount: number): string {
  return peso.format(amount).replace(/\.00$/, '');
}
