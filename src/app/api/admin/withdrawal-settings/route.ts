import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ error: 'Sandbox withdrawal settings are no longer available.' }, { status: 404 });
}

export function POST() {
  return NextResponse.json({ error: 'Sandbox withdrawal settings are no longer available.' }, { status: 404 });
}
