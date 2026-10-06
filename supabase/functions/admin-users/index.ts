// Edge Function "admin-users" — privileged user management for ADMINS only.
// The service-role key lives ONLY here (Supabase injects it as an env var); it never reaches the browser.
// Deploy:  supabase functions deploy admin-users
// Call:    sb.functions.invoke('admin-users', { body: { action: '...', ... } })
// Actions: create | update | set_active | set_role | set_password | delete
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (status: number, error: string) => json(status, { error });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['admin', 'contributor'];
const GENDERS = ['male', 'female'];
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const validPassword = (p: unknown) => typeof p === 'string' && p.length >= 8 && p.length <= 72;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed');

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false, autoRefreshToken: false } });

  // 1. Who is calling? Verify the session token, then require an ACTIVE ADMIN profile (database = source of truth).
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(401, 'auth.not_authenticated');
  const { data: caller, error: callerErr } = await admin.auth.getUser(token);
  if (callerErr || !caller?.user) return fail(401, 'auth.not_authenticated');
  const { data: me } = await admin.from('profiles').select('id, role, is_active').eq('id', caller.user.id).maybeSingle();
  if (!me || !me.is_active || me.role !== 'admin') return fail(403, 'auth.forbidden');

  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return fail(400, 'user.invalid'); }
  const action = str(b.action);

  // 2. Target user (every action except create)
  const id = str(b.id);
  let target: { id: string; role: string; is_active: boolean } | null = null;
  if (action !== 'create') {
    if (!UUID_RE.test(id)) return fail(400, 'user.invalid');
    const { data } = await admin.from('profiles').select('id, role, is_active').eq('id', id).maybeSingle();
    if (!data) return fail(404, 'user.not_found');
    target = data;
  }
  const lastAdminGuard = async () => {   // never lose the last active admin (the database trigger also enforces this)
    if (!target || target.role !== 'admin' || !target.is_active) return false;
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true })
      .eq('role', 'admin').eq('is_active', true).neq('id', target.id);
    return (count || 0) === 0;
  };

  try {
    switch (action) {
      case 'create': {
        const email = str(b.email).toLowerCase(), full_name = str(b.full_name), role = str(b.role) || 'contributor';
        if (!EMAIL_RE.test(email) || email.length > 254 || !full_name || [...full_name].length > 80 || !ROLES.includes(role)) return fail(400, 'user.invalid');
        if (!validPassword(b.password)) return fail(400, 'user.password_invalid');
        const { data, error } = await admin.auth.admin.createUser({
          email, password: b.password as string, email_confirm: true,
          user_metadata: { full_name }, app_metadata: { role }   // role only from app_metadata (server-controlled)
        });
        if (error || !data?.user) {
          const m = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
          return fail(m.includes('exists') || m.includes('already') || m.includes('registered') ? 409 : 400,
            m.includes('exists') || m.includes('already') || m.includes('registered') ? 'user.email_taken' : 'user.invalid');
        }
        // the handle_new_user trigger created the profile; make name/role explicit
        await admin.from('profiles').update({ full_name, role }).eq('id', data.user.id);
        return json(200, { ok: true, id: data.user.id });
      }
      case 'update': {
        const patch: Record<string, unknown> = {};
        const full_name = str(b.full_name), phone = str(b.phone), gender = str(b.gender), email = str(b.email).toLowerCase();
        if (!full_name || [...full_name].length > 80 || phone.length > 30 || (gender && !GENDERS.includes(gender))) return fail(400, 'user.invalid');
        if (email && (!EMAIL_RE.test(email) || email.length > 254)) return fail(400, 'user.invalid');
        patch.full_name = full_name; patch.phone = phone || null; patch.gender = gender || null;
        if (email) {
          const { error } = await admin.auth.admin.updateUserById(id, { email, email_confirm: true });   // trigger syncs profiles.email
          if (error) {
            const m = `${error.code || ''} ${error.message || ''}`.toLowerCase();
            return fail(m.includes('exists') || m.includes('already') || m.includes('registered') ? 409 : 400,
              m.includes('exists') || m.includes('already') || m.includes('registered') ? 'user.email_taken' : 'user.invalid');
          }
        }
        const { error } = await admin.from('profiles').update(patch).eq('id', id);
        if (error) return fail(400, 'user.invalid');
        return json(200, { ok: true });
      }
      case 'set_active': {
        if (id === me.id) return fail(403, 'user.self_forbidden');
        const active = b.active === true;
        if (!active && await lastAdminGuard()) return fail(409, 'profile.last_admin');
        const { error } = await admin.from('profiles').update({ is_active: active }).eq('id', id);
        if (error) return fail(String(error.message).includes('profile.last_admin') ? 409 : 400,
          String(error.message).includes('profile.last_admin') ? 'profile.last_admin' : 'user.invalid');
        // also block / unblock sign-in at the Auth level (profile.is_active already blocks all data access)
        const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: active ? 'none' : '876000h' });
        if (banErr) {
          await admin.from('profiles').update({ is_active: !active }).eq('id', id);   // keep both in sync
          return fail(500, 'user.invalid');
        }
        return json(200, { ok: true });
      }
      case 'set_role': {
        const role = str(b.role);
        if (!ROLES.includes(role)) return fail(400, 'user.invalid');
        if (id === me.id) return fail(403, 'user.self_forbidden');
        if (role !== 'admin' && await lastAdminGuard()) return fail(409, 'profile.last_admin');
        const { error } = await admin.from('profiles').update({ role }).eq('id', id);
        if (error) return fail(String(error.message).includes('profile.last_admin') ? 409 : 400,
          String(error.message).includes('profile.last_admin') ? 'profile.last_admin' : 'user.invalid');
        await admin.auth.admin.updateUserById(id, { app_metadata: { role } });
        return json(200, { ok: true });
      }
      case 'set_password': {
        if (!validPassword(b.password)) return fail(400, 'user.password_invalid');
        const { error } = await admin.auth.admin.updateUserById(id, { password: b.password as string });
        if (error) return fail(400, 'user.password_invalid');
        return json(200, { ok: true });
      }
      case 'delete': {
        if (id === me.id) return fail(403, 'user.self_forbidden');
        if (await lastAdminGuard()) return fail(409, 'profile.last_admin');
        const [p, e1, e2] = await Promise.all([
          admin.from('products').select('id', { count: 'exact', head: true }).eq('created_by', id),
          admin.from('contributor_evaluations').select('id', { count: 'exact', head: true }).eq('contributor_id', id),
          admin.from('contributor_evaluations').select('id', { count: 'exact', head: true }).eq('evaluator_id', id)
        ]);
        if ((p.count || 0) + (e1.count || 0) + (e2.count || 0) > 0) return fail(409, 'user.has_content');
        const { error } = await admin.auth.admin.deleteUser(id);
        if (error) return fail(409, 'user.has_content');   // other references (e.g. chat) keep the account: disable instead
        return json(200, { ok: true });
      }
      default:
        return fail(400, 'user.invalid');
    }
  } catch (_e) {
    return fail(500, 'user.invalid');
  }
});