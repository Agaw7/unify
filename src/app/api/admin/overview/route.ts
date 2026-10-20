
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
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

    // STEP 1: Require authentication.
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

    // STEP 2: Verify Supabase session.
    const { data: auth, error: authError } =
      await authClient.auth.getUser(token);

    if (authError || !auth.user) {
      return NextResponse.json(
        { error: "Invalid or expired session." },
        { status: 401 }
      );
    }

    // STEP 3: Create server-side admin client.
    const admin = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // STEP 4: Verify administrator role.
    const { data: profile, error: profileError } =
      await admin
        .from("profiles")
        .select("role")
        .eq("id", auth.user.id)
        .single();

    if (profileError || profile?.role !== "admin") {
      return NextResponse.json(
        { error: "Administrator access required." },
        { status: 403 }
      );
    }

    // STEP 5: Load dashboard data.
    const [
      transactionsResult,
      withdrawalsResult,
      membersResult,
      investorsResult,
    ] = await Promise.all([
      admin
        .from("payment_transactions")
        .select(
          "id, user_id, transaction_type, amount, currency, status, provider, provider_reference, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(100),

      admin
        .from("withdrawal_requests")
        .select(
          "id, user_id, amount, status, payment_method, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(100),

      // FIXED: Removed nonexistent full_name column.
      admin
        .from("profiles")
        .select("id, invite_code, role, created_at")
        .order("created_at", { ascending: false })
        .limit(100),

      admin
        .from("demo_investments")
        .select(
          "id, user_id, product_id, amount, daily_income, created_at"
        )
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    // STEP 6: Report database query errors.
    if (transactionsResult.error) {
      console.error(
        "Admin transactions query error:",
        transactionsResult.error.message
      );
    }

    if (withdrawalsResult.error) {
      console.error(
        "Admin withdrawals query error:",
        withdrawalsResult.error.message
      );
    }

    if (membersResult.error) {
      console.error(
        "Admin members query error:",
        membersResult.error.message
      );
    }

    if (investorsResult.error) {
      console.error(
        "Admin investments query error:",
        investorsResult.error.message
      );
    }

    if (
      transactionsResult.error ||
      withdrawalsResult.error ||
      membersResult.error ||
      investorsResult.error
    ) {
      return NextResponse.json(
        { error: "Unable to load admin dashboard data." },
        { status: 500 }
      );
    }


    // Get the user IDs associated with deposits and withdrawals.
    const userIds = [
      ...new Set(
        [
          ...(transactionsResult.data ?? []).map((tx) => tx.user_id),
          ...(withdrawalsResult.data ?? []).map((w) => w.user_id),
        ].filter((id): id is string => typeof id === "string")
      ),
    ];

    // Retrieve the registered phone number from Supabase Auth.
    // Keep this lookup on the server using the service-role client.
    const phoneByUserId = new Map<string, string>();

    for (const userId of userIds) {
      const { data, error } =
        await admin.auth.admin.getUserById(userId);

      if (error) {
        console.error("Unable to retrieve member phone:", error.message);
        continue;
      }

      const phone = data.user?.phone;

      if (phone) {
        // Mask phone numbers in the dashboard.
        const maskedPhone =
          phone.length > 7
            ? `${phone.slice(0, 4)}****${phone.slice(-3)}`
            : "Phone registered";

        phoneByUserId.set(userId, maskedPhone);
      }
    }

    const transactions = (transactionsResult.data ?? []).map(
      (tx) => ({
        ...tx,
        member_phone:
          phoneByUserId.get(tx.user_id) ?? "No phone registered",
      })
    );

    const withdrawals = (withdrawalsResult.data ?? []).map(
      (w) => ({
        ...w,
        member_phone:
          phoneByUserId.get(w.user_id) ?? "No phone registered",
      })
    );

    return NextResponse.json({
      transactions,
      withdrawals,
      members: membersResult.data ?? [],
      investors: investorsResult.data ?? [],
    });

  } catch (error) {
    console.error("UNIFY admin overview error:", error);

    return NextResponse.json(
      { error: "Unable to load admin overview." },
      { status: 500 }
    );
  }
}
