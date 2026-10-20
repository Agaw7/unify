
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    { error: "Endpoint not implemented." },
    { status: 501 }
  );
}
