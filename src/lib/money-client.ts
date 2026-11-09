import { supabase } from './supabase';

export async function moneyRequest(path: string, body?: unknown) {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('Please sign in');
  const response = await fetch(path, {
    method:body ? 'POST' : 'GET',
    headers:{ Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json' },
    ...(body ? { body:JSON.stringify(body) } : {}), cache:'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Unable to complete request');
  return result;
}
