
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Withdrawal status endpoint not implemented." },
    { status: 501 }
  );
}
