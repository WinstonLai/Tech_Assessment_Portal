// Supabase Edge Function: admin-only candidate account management.
// Actions:
//   create          { email, full_name, access_expires_at }       -> { candidate, password }
//   reset_password  { candidate_id, access_expires_at? }           -> { candidate, password }
//   delete          { candidate_id }                               -> { ok }
// Deploy: supabase functions deploy admin-candidates
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

// Unambiguous characters (no 0/O, 1/l/I) so passwords are easy to read out in an email.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
function generatePassword(length = 12): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  // group for readability: xxxx-xxxx-xxxx
  return out.match(/.{1,4}/g)!.join('-');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'Not signed in' }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: adminRow } = await admin
    .from('admins')
    .select('user_id')
    .eq('user_id', userData.user.id)
    .maybeSingle();
  if (!adminRow) return json({ error: 'Admin access required' }, 403);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  try {
    switch (body.action) {
      case 'create': {
        const email = String(body.email ?? '').trim().toLowerCase();
        const fullName = String(body.full_name ?? '').trim() || null;
        const expires = String(body.access_expires_at ?? '');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Invalid email' }, 400);
        if (!expires || Number.isNaN(Date.parse(expires))) return json({ error: 'Invalid expiry' }, 400);

        const password = generatePassword();
        const { data: created, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: fullName, role: 'candidate' },
        });
        if (createErr) {
          const msg = /already|registered|exists/i.test(createErr.message)
            ? 'An account with this email already exists. Use "Reset password" on the existing candidate.'
            : createErr.message;
          return json({ error: msg }, 400);
        }

        const { data: candidate, error: insErr } = await admin
          .from('candidates')
          .insert({
            id: created.user.id,
            email,
            full_name: fullName,
            access_expires_at: new Date(expires).toISOString(),
            password_issued_at: new Date().toISOString(),
            created_by: userData.user.id,
          })
          .select()
          .single();
        if (insErr) {
          await admin.auth.admin.deleteUser(created.user.id);
          return json({ error: insErr.message }, 400);
        }
        return json({ candidate, password });
      }

      case 'reset_password': {
        const id = String(body.candidate_id ?? '');
        // Only rotate passwords of existing candidates; otherwise an admin's (or any other auth user's)
        // password could be changed here, silently locking that account out.
        const { data: existing, error: lookupErr } = await admin.from('candidates').select('id').eq('id', id).maybeSingle();
        if (lookupErr) return json({ error: lookupErr.message }, 500);
        if (!existing) return json({ error: 'Candidate not found' }, 404);
        if (body.access_expires_at && Number.isNaN(Date.parse(String(body.access_expires_at)))) {
          return json({ error: 'Invalid expiry' }, 400);
        }

        const patch: Record<string, unknown> = {
          password_issued_at: new Date().toISOString(),
          is_active: true,
        };
        if (body.access_expires_at) {
          patch.access_expires_at = new Date(String(body.access_expires_at)).toISOString();
        }
        // Update the row *before* rotating the password: if the DB write fails nothing has changed, and
        // if the rotation fails the old password still works and the admin sees the error and retries.
        // The reverse order could rotate the password and then fail without ever returning it.
        const { data: candidate, error } = await admin.from('candidates').update(patch).eq('id', id).select().single();
        if (error) return json({ error: error.message }, 400);

        const password = generatePassword();
        const { error: updErr } = await admin.auth.admin.updateUserById(id, { password });
        if (updErr) return json({ error: updErr.message }, 400);
        return json({ candidate, password });
      }

      case 'delete': {
        const id = String(body.candidate_id ?? '');
        // Refuse to delete admins through this endpoint.
        const { data: isAdmin } = await admin.from('admins').select('user_id').eq('user_id', id).maybeSingle();
        if (isAdmin) return json({ error: 'Cannot delete an admin account here' }, 400);
        const { error } = await admin.auth.admin.deleteUser(id); // cascades to candidates/answers/marks
        if (error) return json({ error: error.message }, 400);
        return json({ ok: true });
      }

      default:
        return json({ error: 'Unknown action' }, 400);
    }
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
