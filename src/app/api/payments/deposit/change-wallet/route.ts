import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json({ error: 'Automated checkout is unavailable.' }, { status: 404 });
}
