import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json({ error: 'Payment webhook processing is unavailable.' }, { status: 404 });
}
