import { NextResponse } from 'next/server';

export function DELETE() {
  return NextResponse.json({ error: 'Test deposit cancellation is no longer available.' }, { status: 404 });
}
