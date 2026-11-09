import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ error: 'Legacy payment reporting is unavailable.' }, { status: 404 });
}
