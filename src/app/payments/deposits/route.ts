import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json({ error: 'Test payment requests are no longer available.' }, { status: 404 });
}
