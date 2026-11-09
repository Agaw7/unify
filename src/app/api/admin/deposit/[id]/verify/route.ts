import { NextResponse } from 'next/server';

export function POST() {
  return NextResponse.json({ error: 'Test deposits are no longer available for verification.' }, { status: 404 });
}
