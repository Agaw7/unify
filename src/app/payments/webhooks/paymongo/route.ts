import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json({ error: 'Test payment callbacks are no longer available.' }, { status: 404 });
}
