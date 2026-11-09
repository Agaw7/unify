import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({ error: 'Legacy sandbox reporting is no longer available.' }, { status: 404 });
}
