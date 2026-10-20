
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

// Validate withdrawal request UUID.
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: NextRequest,
  context: RouteContext
) {
  try {
    // STEP 1: Get withdrawal request ID.
    const { id } = await context.params;

    if (!uuidPattern.test(id)) {
      return NextResponse.json(
        { error: "Invalid withdrawal request ID." },
        { status: 400 }
      );
    }

    // STEP 2: Read environment variables.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !anonKey || !serviceKey) {
      console.error("Missing admin server configuration");

      return NextResponse.json(
        { error: "Missing server configuration." },
        { status: 500 }
      );
    }

    // STEP 3: Require an authenticated session.
    const authorization = request.headers.get("authorization");

    if (!authorization?.startsWith("Bearer ")) {
      return NextResponse.json(
        { error: "Authentication required." },
        { status: 401 }
      );
    }

    const token = authorization.slice(7).trim();

    const authClient = createClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Verify the access token with Supabase Auth.
    const { data: auth, error: authError } =
      await authClient.auth.getUser(token);

    if (authError || !auth.user) {
      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 }
      );
    }

    // STEP 4: Create trusted server-side Supabase client.
    const admin = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // STEP 5: Check administrator permissions.
    const { data: profile, error: profileError } =
      await admin
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .single();

    if (profileError) {
      console.error(
        "Admin profile verification error:",
        profileError.message
      );

      return NextResponse.json(
        { error: "Unable to verify administrator." },
        { status: 403 }
      );
    }

    if (profile?.role !== "admin") {
      return NextResponse.json(
        { error: "Administrator access required." },
        { status: 403 }
      );
    }

    // STEP 6: Atomically approve the reserved withdrawal.
    //
    // The database function:
    // - Checks withdrawal status and transaction details
    // - Verifies the withdrawal reservation ledger
    // - Updates both records to "processing"
    // - Prevents duplicate approvals
    // - Does not deduct wallet balance again
    const { data: result, error: approvalError } =
      await admin.rpc("approve_reserved_withdrawal", {
        p_request_id: id,
        p_admin_id: auth.user.id,
      });


if (approvalError) {
  console.error("Withdrawal approval error:", {
    code: approvalError.code,
    message: approvalError.message,
    details: approvalError.details,
    hint: approvalError.hint,
  });

  return NextResponse.json(
    {
      error: "Unable to approve withdrawal.",
      ...(process.env.NODE_ENV === "development"
        ? {
            details: approvalError.message,
            code: approvalError.code,
            hint: approvalError.hint,
          }
        : {}),
    },
    { status: 409 }
  );
}


    // STEP 7: Return the result.
    if (
      result !== "approved_for_processing" &&
      result !== "already_processing"
    ) {
      console.error("Unexpected withdrawal approval result:", result);

      return NextResponse.json(
        { error: "Unexpected withdrawal approval result." },
        { status: 500 }
      );
    }

    console.log("UNIFY sandbox withdrawal approval:", {
      withdrawalId: id,
      result,
    });

    return NextResponse.json({
      success: true,
      result,
      message:
        result === "already_processing"
          ? "Withdrawal is already processing."
          : "Withdrawal approved for processing.",
    });
  } catch (error) {
    console.error("UNIFY withdrawal approval error:", error);

    return NextResponse.json(
      { error: "Withdrawal approval failed." },
      { status: 500 }
    );
  }
}
