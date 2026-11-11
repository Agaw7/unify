export const withdrawalHoursMessage = 'Withdrawal requests are open from 10:00 AM to 10:00 PM (Philippine time).';

const manilaHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Manila',
  hour: '2-digit',
  hourCycle: 'h23',
});

export function isWithdrawalOpen(now = new Date()) {
  const hour = Number(manilaHour.format(now));
  return hour >= 10 && hour < 22;
}
