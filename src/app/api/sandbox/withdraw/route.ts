import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json({ error: 'Sandbox transactions are no longer available.' }, { status: 404 });
}
