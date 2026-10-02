import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wt-assessment-auth' },
});

export const DATA_BUCKET = 'assessment-data';
export const DATA_OBJECT = 'wellnesstrack_sample_data.zip';

/** Extracts a readable message from Supabase / Edge Function errors. */
export async function errorMessage(err: unknown): Promise<string> {
  if (!err) return 'Unknown error';
  const ctx = (err as { context?: unknown }).context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      /* fall through */
    }
  }
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err && 'message' in err) return String((err as { message: unknown }).message);
  return String(err);
}
