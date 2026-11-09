import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json({ error: 'Simulated withdrawals are no longer available.' }, { status: 404 });
}
