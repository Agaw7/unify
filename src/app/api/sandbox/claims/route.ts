import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ error: 'Sandbox records are no longer available.' }, { status: 404 });
}
