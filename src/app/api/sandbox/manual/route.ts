import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function retired() {
  return NextResponse.json({ error: 'Manual sandbox payments are no longer available.' }, { status: 404 });
}

export function GET() {
  return retired();
}

export function POST() {
  return retired();
}
