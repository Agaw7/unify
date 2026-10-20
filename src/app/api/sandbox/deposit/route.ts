
import { NextRequest } from "next/server";
import { handleSandboxTransfer } from "@/lib/sandbox-api";

export async function POST(request: NextRequest) {
  return handleSandboxTransfer(request, "deposit");
}
