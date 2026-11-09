const phoneDigits = (value: string) => {
  const digits = value.replace(/\D/g, '');
  if (digits.startsWith('0063')) return digits.slice(2);
  if (digits.startsWith('09')) return `63${digits.slice(1)}`;
  return digits;
};

export function memberMatchesSearch(member: { id: string; phone: string | null }, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query || member.id.toLowerCase().includes(query)) return true;
  if (!member.phone || !/^[+\d\s().-]+$/.test(query)) return false;
  const digits = phoneDigits(query);
  return digits.length > 0 && phoneDigits(member.phone).includes(digits);
}
