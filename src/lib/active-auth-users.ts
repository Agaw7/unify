import type { SupabaseClient, User } from '@supabase/supabase-js';

export async function activeAuthUsers(db: SupabaseClient) {
  const active = new Map<string, User>();
  const perPage = 500;

  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const user of data.users) {
      if (!user.deleted_at) active.set(user.id, user);
    }
    if (!data.nextPage) return active;
  }
}
