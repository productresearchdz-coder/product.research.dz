'use strict';
/* =====================================================================
   Product Research Platform — app.js (Phase 11: + product organization, recycle bin, user management, micro-niches)
   Sections: Config · State · Utilities · i18n · Theme · Auth · Router ·
             Shell · Profile · Phase 5 product form · Phase 6 products list · Phase 7 admin review · Phase 8 admin notifications · Phase 9 statistics & evaluation · Phase 10/11 organization, recycle bin, micro-niches, users · UI wiring · Boot
   ===================================================================== */

/* ===== Config =====
   Project URL + PUBLISHABLE (anon) key only. NEVER a secret / service_role key. */
const CONFIG = {
  SUPABASE_URL: 'https://fweplvarbnnufiovkbvi.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_nhkqT0D5UVKOMavHRtfMCw_xNymy5YZ'
};
const LOGO_FILES = { light: 'logo-light.png', dark: 'logo-dark.png' }; // bucket "logos"
const LANGS = ['ar', 'fr', 'en'];
const PROFILE_COLS = 'id, full_name, role, is_active, phone, gender, avatar_id';
const NAV = {   // first page of each list = default page
  contributor: [{ page: 'add', icon: '＋' }, { page: 'products', icon: '▤' }, { page: 'stats', icon: '◔' }],
  admin: [{ page: 'products', icon: '▤' }, { page: 'organization', icon: '⇅' }, { page: 'micro', icon: '◈' },
          { page: 'recycle', icon: '♲' }, { page: 'statistics', icon: '◔' }, { page: 'users', icon: '☺' }]
};

/* ===== State ===== */
const state = {
  lang: 'ar', theme: 'light',
  portal: null,     // login type chosen on the login screen
  profile: null,    // own profile once signed in
  page: null,       // current page inside the role area
  routeId: null,    // optional product id in #/contributor/add/<id>
  avatars: [],      // active avatars (table "avatars")
  errorKey: null, busy: false
};
let sb = null;      // Supabase client
let busyCount = 0;
let lastFocus = null;

/* ===== Utilities ===== */
const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
};
function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;   // textContent only: never innerHTML
  return n;
}
function skeleton(lines) {
  const w = el('div'); w.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < lines; i++) w.append(el('div', 'skeleton'));
  return w;
}
function initials(name) {
  return (name || '?').trim().split(/\s+/).slice(0, 2).map((w) => Array.from(w)[0]).join('').toUpperCase();
}

/* ===== Loading + toasts ===== */
async function withLoading(fn) {
  busyCount++; syncBusy();
  try { return await fn(); } finally { busyCount--; syncBusy(); }
}
function syncBusy() {
  $('loading-bar').hidden = busyCount === 0;
  document.body.setAttribute('aria-busy', String(busyCount > 0));
}
function toast(kind, key, vars) {
  const n = el('div', 'toast toast-' + kind, { success: '✓ ', error: '⚠ ', info: 'ℹ ' }[kind] + t(key, vars));
  n.addEventListener('click', () => n.remove());
  $('toasts').append(n);
  setTimeout(() => n.remove(), kind === 'error' ? 6000 : 4000);
}

/* ===== i18n ===== */
function t(key, vars) {
  let s = (translations[state.lang] && translations[state.lang][key]) || translations.en[key] || key;
  if (vars) Object.keys(vars).forEach((k) => { s = s.replace('{' + k + '}', vars[k]); });
  return s;
}

function applyLanguage(lang) {
  state.lang = LANGS.includes(lang) ? lang : 'ar';
  store.set('lang', state.lang);
  document.documentElement.lang = state.lang;
  document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
  document.title = t('app.title');
  $('lang-select').value = state.lang;
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
  document.querySelectorAll('[data-i18n-aria]').forEach((n) => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
  renderDynamicText();
}

/* Texts that depend on state: re-rendered on language / theme / route changes */
function renderDynamicText() {
  $('logo').alt = t('logo.alt');
  $('theme-btn').textContent = state.theme === 'dark' ? '☀' : '☾';
  $('theme-btn').setAttribute('aria-label', t(state.theme === 'dark' ? 'theme.toLight' : 'theme.toDark'));
  $('theme-btn').title = $('theme-btn').getAttribute('aria-label');
  $('portal-title').textContent = state.portal ? t('login.' + state.portal + 'Title') : '';
  $('submit-btn').textContent = t(state.busy ? 'login.signingIn' : 'login.signIn');
  renderError();
  renderShell();
}

function renderError() {
  const target = !$('login-form').hidden ? $('form-error') : $('global-error');
  $('form-error').hidden = true;
  $('global-error').hidden = true;
  if (state.errorKey) { target.textContent = t(state.errorKey); target.hidden = false; }
}
function setError(key) { state.errorKey = key || null; renderError(); }

/* ===== Theme ===== */
function applyTheme(theme) {
  state.theme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = state.theme;
  store.set('theme', state.theme);
  updateLogo();
  renderDynamicText();
}

function updateLogo() {
  const imgs = [$('logo'), $('brand-logo')];
  if (!sb) { imgs.forEach((i) => { i.hidden = true; }); return; }
  const url = sb.storage.from('logos').getPublicUrl(LOGO_FILES[state.theme]).data.publicUrl;
  imgs.forEach((img) => {
    img.onload = () => { img.hidden = false; };
    img.onerror = () => { img.hidden = true; };   // text title remains if the logo cannot load
    img.src = url;
  });
}

/* ===== Supabase / errors ===== */
function configIsValid() {
  return /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(CONFIG.SUPABASE_URL) &&
         CONFIG.SUPABASE_PUBLISHABLE_KEY.length > 20 && !CONFIG.SUPABASE_PUBLISHABLE_KEY.startsWith('PASTE_');
}

/* Central mapper: Supabase auth / PostgREST / database errors -> translation key */
function authErrorKey(e) {
  const code = String((e && e.code) || '');
  const msg = String((e && e.message) || '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login')) return 'err.invalidCredentials';
  if (code === 'email_not_confirmed') return 'err.emailNotConfirmed';
  if ((e && e.status === 429) || code.includes('rate_limit')) return 'err.rateLimit';
  if ((e && e.status === 0) || (e && e.name === 'AuthRetryableFetchError') || msg.includes('fetch')) return 'err.network';
  if (msg.includes('product.reason_required')) return 'err.reasonRequired';
  if (msg.includes('product.limit_reached')) return 'err.limitReached';
  if (msg.includes('product.missing_fields')) return 'err.missingFields';
  if (msg.includes('product.not_found') || msg.includes('product.in_recycle_bin')) return 'err.productNotFound';
  if (msg.includes('product.transition_not_allowed')) return 'err.transitionNotAllowed';
  if (msg.includes('product.not_editable')) return 'err.productLocked';
  if (msg.includes('product.protected_field')) return 'err.forbidden';
  if (msg.includes('chat.forbidden')) return 'err.chatForbidden';
  if (msg.includes('chat.invalid_member')) return 'err.chatInvalidMember';
  if (msg.includes('chat.invalid_name')) return 'err.chatInvalidName';
  if (msg.includes('chat.cannot_leave_direct')) return 'err.chatForbidden';
  if (msg.includes('chat.empty_message') || msg.includes('chat.invalid_message')) return 'err.chatEmpty';
  if (msg.includes('chat.invalid_attachment') || msg.includes('chat.attachment_missing')) return 'err.chatAttachment';
  if (msg.includes('exceeded the maximum') || msg.includes('too large') || msg.includes('payload too large')) return 'err.chatFileTooLarge';
  if (msg.includes('mime type') || msg.includes('not supported')) return 'err.chatFileType';
  if (msg.includes('product.not_in_recycle_bin')) return 'err.notInBin';
  if (msg.includes('product.already_in_recycle_bin')) return 'err.alreadyInBin';
  if (msg.includes('micro_niche.niche_mismatch') || msg.includes('micro_niche.parent_required')) return 'err.microMismatch';
  if (msg.includes('micro_niche.parent_locked')) return 'err.microParentLocked';
  if (msg.includes('profile.last_admin')) return 'err.lastAdmin';
  if (msg.includes('user.email_taken')) return 'err.userEmailTaken';
  if (msg.includes('user.self_forbidden')) return 'err.userSelf';
  if (msg.includes('user.has_content')) return 'err.userHasContent';
  if (msg.includes('user.password_invalid')) return 'err.passwordInvalid';
  if (msg.includes('user.not_found')) return 'err.userNotFound';
  if (msg.includes('user.invalid')) return 'err.userInvalid';
  if (msg.includes('user.function_unavailable')) return 'err.fnUnavailable';
  if (e && e.name === 'FunctionsFetchError') return 'err.network';
  if (code === '23503') return 'err.inUse';
  if (msg.includes('notification.not_found') || msg.includes('notification.not_actionable')) return 'err.notifGone';
  if (msg.includes('evaluation.invalid_contributor')) return 'err.evalContributor';
  if (msg.includes('evaluation.future_period')) return 'err.evalFuture';
  if (msg.includes('evaluation.invalid_period')) return 'err.evalPeriod';
  if (msg.includes('evaluation.invalid_scores')) return 'err.evalScores';
  if (msg.includes('evaluation.inconsistent')) return 'err.evalSave';
  if (code === '23505') return 'err.duplicate';
  if (msg.includes('maximum allowed size') || String(e && e.statusCode) === '413') return 'err.fileTooLarge';
  if (msg.includes('mime type')) return 'err.fileType';
  if (msg.includes('row-level security')) return 'err.forbidden';   // storage / RLS refusal
  if (code === '23514') return 'err.invalidData';
  if (code === '42501' || code === 'PGRST116' || /^(auth|profile)\./.test(msg)) return 'err.forbidden';
  return 'err.generic';
}

/* ===== Auth ===== */
async function loadProfile(userId) {
  const { data, error } = await sb.from('profiles').select(PROFILE_COLS).eq('id', userId).maybeSingle();
  if (error) throw error;
  return data;
}
async function loadAvatars() {
  const r = await sb.from('avatars').select('id, gender, storage_path, sort_order').eq('is_active', true).order('sort_order');
  if (!r.error) state.avatars = r.data || [];
  return r;
}

/* Signs out and returns to the login screen with an error message */
async function rejectSession(errorKey) {
  state.profile = null; state.portal = null;
  try { await sb.auth.signOut(); } catch (e) { /* ignore */ }
  showRoleStep();
  setError(errorKey);
  route();
}

/* portal = login type chosen (null when restoring an existing session) */
async function enterApp(session, portal) {
  const profile = await loadProfile(session.user.id);
  if (!profile) return rejectSession('err.noProfile');
  if (!profile.is_active) return rejectSession('err.accountDisabled');
  if (portal && portal !== profile.role) return rejectSession('err.wrongPortal');   // wrong-role portal protection
  if (profile.avatar_id) await loadAvatars();
  state.profile = profile;
  state.errorKey = null;
  route();   // keeps a valid deep link on reload, otherwise goes to the role's default page
  if (profile.role === 'admin') startNotifications();
  startChat();
}

async function handleLogin(ev) {
  ev.preventDefault();
  if (state.busy) return;
  const email = $('email').value.trim();
  const password = $('password').value;
  if (!email || !password) return setError('err.required');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('err.emailInvalid');

  setBusy(true); setError(null);
  try {
    const { data, error } = await withLoading(() => sb.auth.signInWithPassword({ email, password }));
    if (error) { setError(authErrorKey(error)); return; }
    await enterApp(data.session, state.portal);
  } catch (e) {
    setError(authErrorKey(e));
  } finally {
    $('password').value = '';
    setBusy(false);
  }
}

async function handleLogout() {
  closeProfileCard(false); closeModal();
  stopNotifications(); stopChat();
  await flushAdd();
  resetList(); resetAdmin(); resetStats(); resetEval();
  try { await sb.auth.signOut(); } catch (e) { /* session cleared locally anyway */ }
  state.profile = null; state.portal = null; state.errorKey = null; state.avatars = [];
  showRoleStep();
  location.hash = '#/login';
  route();
}

function setBusy(busy) {
  state.busy = busy;
  $('submit-btn').disabled = busy;
  $('submit-btn').textContent = t(busy ? 'login.signingIn' : 'login.signIn');
}

/* ===== Router (hash: #/login, #/<role>/<page>) with role protection ===== */
function route() {
  const [area, page, extra] = location.hash.replace('#/', '').split('/');
  const p = state.profile;
  let target = 'login';
  if (p && area === 'chat') {   // Chat is shared by both roles; access itself is enforced by RLS
    target = 'chat';
  } else if (p) {   // an admin can never open contributor pages, and vice versa
    const pages = NAV[p.role].map((i) => i.page);
    const ok = area === p.role && pages.includes(page);
    target = p.role + '/' + (ok ? page : pages[0]);
    if (ok && p.role === 'contributor' && page === 'add' && UUID_RE.test(extra || '')) target += '/' + extra;   // edit one product
    else if (ok && p.role === 'admin' && page === 'products' && UUID_RE.test(extra || '')) target += '/' + extra;   // review one product
  }
  if (location.hash !== '#/' + target) { location.replace('#/' + target); return; }   // hashchange re-runs route()

  state.page = p ? (target === 'chat' ? 'chat' : target.split('/')[1]) : null;
  state.routeId = p && target !== 'chat' ? (target.split('/')[2] || null) : null;
  if (!p) { leaveAdd(false); resetList(); resetAdmin(); resetStats(); resetEval(); resetOrg(); resetBin(); resetMicro(); resetUsers(); stopNotifications(); stopChat(); }
  $('view-loading').hidden = true;
  $('view-login').hidden = !!p;
  $('view-module').hidden = !p;
  document.querySelector('main').classList.toggle('shell', !!p);
  ['brand', 'avatar-btn', 'main-nav'].forEach((id) => { $(id).hidden = !p; });
  if (!p) closeProfileCard(false);
  renderDynamicText();
}

/* ===== Shell (header, navigation, avatar) ===== */
function renderAvatar(node, prof) {
  const p = prof || state.profile;   // default: the signed-in user
  node.replaceChildren();
  const a = state.avatars.find((x) => x.id === p.avatar_id);
  if (a && a.storage_path) {
    const img = el('img'); img.alt = '';
    img.src = sb.storage.from('profile-avatars').getPublicUrl(a.storage_path).data.publicUrl;
    node.append(img);
  } else {
    node.textContent = initials(p.full_name);
  }
}

function renderNav() {
  const p = state.profile;
  const ul = $('nav-list');
  ul.replaceChildren();
  NAV[p.role].forEach((it) => {
    const a = el('a', 'nav-item');
    a.href = '#/' + p.role + '/' + it.page;
    if (it.page === state.page) a.setAttribute('aria-current', 'page');
    const ic = el('span', null, it.icon); ic.setAttribute('aria-hidden', 'true');
    a.append(ic, el('span', null, t('nav.' + p.role + '.' + it.page)));
    const li = el('li'); li.append(a); ul.append(li);
  });
}

function renderShell() {
  const p = state.profile;
  if (!p || !state.page) return;
  $('main-nav').setAttribute('aria-label', t('nav.label'));
  renderNav();
  $('module-title').textContent = state.page === 'chat' ? t('chat.title') : t('nav.' + p.role + '.' + state.page);
  $('pc-name').textContent = p.full_name;
  $('pc-role').textContent = t('role.' + p.role);
  renderAvatar($('avatar-btn')); renderAvatar($('pc-avatar'));
  $('avatar-btn').setAttribute('aria-label', t('profile.open'));
  $('pc-chat').removeAttribute('title'); $('pc-chat').disabled = false;
  chatShell();
  renderNotifUI();
  renderModule();
}

/* ===== Modal (reusable dialog) ===== */
function openModal(titleKey, build) {
  lastFocus = document.activeElement;
  delete $('modal').dataset.chatConv;
  $('modal-title').textContent = t(titleKey);
  $('modal-body').replaceChildren();
  build($('modal-body'));
  if (!$('modal').open) $('modal').showModal();
}
function closeModal() { if ($('modal').open) $('modal').close(); }

/* fields: [{ name, label, value, max, dir, options:[[value, labelKey]] }]
   onSave(values) returns a translation key on error, or null on success */
function formModal(titleKey, fields, onSave) {
  openModal(titleKey, (body) => {
    const form = el('form'); form.noValidate = true;
    const inputs = {};
    fields.forEach((f) => {
      const wrap = el('div', 'field');
      const lab = el('label', null, t(f.label)); lab.htmlFor = 'f-' + f.name;
      let input;
      if (f.options) {
        input = el('select');
        f.options.forEach(([v, k]) => { const o = el('option', null, t(k)); o.value = v; input.append(o); });
      } else {
        input = el('input'); input.type = f.type || 'text'; if (f.max) input.maxLength = f.max; if (f.auto) input.autocomplete = f.auto;
      }
      input.id = 'f-' + f.name; input.value = f.value || ''; if (f.dir) input.dir = f.dir;
      inputs[f.name] = input;
      wrap.append(lab, input); form.append(wrap);
    });
    const err = el('p', 'error'); err.setAttribute('role', 'alert'); err.hidden = true;
    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn btn-ghost', t('common.cancel')); cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    const save = el('button', 'btn btn-primary', t('common.save')); save.type = 'submit';
    actions.append(cancel, save);
    form.append(err, actions);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      const values = {};
      fields.forEach((f) => { values[f.name] = f.type === 'password' ? inputs[f.name].value : inputs[f.name].value.trim(); });
      const key = await onSave(values);
      save.disabled = false;
      if (key) { err.textContent = t(key); err.hidden = false; } else closeModal();
    });
    body.append(form);
    inputs[fields[0].name].focus();
  });
}

/* ===== Profile ===== */
function toggleProfileCard(open) {
  $('profile-card').hidden = !open;
  $('avatar-btn').setAttribute('aria-expanded', String(open));
  if (open) { closeNotifPanel(false); $('pc-change-name').focus(); }
}
function closeProfileCard(returnFocus) {
  if ($('profile-card').hidden) return;
  toggleProfileCard(false);
  if (returnFocus) $('avatar-btn').focus();
}

/* Saves allowed own fields (RLS + column grants only allow name, phone, gender, avatar).
   Returns a translation key on error, or null on success. */
async function saveProfile(patch) {
  if ('full_name' in patch && (patch.full_name.length < 1 || patch.full_name.length > 80)) return 'err.nameInvalid';
  if ('phone' in patch) { if (patch.phone.length > 30) return 'err.phoneLong'; patch.phone = patch.phone || null; }
  if ('gender' in patch) patch.gender = patch.gender || null;
  try {
    const { data, error } = await withLoading(() =>
      sb.from('profiles').update(patch).eq('id', state.profile.id).select(PROFILE_COLS).single());
    if (error) throw error;
    state.profile = data;
    renderDynamicText();
    toast('success', 'toast.saved');
    return null;
  } catch (e) {
    return authErrorKey(e);
  }
}

function openChangeName() {
  closeProfileCard(false);
  const p = state.profile;
  formModal('profile.changeName', [{ name: 'full_name', label: 'profile.name', value: p.full_name, max: 80 }],
    (v) => saveProfile({ full_name: v.full_name }));
}
function openPersonalInfo() {
  closeProfileCard(false);
  const p = state.profile;
  formModal('profile.info', [
    { name: 'full_name', label: 'profile.name', value: p.full_name, max: 80 },
    { name: 'phone', label: 'profile.phone', value: p.phone, max: 30, dir: 'ltr' },
    { name: 'gender', label: 'profile.gender', value: p.gender,
      options: [['', 'gender.unset'], ['male', 'gender.male'], ['female', 'gender.female']] }
  ], (v) => saveProfile({ full_name: v.full_name, phone: v.phone, gender: v.gender }));
}
async function openAvatarPicker() {
  closeProfileCard(false);
  openModal('avatar.title', (b) => b.append(skeleton(2)));
  const { error } = await loadAvatars();
  const body = $('modal-body');
  body.replaceChildren();
  if (error) { body.append(el('p', 'error', t(authErrorKey(error)))); return; }
  if (!state.avatars.length) { body.append(el('p', 'muted', t('avatar.empty'))); return; }
  const grid = el('div', 'avatar-grid');
  state.avatars.forEach((a) => {
    const b = el('button', 'avatar-opt'); b.type = 'button'; b.setAttribute('aria-label', a.id);
    const img = el('img'); img.alt = '';
    img.src = sb.storage.from('profile-avatars').getPublicUrl(a.storage_path).data.publicUrl;
    b.append(img);
    b.addEventListener('click', async () => {
      const key = await saveProfile({ avatar_id: a.id });
      if (key) toast('error', key); else closeModal();
    });
    grid.append(b);
  });
  body.append(grid);
}

/* =====================================================================
   Phase 5 — Contributor "Add Products": product form
   Data layer: lookups · load · save (autosave) · images · niches · submit · discard
   UI: 8 collapsible sections, rows, chips, image grid, action bar
   ===================================================================== */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMG_BUCKET = 'product-images';
const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const IMG_MAX = 5 * 1024 * 1024;
const LIMITS = { images: 10, suppliers: 20, angles: 20, checklist: 50, otherNames: 20 };
const AUTOSAVE_MS = 1500;
const CURRENCIES = ['DZD', 'USD', 'EUR', 'MAD', 'TND', 'SAR', 'AED', 'GBP', 'CNY', 'TRY'];
const CONTACT_METHODS = ['email', 'phone', 'whatsapp', 'telegram', 'facebook', 'instagram', 'tiktok', 'alibaba'];
const URL_METHODS = ['facebook', 'instagram', 'tiktok', 'alibaba'];
const TEXT_KEYS = ['name_ar', 'name_fr', 'name_en', 'description', 'problem_solved', 'potential_customers',
  'potential_uses', 'strengths', 'weaknesses', 'points_to_verify', 'testability_notes', 'commercial_risks',
  'notes', 'next_research_step'];
const PICK_KEYS = ['visual_value', 'actual_value', 'competition', 'source', 'competitor_sales_method'];
const NICHE_COLS = 'id, name_ar, name_fr, name_en, is_seed, is_active, sort_order';
const MICRO_COLS = 'id, niche_id, name_ar, name_fr, name_en, is_seed, is_active, sort_order';
const SECTIONS = ['general', 'analysis', 'evaluation', 'marketing', 'competitor', 'suppliers', 'risks', 'checklist'];

const P = {   // module state (the form itself lives in P.form)
  form: null, niches: [], micros: [], checklistItems: [], lookups: false,
  loadKey: null, seq: 0, sig: null, timer: null,
  statusEl: null, titleEl: null, errEls: {}, nicheBox: null, microBox: null, imgBox: null, imgCount: null, addImgBtn: null
};

/* ===== Helpers ===== */
function uuid() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
/* Display name in the current language, falling back to ar -> fr -> en */
function locName(row, prefix) {
  return row[prefix + state.lang] || row[prefix + 'ar'] || row[prefix + 'fr'] || row[prefix + 'en'] || '';
}
const AR_MAP = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه', 'ؤ': 'و', 'ئ': 'ي' };
/* Mirrors the database search normalisation (Arabic forms, diacritics, French accents) for duplicate checks */
function normalizeName(s) {
  return String(s || '').toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '')
    .replace(/[أإآٱىةؤئ]/g, (c) => AR_MAP[c])
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function parsePrice(s) {   // null = empty, NaN = invalid
  const x = String(s).trim().replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632)).replace(/[,٫]/g, '.');
  if (x === '') return null;
  return /^\d{1,10}(\.\d{1,2})?$/.test(x) ? Number(x) : NaN;
}
const readOnly = (f) => !(f.status === 'draft' || f.status === 'pending');
const hasUnsaved = (f) => f.dirty && !(!f.persisted && isBlank(f));

/* ===== Form model ===== */
function newForm(id) {
  const values = { currency_code: 'DZD', price_from: '', price_to: '' };
  TEXT_KEYS.forEach((k) => { values[k] = ''; });
  PICK_KEYS.forEach((k) => { values[k] = ''; });
  return {
    id: id || uuid(), persisted: false, status: 'draft', values, otherNames: [], nicheIds: new Set(), microIds: new Set(),
    images: [], uploading: 0, suppliers: [], angles: [], checklist: [],
    removed: { suppliers: [], marketing_angles: [], product_checklist_items: [] },
    saved: { values: null, niches: new Set(), micros: new Set() }, dirty: false, chain: Promise.resolve(true), kind: 'new'
  };
}

function productPayload(f) {
  const v = f.values, o = {};
  TEXT_KEYS.forEach((k) => { o[k] = v[k].trim() || null; });
  o.other_names = f.otherNames.slice();
  ['visual_value', 'actual_value'].forEach((k) => { o[k] = v[k] === '' ? null : Number(v[k]); });
  ['competition', 'source', 'competitor_sales_method'].forEach((k) => { o[k] = v[k] || null; });
  ['price_from', 'price_to'].forEach((k) => { const n = parsePrice(v[k]); o[k] = Number.isNaN(n) ? null : n; });
  o.currency_code = v.currency_code;
  return o;
}

function isBlank(f) {
  const v = f.values;
  return TEXT_KEYS.every((k) => !v[k].trim()) && PICK_KEYS.every((k) => !v[k]) &&
    !v.price_from.trim() && !v.price_to.trim() && v.currency_code === 'DZD' &&
    !f.otherNames.length && !f.nicheIds.size && !f.images.length &&
    !f.suppliers.length && !f.angles.length && !f.checklist.length;
}

/* Row tables (children saved by diff): config used by the generic sync */
const supplierIssue = (r) => {
  const has = r.name.trim() || r.contact_details.trim() || r.supplier_message.trim() || r.contact_method;
  if (!r.name.trim()) return has ? 'form.rowNeedsName' : null;
  if (URL_METHODS.includes(r.contact_method) && r.contact_details.trim() && !/^https?:\/\/\S+$/i.test(r.contact_details.trim())) return 'err.supplierUrl';
  return null;
};
const angleIssue = (r) => (!r.name.trim() && r.details.trim() ? 'form.rowNeedsName' : null);
const ROW_TABLES = {
  suppliers: {
    list: 'suppliers', valid: (r) => !!r.name.trim() && !supplierIssue(r),
    cols: (r) => ({ name: r.name.trim(), contact_method: r.contact_method || null,
      contact_details: r.contact_details.trim() || null, supplier_message: r.supplier_message.trim() || null })
  },
  marketing_angles: {
    list: 'angles', valid: (r) => !!r.name.trim(),
    cols: (r) => ({ name: r.name.trim(), details: r.details.trim() || null })
  },
  product_checklist_items: {
    list: 'checklist', valid: (r) => (r.item_id ? (r.persisted || r.is_checked) : !!r.custom_label.trim()),
    cols: (r) => ({ item_id: r.item_id || null, custom_label: r.item_id ? null : r.custom_label.trim(), is_checked: !!r.is_checked })
  }
};

/* ===== Validation ===== */
function softErrors(f) {   // blocks any save (even drafts): would be rejected by the database anyway
  const e = {}, v = f.values;
  const a = parsePrice(v.price_from), b = parsePrice(v.price_to);
  if (Number.isNaN(a) || Number.isNaN(b)) e.price = 'err.priceInvalid';
  else if (a !== null && b !== null && b < a) e.price = 'err.priceRange';
  if (!/^[A-Z]{3}$/.test(v.currency_code)) e.price = e.price || 'err.currencyInvalid';
  return e;
}
function requiredErrors(f) {   // needed to submit, and to save a PENDING product
  const e = softErrors(f), v = f.values;
  if (!v.name_ar.trim() && !v.name_fr.trim() && !v.name_en.trim() && !f.otherNames.length) e.name = 'err.nameRequired';
  if (!f.images.length) e.images = 'err.imageRequired';
  if (!v.description.trim()) e.description = 'err.descRequired';
  if (!e.price && (!v.price_from.trim() || !v.price_to.trim())) e.price = 'err.priceRequired';
  if (f.suppliers.some(supplierIssue)) e.suppliers = 'err.rowsInvalid';
  if (f.angles.some(angleIssue)) e.angles = 'err.rowsInvalid';
  return e;
}
function clearErrors() {
  Object.values(P.errEls).forEach((n) => { n.hidden = true; n.textContent = ''; });
}
function showErrors(errs) {
  clearErrors();
  let first = null;
  Object.keys(errs).forEach((k) => {
    const n = P.errEls[k]; if (!n) return;
    n.textContent = t(errs[k]); n.hidden = false;
    const d = n.closest('details'); if (d) d.open = true;
    if (!first) first = n;
  });
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
/* error.details of change_product_status("name,image,...") -> form error keys */
function serverMissing(details) {
  const map = { name: 'name', image: 'images', description: 'description', price_from: 'price', price_to: 'price' };
  const e = {};
  String(details || '').split(',').forEach((c) => {
    const k = map[c.trim()];
    if (k) e[k] = k === 'price' ? 'err.priceRequired' : { name: 'err.nameRequired', images: 'err.imageRequired', description: 'err.descRequired' }[k];
  });
  return e;
}

/* ===== Lookups (niches, checklist items) ===== */
function sortNiches() {
  P.niches.sort((a, b) => (Number(b.is_seed) - Number(a.is_seed)) || (a.sort_order - b.sort_order) ||
    locName(a, 'name_').localeCompare(locName(b, 'name_'), state.lang));
}
function sortMicros() {
  P.micros.sort((a, b) => (Number(b.is_seed) - Number(a.is_seed)) || (a.sort_order - b.sort_order) ||
    locName(a, 'name_').localeCompare(locName(b, 'name_'), state.lang));
}
async function loadLookups(force) {
  if (P.lookups && !force) return;
  const [n, c, m] = await Promise.all([
    sb.from('niches').select(NICHE_COLS),
    sb.from('checklist_items').select('id, label_ar, label_fr, label_en, is_active, sort_order'),
    sb.from('micro_niches').select(MICRO_COLS)
  ]);
  if (n.error) throw n.error;
  if (m.error) throw m.error;
  if (c.error) throw c.error;
  P.niches = n.data || []; sortNiches();
  P.micros = m.data || []; sortMicros();
  P.checklistItems = (c.data || []).sort((a, b) => a.sort_order - b.sort_order);
  P.lookups = true;
}

/* ===== Load an existing product into the form model ===== */
async function signUrls(paths) {
  const out = {};
  if (!paths.length) return out;
  const r = await sb.storage.from(IMG_BUCKET).createSignedUrls(paths, 3600);
  if (!r.error && r.data) r.data.forEach((x) => { if (x.signedUrl) out[x.path] = x.signedUrl; });
  return out;
}
async function loadProduct(id) {
  const q = (table, cols, order) => {
    const b = sb.from(table).select(cols).eq('product_id', id);
    return order ? b.order('position') : b;
  };
  const [pr, im, ni, su, an, ck, mi] = await Promise.all([
    sb.from('products').select('*').eq('id', id).maybeSingle(),
    q('product_images', 'storage_path, mime_type, size_bytes, position', true),
    q('product_niches', 'niche_id'),
    q('suppliers', '*', true), q('marketing_angles', '*', true), q('product_checklist_items', '*', true),
    q('product_micro_niches', 'micro_niche_id')
  ]);
  [pr, im, ni, su, an, ck, mi].forEach((r) => { if (r.error) throw r.error; });
  if (!pr.data) throw { code: 'PGRST116', message: 'product.not_found' };
  const row = pr.data, f = newForm(id);
  f.persisted = true; f.status = row.status; f.kind = 'saved'; f.row = row;
  TEXT_KEYS.forEach((k) => { f.values[k] = row[k] || ''; });
  PICK_KEYS.forEach((k) => { f.values[k] = row[k] == null ? '' : String(row[k]); });
  ['price_from', 'price_to'].forEach((k) => { f.values[k] = row[k] == null ? '' : String(row[k]); });
  f.values.currency_code = row.currency_code || 'DZD';
  f.otherNames = (row.other_names || []).slice();
  f.nicheIds = new Set((ni.data || []).map((x) => x.niche_id));
  f.saved.niches = new Set(f.nicheIds);
  f.microIds = new Set((mi.data || []).map((x) => x.micro_niche_id));
  f.saved.micros = new Set(f.microIds);
  f.saved.values = JSON.stringify(productPayload(f));
  const urls = await signUrls((im.data || []).map((x) => x.storage_path));
  f.images = (im.data || []).map((x) => ({ storage_path: x.storage_path, mime_type: x.mime_type, size_bytes: x.size_bytes, url: urls[x.storage_path] || null }));
  const fill = (table, data, mk) => {
    const cfg = ROW_TABLES[table];
    f[cfg.list] = (data || []).map((d) => {
      const r = mk(d); r.id = d.id; r.persisted = true;
      r.snap = JSON.stringify(Object.assign(cfg.cols(r), { position: d.position }));
      return r;
    });
  };
  fill('suppliers', su.data, (d) => ({ name: d.name || '', contact_method: d.contact_method || '', contact_details: d.contact_details || '', supplier_message: d.supplier_message || '' }));
  fill('marketing_angles', an.data, (d) => ({ name: d.name || '', details: d.details || '' }));
  fill('product_checklist_items', ck.data, (d) => ({ item_id: d.item_id, custom_label: d.custom_label || '', is_checked: !!d.is_checked }));
  return f;
}

/* ===== Saving (draft autosave, explicit save, pending edits) ===== */
function setSaveState(f, kind) {
  f.kind = kind;
  if (P.form !== f || !P.statusEl) return;
  P.statusEl.textContent = t('save.' + kind);
  P.statusEl.dataset.kind = kind;
}
function scheduleSave() {
  const f = P.form;
  clearTimeout(P.timer);
  P.timer = setTimeout(() => { if (P.form === f) queueSave(f, {}); }, AUTOSAVE_MS);
}
function markDirty() {
  const f = P.form;
  if (!f || readOnly(f)) return;
  f.dirty = true;
  setSaveState(f, f.status === 'draft' ? 'dirty' : 'dirtyManual');
  if (f.status === 'draft') scheduleSave();
}
/* Saves are serialised per form: a second request waits for the first one */
function queueSave(f, opts) {
  f.chain = f.chain.then(() => doSave(f, opts || {}), () => doSave(f, opts || {}));
  return f.chain;
}
async function doSave(f, opts) {
  if (readOnly(f)) return false;
  if (!opts.force && !f.dirty && f.persisted) return true;
  if (!f.persisted && !opts.force && isBlank(f)) { f.dirty = false; setSaveState(f, 'new'); return true; }
  const strict = f.status === 'pending' || opts.complete;
  const errs = strict ? requiredErrors(f) : softErrors(f);
  if (Object.keys(errs).length) {
    if (P.form === f) showErrors(errs);
    setSaveState(f, 'attention');
    return false;
  }
  if (P.form === f) clearErrors();
  f.dirty = false;
  setSaveState(f, 'saving');
  try {
    await saveProductRow(f);
    await saveNiches(f);
    await saveMicros(f);
    for (const table of Object.keys(ROW_TABLES)) await syncTable(f, table);
    setSaveState(f, f.dirty ? (f.status === 'draft' ? 'dirty' : 'dirtyManual') : 'saved');
    if (f.dirty && f.status === 'draft' && P.form === f) scheduleSave();
    return true;
  } catch (e) {
    f.dirty = true;
    setSaveState(f, 'error');
    const key = authErrorKey(e);
    toast('error', key);
    if (key === 'err.productLocked' && P.form === f) { P.loadKey = null; openForm(f.id); }
    return false;
  }
}
async function saveProductRow(f) {
  const data = productPayload(f), snap = JSON.stringify(data);
  if (f.persisted && snap === f.saved.values) return;
  if (!f.persisted) {
    const r = await sb.from('products').insert(Object.assign({ id: f.id, created_by: state.profile.id }, data));
    if (r.error) throw r.error;
    f.persisted = true; f.saved.values = snap;
    if (P.form === f) {   // the draft exists now: make the address reloadable without re-rendering
      history.replaceState(null, '', '#/contributor/add/' + f.id);
      state.routeId = f.id;
      if (P.titleEl) P.titleEl.textContent = t('form.editTitle');
      renderActions();
    }
  } else {
    const r = await sb.from('products').update(data).eq('id', f.id).select('id');
    if (r.error) throw r.error;
    if (!r.data || !r.data.length) throw { code: 'PGRST116', message: 'product.not_editable' };   // RLS refused: status changed
    f.saved.values = snap;
  }
}
async function saveNiches(f) {
  const add = [...f.nicheIds].filter((id) => !f.saved.niches.has(id));
  const del = [...f.saved.niches].filter((id) => !f.nicheIds.has(id));
  if (del.length) {
    const r = await sb.from('product_niches').delete().eq('product_id', f.id).in('niche_id', del);
    if (r.error) throw r.error;
  }
  if (add.length) {
    const r = await sb.from('product_niches').insert(add.map((niche_id) => ({ product_id: f.id, niche_id })));
    if (r.error) throw r.error;
  }
  f.saved.niches = new Set(f.nicheIds);
}
/* Micro-niches are saved after niches (the database requires the parent niche to be on the product) */
async function saveMicros(f) {
  const add = [...f.microIds].filter((id) => !f.saved.micros.has(id));
  const del = [...f.saved.micros].filter((id) => !f.microIds.has(id));
  if (del.length) {
    const r = await sb.from('product_micro_niches').delete().eq('product_id', f.id).in('micro_niche_id', del);
    if (r.error) throw r.error;
  }
  if (add.length) {
    const r = await sb.from('product_micro_niches').insert(add.map((micro_niche_id) => ({ product_id: f.id, micro_niche_id })));
    if (r.error) throw r.error;
  }
  f.saved.micros = new Set(f.microIds);
}
/* Child rows are saved by diff: removed -> delete, new -> insert, changed -> update. Incomplete rows are skipped. */
async function syncTable(f, table) {
  const cfg = ROW_TABLES[table], rows = f[cfg.list];
  if (f.removed[table].length) {
    const r = await sb.from(table).delete().eq('product_id', f.id).in('id', f.removed[table]);
    if (r.error) throw r.error;
    f.removed[table] = [];
  }
  const inserts = [], updates = [];
  rows.filter(cfg.valid).forEach((r, i) => {
    const data = Object.assign(cfg.cols(r), { position: i }), snap = JSON.stringify(data);
    if (!r.persisted) inserts.push({ r, snap, row: Object.assign({ id: r.id, product_id: f.id }, data) });
    else if (snap !== r.snap) updates.push({ r, snap, data });
  });
  if (inserts.length) {
    const res = await sb.from(table).insert(inserts.map((x) => x.row));
    if (res.error) throw res.error;
    inserts.forEach((x) => { x.r.persisted = true; x.r.snap = x.snap; });
  }
  for (const u of updates) {
    const res = await sb.from(table).update(u.data).eq('id', u.r.id).select('id');
    if (res.error) throw res.error;
    u.r.snap = u.snap;
  }
}

/* ===== Images (private bucket "product-images", path = <product_id>/<uuid>.<ext>) ===== */
async function addImages(fileList) {
  const f = P.form;
  let files = Array.from(fileList || []);
  if (!files.length || readOnly(f)) return;
  const room = LIMITS.images - f.images.length - f.uploading;
  if (files.length > room) { toast('error', 'err.imagesLimit'); files = files.slice(0, Math.max(room, 0)); }
  files = files.filter((file) => {
    if (!IMG_TYPES[file.type]) { toast('error', 'err.fileType'); return false; }
    if (file.size < 1 || file.size > IMG_MAX) { toast('error', 'err.fileTooLarge'); return false; }
    return true;
  });
  if (!files.length) return;
  if (!f.persisted) await queueSave(f, { force: true });   // the product row must exist before its files (storage policy)
  if (!f.persisted) return;
  f.uploading += files.length; renderImages();
  for (const file of files) {
    try { await uploadImage(f, file); } catch (e) { toast('error', authErrorKey(e)); } finally { f.uploading--; }
    if (P.form === f) renderImages();
  }
}
async function uploadImage(f, file) {
  const path = f.id + '/' + uuid() + '.' + IMG_TYPES[file.type];
  const up = await sb.storage.from(IMG_BUCKET).upload(path, file, { contentType: file.type, upsert: false, cacheControl: '3600' });
  if (up.error) throw up.error;
  const ins = await sb.from('product_images').insert({
    product_id: f.id, storage_path: path, mime_type: file.type, size_bytes: file.size, position: f.images.length });
  if (ins.error) {
    try { await sb.storage.from(IMG_BUCKET).remove([path]); } catch (e) { /* orphan cleanup is best effort */ }
    throw ins.error;
  }
  const urls = await signUrls([path]);
  f.images.push({ storage_path: path, mime_type: file.type, size_bytes: file.size, url: urls[path] || null });
}
async function moveImage(i, d) {
  const f = P.form, j = i + d;
  if (j < 0 || j >= f.images.length || f.busyImages) return;
  f.busyImages = true;
  const before = f.images.slice();
  [f.images[i], f.images[j]] = [f.images[j], f.images[i]];
  renderImages();
  try {
    const results = await Promise.all([i, j].map((k) =>
      sb.from('product_images').update({ position: k }).eq('product_id', f.id).eq('storage_path', f.images[k].storage_path)));
    const bad = results.find((r) => r.error);
    if (bad) throw bad.error;
  } catch (e) {
    f.images = before; renderImages(); toast('error', authErrorKey(e));
  } finally { f.busyImages = false; }
}
function removeImage(i) {
  const f = P.form;
  if (f.status !== 'draft' && f.images.length <= 1) { toast('error', 'err.lastImage'); return; }
  confirmModal({
    titleKey: 'imgremove.title', bodyKey: 'imgremove.body', confirmKey: 'common.remove', danger: true,
    onConfirm: async () => {
      const im = f.images[i];
      try {
        const r = await sb.from('product_images').delete().eq('product_id', f.id).eq('storage_path', im.storage_path).select('storage_path');
        if (r.error) throw r.error;
        if (!r.data || !r.data.length) throw { code: 'PGRST116', message: 'product.not_editable' };
        try { await sb.storage.from(IMG_BUCKET).remove([im.storage_path]); } catch (e) { /* file cleanup is best effort */ }
        f.images.splice(i, 1);
        // keep positions consecutive
        await Promise.all(f.images.map((x, k) => sb.from('product_images').update({ position: k }).eq('product_id', f.id).eq('storage_path', x.storage_path)));
        if (P.form === f) renderImages();
        return null;
      } catch (e) { return authErrorKey(e); }
    }
  });
}

/* ===== Niches ===== */
function validateNicheName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) return { key: 'err.nicheEmpty' };
  if (Array.from(name).length > 100) return { key: 'err.nicheLong' };
  if (/[\u0000-\u001f\u007f<>]/.test(name) || !/\p{L}/u.test(name)) return { key: 'err.nicheInvalid' };
  return { name };
}
/* Returns a translation key on error, null on success (formModal contract) */
async function createNiche(raw) {
  const v = validateNicheName(raw);
  if (v.key) return v.key;
  const norm = normalizeName(v.name);
  const dup = P.niches.some((n) => ['name_ar', 'name_fr', 'name_en'].some((c) => n[c] && normalizeName(n[c]) === norm));
  if (dup) return 'err.nicheDuplicate';
  const col = 'name_' + state.lang;   // stored in the column of the current UI language
  try {
    const { data, error } = await withLoading(() =>
      sb.from('niches').insert({ [col]: v.name, created_by: state.profile.id }).select(NICHE_COLS).single());
    if (error) throw error;
    P.niches.push(data); sortNiches();
    P.form.nicheIds.add(data.id);
    renderNiches(); markDirty();
    toast('success', 'toast.nicheAdded');
    return null;
  } catch (e) {
    if (e && e.code === '23505') { loadLookups(true).then(renderNiches).catch(() => {}); return 'err.nicheDuplicate'; }
    return authErrorKey(e);
  }
}
function openAddNiche() {
  formModal('niche.modalTitle', [{ name: 'name', label: 'niche.name', value: '', max: 100, dir: 'auto' }],
    (v) => createNiche(v.name));
}

/* ===== Submit / discard ===== */
function submitProduct() {
  const f = P.form;
  const errs = requiredErrors(f);
  if (Object.keys(errs).length) { showErrors(errs); toast('error', 'err.fixFields'); return; }
  confirmModal({
    titleKey: 'submit.title', bodyKey: 'submit.body', confirmKey: 'submit.confirm',
    onConfirm: async () => {
      clearTimeout(P.timer);
      const ok = await queueSave(f, { force: true, complete: true });
      if (!ok) return 'err.saveFirst';
      const r = await withLoading(() => sb.rpc('change_product_status', { p_product_id: f.id, p_to_status: 'pending' }));
      if (r.error) {
        if (String(r.error.message).includes('product.missing_fields')) {
          showErrors(serverMissing(r.error.details)); toast('error', 'err.missingFields'); return null;
        }
        return authErrorKey(r.error);
      }
      f.status = 'pending'; f.dirty = false; f.kind = 'saved';
      toast('success', 'toast.submitted');
      renderForm(); window.scrollTo({ top: 0, behavior: 'smooth' });
      return null;
    }
  });
}
function discardDraft() {
  const f = P.form;
  confirmModal({
    titleKey: 'discard.title', bodyKey: 'discard.body', confirmKey: 'discard.confirm', danger: true,
    onConfirm: async () => {
      clearTimeout(P.timer);
      try {
        await f.chain;
        const paths = f.images.map((x) => x.storage_path);
        if (paths.length) {   // files first: after the row is gone the storage policy can no longer match them
          const rm = await sb.storage.from(IMG_BUCKET).remove(paths);
          if (rm.error) throw rm.error;
        }
        const d = await sb.from('products').delete().eq('id', f.id).select('id');
        if (d.error) throw d.error;
        if (!d.data || !d.data.length) throw { code: 'PGRST116', message: 'product.not_editable' };
        P.form = null; P.sig = null; state.routeId = null;
        toast('success', 'toast.discarded');
        location.hash = '#/contributor/add';
        return null;
      } catch (e) { return authErrorKey(e); }
    }
  });
}
function confirmModal(o) {
  openModal(o.titleKey, (body) => {
    body.append(el('p', null, o.bodyText || t(o.bodyKey)));
    const err = el('p', 'error'); err.setAttribute('role', 'alert'); err.hidden = true;
    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn btn-ghost', t('common.cancel')); cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    const ok = el('button', 'btn ' + (o.danger ? 'btn-danger' : 'btn-primary'), t(o.confirmKey)); ok.type = 'button';
    ok.addEventListener('click', async () => {
      if (ok.disabled) return;
      ok.disabled = true;
      const key = await o.onConfirm();
      ok.disabled = false;
      if (key) { err.textContent = t(key); err.hidden = false; } else closeModal();
    });
    actions.append(cancel, ok);
    body.append(err, actions);
    cancel.focus();
  });
}

/* ===== Module lifecycle (called from renderShell / route) ===== */
function flushForm(f) {
  clearTimeout(P.timer);
  if (f && f.status === 'draft' && hasUnsaved(f)) queueSave(f, {});
}
function leaveAdd(flush) {
  if (flush) flushForm(P.form);
  P.form = null; P.sig = null; P.loadKey = null; P.seq++;
}
async function flushAdd() {   // before logout
  const f = P.form;
  if (f && f.status === 'draft' && hasUnsaved(f)) { clearTimeout(P.timer); await queueSave(f, {}); }
  leaveAdd(false); P.lookups = false; state.routeId = null;
}
function renderModule() {
  const p = state.profile;
  const isAdd = !!p && p.role === 'contributor' && state.page === 'add';
  const isList = !!p && p.role === 'contributor' && state.page === 'products';
  const isAdm = !!p && p.role === 'admin' && state.page === 'products';
  const isAList = isAdm && !state.routeId, isAReview = isAdm && !!state.routeId;
  const isStats = !!p && p.role === 'contributor' && state.page === 'stats';        // Phase 9
  const isEval = !!p && p.role === 'admin' && state.page === 'statistics';           // Phase 9
  const adm = !!p && p.role === 'admin';
  const isOrg = adm && state.page === 'organization';                                // Phase 10
  const isBin = adm && state.page === 'recycle';                                     // Phase 10
  const isMicro = adm && state.page === 'micro';                                     // Phase 11
  const isUsers = adm && state.page === 'users';                                     // Phase 11
  const isChat = !!p && state.page === 'chat';                                       // Phase 13
  const any = isChat || isAdd || isList || isAdm || isStats || isEval || isOrg || isBin || isMicro || isUsers;
  $('module-body').hidden = !any;
  document.querySelector('#view-module .empty').hidden = any;
  if (!isAdd && (P.form || P.loadKey)) leaveAdd(true);   // leaving the form saves a pending draft first
  if (!isList && L.active) leaveList();
  if (!isAList && A.active) leaveAdminList();
  if (!isAReview && R.active) leaveReview();
  if (!isStats && S.active) leaveStats();
  if (!isEval && E.active) leaveEval();
  if (!isChat && CH.view) leaveChat();
  if (!isOrg && O.active) leaveOrg();
  if (!isBin && B.active) leaveBin();
  if (!isMicro && M.active) leaveMicro();
  if (!isUsers && U.active) leaveUsers();
  if (isChat) { if (!CH.view) enterChat(); else if (CH.sig !== state.lang) renderChat(); return; }
  if (isOrg) { if (!O.active) enterOrg(); else if (O.sig !== state.lang) renderOrg(); return; }
  if (isBin) { if (!B.active) enterBin(); else if (B.sig !== state.lang) renderBin(); return; }
  if (isMicro) { if (!M.active) enterMicro(); else if (M.sig !== state.lang) renderMicro(); return; }
  if (isUsers) { if (!U.active) enterUsers(); else if (U.sig !== state.lang) renderUsers(); return; }
  if (isStats) { if (!S.active) enterStats(); else if (S.sig !== state.lang) renderStats(); return; }
  if (isEval) { if (!E.active) enterEval(); else if (E.sig !== state.lang) renderEval(); return; }
  if (isList) { if (!L.active) enterList(); else if (L.sig !== state.lang) renderList(); return; }
  if (isAList) { if (!A.active) enterAdminList(); else if (A.sig !== state.lang) renderAdminList(); return; }
  if (isAReview) {
    if (!R.active || R.id !== state.routeId) enterReview(state.routeId);
    else if (R.data && R.sig !== state.lang) renderReview();
    return;
  }
  if (!isAdd) return;
  const key = state.routeId || 'new', f = P.form;
  const current = !!f && (state.routeId ? f.id === state.routeId : !f.persisted);
  if (!current) { if (P.loadKey !== key) openForm(state.routeId); return; }
  if (P.sig !== state.lang) renderForm();
}
async function openForm(routeId) {
  const key = routeId || 'new', seq = ++P.seq;
  flushForm(P.form);
  P.form = null; P.loadKey = key;
  const body = $('module-body');
  body.replaceChildren(skeleton(5));
  try {
    const f = await withLoading(async () => {
      await loadLookups();
      if (!routeId) return newForm();
      const pf = await loadProduct(routeId);
      await loadReviewNote(pf);
      return pf;
    });
    if (seq !== P.seq) return;
    P.form = f; P.loadKey = null;
    renderForm();
  } catch (e) {
    if (seq !== P.seq) return;
    const k = authErrorKey(e);
    if (routeId && (k === 'err.productNotFound' || k === 'err.forbidden')) {
      toast('error', 'err.productNotFound');
      state.routeId = null; location.replace('#/contributor/add'); return;
    }
    const box = el('div', 'card center');
    box.append(el('p', 'error', t(k)));
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => { P.loadKey = null; P.lookups = false; renderModule(); });
    box.append(retry);
    body.replaceChildren(box);
  }
}

/* ===== UI: building blocks ===== */
function errBox(k) {
  const n = el('p', 'error err-inline'); n.setAttribute('role', 'alert'); n.hidden = true;
  P.errEls[k] = n; return n;
}
function field(labelKey, control, o = {}) {
  const w = el('div', 'field');
  const l = el('label', null, t(labelKey) + (o.req ? ' *' : '')); l.htmlFor = control.id;
  w.append(l, control);
  if (o.hint) w.append(el('p', 'hint', t(o.hint)));
  return w;
}
function textCtl(obj, key, o = {}) {   // text input / textarea bound to obj[key]
  const f = P.form;
  const c = el(o.rows ? 'textarea' : 'input'); c.id = (o.id || 'p-' + key);
  if (o.rows) c.rows = o.rows; else c.type = 'text';
  if (o.max) c.maxLength = o.max;
  if (o.dir) c.dir = o.dir;
  if (o.mode) c.inputMode = o.mode;
  c.value = obj[key]; c.disabled = readOnly(f);
  c.addEventListener('input', () => { obj[key] = c.value; if (o.after) o.after(); markDirty(); });
  return c;
}
function selCtl(obj, key, options, o = {}) {   // options: [[value, labelKey | literal]]
  const f = P.form;
  const c = el('select'); c.id = o.id || 'p-' + key;
  options.forEach(([v, lab]) => { const op = el('option', null, o.literal ? lab : t(lab)); op.value = v; c.append(op); });
  c.value = obj[key]; c.disabled = readOnly(f);
  c.addEventListener('change', () => { obj[key] = c.value; if (o.after) o.after(); markDirty(); });
  return c;
}
const UNSET = ['', 'common.unset'];

/* ===== UI: form ===== */
function renderForm() {
  const f = P.form, body = $('module-body');
  const openSecs = new Set(Array.from(body.querySelectorAll('details.fsec[open]')).map((d) => d.dataset.sec));
  P.sig = state.lang; P.errEls = {};
  body.replaceChildren();
  const wrap = el('div', 'pform');
  wrap.append(buildHeader(f), buildDrafts(), buildBanner(f));
  const hint = el('p', 'hint', t('form.requiredHint')); wrap.append(hint);
  SECTIONS.forEach((k, i) => {
    const d = buildSection(i, k, f);
    if (openSecs.size) d.open = openSecs.has(k);
    wrap.append(d);
  });
  const bar = el('div', 'pf-actions'); P.actionsEl = bar; wrap.append(bar);
  body.append(wrap);
  renderActions();
  setSaveState(f, f.kind || 'new');
}
function buildHeader(f) {
  const h = el('div', 'pf-head');
  const row = el('div', 'pf-title');
  P.titleEl = el('h2', null, t(f.persisted ? 'form.editTitle' : 'form.newTitle'));
  row.append(P.titleEl, el('span', 'badge badge-' + f.status, t('status.' + f.status)));
  P.statusEl = el('p', 'save-state'); P.statusEl.setAttribute('role', 'status'); P.statusEl.setAttribute('aria-live', 'polite');
  h.append(row, P.statusEl);
  return h;
}
function buildBanner(f) {
  const wrap = el('div');
  if (f.review) {   // why it was rejected / returned to pending (from product_status_history)
    const b = el('div', 'banner banner-review'); b.setAttribute('role', 'note');
    const r = el('p', 'rv-pre', f.review.reason || t('rv.note.noReason')); r.dir = 'auto';
    b.append(el('strong', null, t('rv.note.' + f.review.kind)), r);
    wrap.append(b);
  }
  if (f.status === 'pending') wrap.append(el('p', 'banner banner-info', t('form.pendingNote')));
  else if (readOnly(f)) wrap.append(el('p', 'banner banner-warn', t('form.readOnly')));
  return wrap;
}
/* The review note is the reason of the LAST history entry, only when it is a rejection or a return to pending */
function reviewNote(status, latest) {
  if (!latest) return null;
  if (status === 'rejected' && latest.action === 'rejected') return { kind: 'rejected', reason: latest.reason };
  if (status === 'pending' && latest.action === 're_reviewed') return { kind: 'returned', reason: latest.reason };
  return null;
}
async function loadReviewNote(f) {
  f.review = null;
  if (f.status !== 'rejected' && f.status !== 'pending') return;
  try {
    const r = await sb.from('product_status_history').select('action, reason, changed_at')
      .eq('product_id', f.id).order('changed_at', { ascending: false }).order('id', { ascending: false }).limit(1);
    if (!r.error && r.data && r.data.length) f.review = reviewNote(f.status, r.data[0]);
  } catch (e) { /* the note is optional: the form still opens */ }
}
function buildDrafts() {
  const d = el('details', 'drafts');
  d.append(el('summary', null, t('drafts.title')));
  const list = el('div', 'drafts-list'); d.append(list);
  d.addEventListener('toggle', async () => {
    if (!d.open) return;
    list.replaceChildren(skeleton(2));
    const r = await sb.from('products').select('id, status, name_ar, name_fr, name_en, other_names, updated_at')
      .in('status', ['draft', 'pending']).is('deleted_at', null).order('updated_at', { ascending: false }).limit(20);
    list.replaceChildren();
    const fresh = el('a', 'draft-item draft-new', t('drafts.new')); fresh.href = '#/contributor/add';
    list.append(fresh);
    if (r.error) { list.append(el('p', 'error', t(authErrorKey(r.error)))); return; }
    if (!r.data.length) list.append(el('p', 'hint', t('drafts.empty')));
    r.data.forEach((p) => {
      const a = el('a', 'draft-item'); a.href = '#/contributor/add/' + p.id;
      a.append(el('span', null, locName(p, 'name_') || (p.other_names && p.other_names[0]) || t('drafts.untitled')),
        el('span', 'badge badge-' + p.status, t('status.' + p.status)));
      list.append(a);
    });
  });
  return d;
}
function buildSection(i, k, f) {
  const d = el('details', 'fsec'); d.dataset.sec = k;
  if (i === 0) d.open = true;
  const sm = el('summary');
  sm.append(el('span', 'fsec-n', String(i + 1)), el('span', null, t('sec.' + k)));
  const b = el('div', 'fsec-body');
  ({ general: buildGeneral, analysis: buildAnalysis, evaluation: buildEvaluation, marketing: buildMarketing,
    competitor: buildCompetitor, suppliers: buildSuppliers, risks: buildRisks, checklist: buildChecklist })[k](b, f);
  d.append(sm, b);
  return d;
}
function renderActions() {
  const f = P.form, bar = P.actionsEl;
  if (!bar || !f) return;
  bar.replaceChildren();
  if (readOnly(f)) { bar.hidden = true; return; }
  bar.hidden = false;
  const save = el('button', 'btn ' + (f.status === 'draft' ? 'btn-secondary' : 'btn-primary'),
    t(f.status === 'draft' ? 'form.saveDraft' : 'form.saveChanges')); save.type = 'button';
  save.addEventListener('click', async () => {
    clearTimeout(P.timer);
    const ok = await queueSave(f, { force: true });
    if (ok) toast('success', 'toast.saved'); else if (f.kind === 'attention') toast('error', 'err.fixFields');
  });
  bar.append(save);
  if (f.status === 'draft') {
    const sub = el('button', 'btn btn-primary', t('form.submit')); sub.type = 'button';
    sub.addEventListener('click', submitProduct);
    bar.append(sub);
    if (f.persisted) {
      const del = el('button', 'btn btn-ghost btn-danger-ghost', t('form.discard')); del.type = 'button';
      del.addEventListener('click', discardDraft);
      bar.append(del);
    }
  }
}

/* --- 1. General information --- */
function buildGeneral(b, f) {
  const names = el('div', 'grid-2');
  names.append(
    field('form.nameAr', textCtl(f.values, 'name_ar', { max: 300, dir: 'rtl' })),
    field('form.nameFr', textCtl(f.values, 'name_fr', { max: 300, dir: 'ltr' })),
    field('form.nameEn', textCtl(f.values, 'name_en', { max: 300, dir: 'ltr' })));
  b.append(names, buildOtherNames(f), errBox('name'));

  const nf = el('div', 'field');
  nf.append(el('p', 'label-like', t('form.niches')));
  P.nicheBox = el('div', 'chips');
  const add = el('button', 'btn btn-secondary btn-sm', '＋ ' + t('niche.add')); add.type = 'button';
  add.disabled = readOnly(f); add.addEventListener('click', openAddNiche);
  nf.append(P.nicheBox, add, el('p', 'hint', t('form.nichesHint')));
  b.append(nf);
  const mf = el('div', 'field');
  mf.append(el('p', 'label-like', t('form.micros')));
  P.microBox = el('div', 'micro-groups');
  mf.append(P.microBox, el('p', 'hint', t('form.microsHint')));
  b.append(mf);
  renderNiches();

  b.append(field('form.source', selCtl(f.values, 'source', [UNSET, ['local', 'source.local'], ['import', 'source.import']])));
  b.append(buildImages(f), errBox('images'));
}
function buildOtherNames(f) {
  const w = el('div', 'field'), ro = readOnly(f);
  const l = el('label', null, t('form.otherNames')); l.htmlFor = 'p-other_names';
  const list = el('div', 'chips'), row = el('div', 'inline-add');
  const inp = el('input'); inp.type = 'text'; inp.id = 'p-other_names'; inp.maxLength = 100;
  inp.placeholder = t('form.otherNamesPh'); inp.disabled = ro;
  const add = el('button', 'btn btn-ghost', t('common.add')); add.type = 'button'; add.disabled = ro;
  const draw = () => {
    list.replaceChildren();
    f.otherNames.forEach((n, i) => {
      const c = el('span', 'tag', n), x = el('button', 'tag-x', '×'); x.type = 'button'; x.disabled = ro;
      x.setAttribute('aria-label', t('common.remove'));
      x.addEventListener('click', () => { f.otherNames.splice(i, 1); draw(); markDirty(); });
      c.append(x); list.append(c);
    });
  };
  const commit = () => {
    const v = inp.value.replace(/\s+/g, ' ').trim();
    if (!v) return;
    if (f.otherNames.length >= LIMITS.otherNames) { toast('error', 'err.otherNamesLimit'); return; }
    if (!f.otherNames.some((x) => x.toLowerCase() === v.toLowerCase())) { f.otherNames.push(v); draw(); markDirty(); }
    inp.value = '';
  };
  add.addEventListener('click', commit);
  inp.addEventListener('blur', commit);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
  row.append(inp, add); w.append(l, row, list); draw();
  return w;
}
function renderNiches() {
  const f = P.form, box = P.nicheBox;
  if (!f || !box) return;
  box.replaceChildren();
  const shown = P.niches.filter((n) => n.is_active || f.nicheIds.has(n.id));
  if (!shown.length) box.append(el('p', 'hint', t('form.nichesEmpty')));
  shown.forEach((n) => {
    const on = f.nicheIds.has(n.id);
    const c = el('button', 'chip' + (on ? ' on' : ''), locName(n, 'name_')); c.type = 'button';
    c.setAttribute('aria-pressed', String(on)); c.disabled = readOnly(f);
    c.addEventListener('click', () => {
      if (f.nicheIds.has(n.id)) {
        f.nicheIds.delete(n.id);
        P.micros.forEach((m) => { if (m.niche_id === n.id) f.microIds.delete(m.id); });   // changing the Niche clears its Micro-niches
      } else f.nicheIds.add(n.id);
      renderNiches(); markDirty();
    });
    box.append(c);
  });
  renderMicros();
}
/* Micro-niches of the selected Niches, grouped by parent. Only valid combinations can be picked. */
function renderMicros() {
  const f = P.form, box = P.microBox;
  if (!f || !box) return;
  box.replaceChildren();
  const chip = (m) => {
    const on = f.microIds.has(m.id);
    const c = el('button', 'chip' + (on ? ' on' : ''), locName(m, 'name_')); c.type = 'button';
    c.setAttribute('aria-pressed', String(on)); c.disabled = readOnly(f);
    c.addEventListener('click', () => {
      if (f.microIds.has(m.id)) f.microIds.delete(m.id); else f.microIds.add(m.id);
      renderMicros(); markDirty();
    });
    return c;
  };
  const selected = P.niches.filter((n) => f.nicheIds.has(n.id));
  if (!selected.length) box.append(el('p', 'hint', t('form.microsPickNiche')));
  selected.forEach((n) => {
    const g = el('div', 'micro-group');
    g.append(el('p', 'micro-group-title', locName(n, 'name_')));
    const list = P.micros.filter((m) => m.niche_id === n.id && (m.is_active || f.microIds.has(m.id)));
    if (!list.length) g.append(el('p', 'hint', t('form.microsNone')));
    else { const cs = el('div', 'chips'); list.forEach((m) => cs.append(chip(m))); g.append(cs); }
    box.append(g);
  });
  // legacy links (no parent / parent not on this product): kept, can only be removed
  const orphans = P.micros.filter((m) => f.microIds.has(m.id) && !(m.niche_id && f.nicheIds.has(m.niche_id)));
  if (orphans.length) {
    const g = el('div', 'micro-group');
    g.append(el('p', 'micro-group-title', t('form.microsOrphan')));
    const cs = el('div', 'chips'); orphans.forEach((m) => cs.append(chip(m))); g.append(cs); box.append(g);
  }
}
function buildImages(f) {
  const w = el('div', 'field');
  const head = el('div', 'img-head');
  head.append(el('p', 'label-like', t('form.images') + ' *'));
  P.imgCount = el('span', 'hint');
  head.append(P.imgCount);
  P.imgBox = el('div', 'img-grid');
  const input = el('input'); input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp'; input.multiple = true; input.hidden = true;
  input.addEventListener('change', () => { addImages(input.files); input.value = ''; });
  P.addImgBtn = el('button', 'btn btn-secondary btn-sm', '＋ ' + t('img.add')); P.addImgBtn.type = 'button';
  P.addImgBtn.addEventListener('click', () => input.click());
  w.append(head, P.imgBox, P.addImgBtn, input, el('p', 'hint', t('form.imagesHint')));
  renderImages();
  return w;
}
function renderImages() {
  const f = P.form, box = P.imgBox;
  if (!f || !box) return;
  box.replaceChildren();
  const ro = readOnly(f), ar = state.lang === 'ar';
  f.images.forEach((im, i) => {
    const card = el('div', 'img-card' + (i === 0 ? ' main' : ''));
    const img = el('img'); img.alt = t('form.imageN', { n: i + 1 }); img.loading = 'lazy';
    if (im.url) img.src = im.url;
    img.addEventListener('error', async () => {   // signed URL expired: sign again once
      if (im.retried) return;
      im.retried = true;
      const u = await signUrls([im.storage_path]);
      if (u[im.storage_path]) { im.url = u[im.storage_path]; img.src = im.url; }
    });
    card.append(img);
    if (i === 0) card.append(el('span', 'img-main', t('img.main')));
    if (!ro) {
      const bar = el('div', 'img-bar');
      const mk = (txt, label, fn, dis) => {
        const bt = el('button', 'img-btn', txt); bt.type = 'button'; bt.disabled = dis;
        bt.setAttribute('aria-label', t(label)); bt.title = t(label); bt.addEventListener('click', fn); return bt;
      };
      bar.append(
        mk(ar ? '→' : '←', 'img.earlier', () => moveImage(i, -1), i === 0),
        mk(ar ? '←' : '→', 'img.later', () => moveImage(i, 1), i === f.images.length - 1),
        mk('×', 'img.remove', () => removeImage(i), false));
      card.append(bar);
    }
    box.append(card);
  });
  for (let k = 0; k < f.uploading; k++) box.append(el('div', 'img-card img-loading skeleton'));
  P.imgCount.textContent = f.images.length + '/' + LIMITS.images;
  P.addImgBtn.disabled = ro || f.images.length + f.uploading >= LIMITS.images;
}

/* --- 2. Product analysis --- */
function buildAnalysis(b, f) {
  b.append(field('form.description', textCtl(f.values, 'description', { rows: 6, max: 20000 }), { req: true }), errBox('description'));
  [['problem_solved', 'form.problemSolved'], ['potential_customers', 'form.potentialCustomers'],
   ['potential_uses', 'form.potentialUses'], ['strengths', 'form.strengths'], ['weaknesses', 'form.weaknesses'],
   ['points_to_verify', 'form.pointsToVerify']].forEach(([k, lab]) => {
    b.append(field(lab, textCtl(f.values, k, { rows: 3, max: 20000 })));
  });
}

/* --- 3. Product evaluation --- */
function buildEvaluation(b, f) {
  const stars = [UNSET, ['1', '1'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5']].map((o) => [o[0], o[0] === '' ? t(o[1]) : o[1]]);
  const score = el('output', 'score');
  const refresh = () => {
    const a = f.values.visual_value, c = f.values.actual_value;
    score.textContent = a && c ? String(Number(a) + Number(c)) + ' / 10' : '—';
  };
  const grid = el('div', 'grid-2');
  grid.append(
    field('form.visualValue', selCtl(f.values, 'visual_value', stars, { literal: true, after: refresh })),
    field('form.actualValue', selCtl(f.values, 'actual_value', stars, { literal: true, after: refresh })));
  const sc = el('div', 'field'); sc.append(el('p', 'label-like', t('form.valueScore')), score);
  refresh();
  b.append(grid, sc,
    field('form.competition', selCtl(f.values, 'competition', [UNSET, ['none', 'comp.none'], ['weak', 'comp.weak'], ['medium', 'comp.medium'], ['high', 'comp.high']])),
    field('form.testability', textCtl(f.values, 'testability_notes', { rows: 3, max: 20000 })));
}

/* --- generic row editor (marketing angles, suppliers) --- */
function rowList(b, f, o) {
  const ro = readOnly(f), list = el('div', 'rows');
  const add = el('button', 'btn btn-secondary btn-sm', '＋ ' + t(o.addKey)); add.type = 'button';
  const draw = () => {
    list.replaceChildren();
    f[o.list].forEach((row, i) => {
      const card = el('div', 'row-card'), head = el('div', 'row-head');
      head.append(el('strong', null, t(o.titleKey, { n: i + 1 })));
      const rm = el('button', 'btn btn-ghost btn-sm', t('common.remove')); rm.type = 'button'; rm.disabled = ro;
      rm.addEventListener('click', () => {
        const [gone] = f[o.list].splice(i, 1);
        if (gone.persisted) f.removed[o.table].push(gone.id);
        draw(); markDirty();
      });
      head.append(rm); card.append(head);
      const hint = el('p', 'row-hint'); hint.hidden = true;
      const upd = () => { const k = o.issue(row); hint.hidden = !k; hint.textContent = k ? t(k) : ''; };
      o.fields(card, row, upd);
      card.append(hint); upd();
      list.append(card);
    });
    add.disabled = ro || f[o.list].length >= o.max;
  };
  add.addEventListener('click', () => {
    f[o.list].push(o.make()); draw(); markDirty();
    const last = list.lastElementChild; const first = last && last.querySelector('input, textarea');
    if (first) first.focus();
  });
  b.append(list, add, errBox(o.list)); draw();
}

/* --- 4. Marketing analysis --- */
function buildMarketing(b, f) {
  rowList(b, f, {
    list: 'angles', table: 'marketing_angles', max: LIMITS.angles, addKey: 'angle.add', titleKey: 'angle.n',
    issue: angleIssue, make: () => ({ id: uuid(), persisted: false, name: '', details: '' }),
    fields: (card, r, upd) => {
      card.append(
        field('angle.name', textCtl(r, 'name', { id: 'ang-n-' + r.id, max: 200, after: upd })),
        field('angle.details', textCtl(r, 'details', { id: 'ang-d-' + r.id, rows: 3, max: 5000, after: upd })));
    }
  });
}

/* --- 5. Competitor analysis --- */
function buildCompetitor(b, f) {
  const g = el('div', 'grid-3');
  g.append(
    field('form.priceFrom', textCtl(f.values, 'price_from', { mode: 'decimal', dir: 'ltr', max: 14 }), { req: true }),
    field('form.priceTo', textCtl(f.values, 'price_to', { mode: 'decimal', dir: 'ltr', max: 14 }), { req: true }),
    field('form.currency', selCtl(f.values, 'currency_code',
      (CURRENCIES.includes(f.values.currency_code) ? CURRENCIES : CURRENCIES.concat(f.values.currency_code)).map((c) => [c, c]), { literal: true })));
  b.append(g, errBox('price'),
    field('form.salesMethod', selCtl(f.values, 'competitor_sales_method',
      [UNSET, ['direct_sales', 'sales.direct_sales'], ['branding', 'sales.branding'], ['both', 'sales.both']])));
}

/* --- 6. Suppliers --- */
function buildSuppliers(b, f) {
  rowList(b, f, {
    list: 'suppliers', table: 'suppliers', max: LIMITS.suppliers, addKey: 'supplier.add', titleKey: 'supplier.n',
    issue: supplierIssue,
    make: () => ({ id: uuid(), persisted: false, name: '', contact_method: '', contact_details: '', supplier_message: '' }),
    fields: (card, r, upd) => {
      card.append(
        field('supplier.name', textCtl(r, 'name', { id: 'sup-n-' + r.id, max: 200, after: upd }), { req: true }),
        field('supplier.method', selCtl(r, 'contact_method', [UNSET].concat(CONTACT_METHODS.map((m) => [m, 'contact.' + m])), { id: 'sup-m-' + r.id, after: upd })),
        field('supplier.details', textCtl(r, 'contact_details', { id: 'sup-c-' + r.id, max: 500, dir: 'ltr', after: upd })),
        field('supplier.message', textCtl(r, 'supplier_message', { id: 'sup-s-' + r.id, rows: 3, max: 5000, after: upd })));
    }
  });
}

/* --- 7. Commercial risks --- */
function buildRisks(b, f) {
  b.append(field('form.commercialRisks', textCtl(f.values, 'commercial_risks', { rows: 6, max: 20000 })));
}

/* --- 8. Research checklist & next step --- */
function buildChecklist(b, f) {
  const ro = readOnly(f), box = el('div', 'checks');
  const add = el('button', 'btn btn-secondary btn-sm', '＋ ' + t('check.add')); add.type = 'button';
  const draw = () => {
    box.replaceChildren();
    const items = P.checklistItems.filter((it) => it.is_active || f.checklist.some((c) => c.item_id === it.id));
    if (!items.length) box.append(el('p', 'hint', t('check.none')));
    items.forEach((it) => {
      const entry = f.checklist.find((c) => c.item_id === it.id);
      const lab = el('label', 'check'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!(entry && entry.is_checked); cb.disabled = ro;
      cb.addEventListener('change', () => {
        let e = f.checklist.find((c) => c.item_id === it.id);
        if (!e) { e = { id: uuid(), persisted: false, item_id: it.id, custom_label: '', is_checked: false }; f.checklist.push(e); }
        e.is_checked = cb.checked; markDirty();
      });
      lab.append(cb, el('span', null, locName(it, 'label_')));
      box.append(lab);
    });
    f.checklist.filter((c) => !c.item_id).forEach((c) => {
      const row = el('div', 'check check-custom'), cb = el('input'); cb.type = 'checkbox'; cb.checked = !!c.is_checked; cb.disabled = ro;
      cb.setAttribute('aria-label', t('check.custom'));
      cb.addEventListener('change', () => { c.is_checked = cb.checked; markDirty(); });
      const txt = textCtl(c, 'custom_label', { id: 'chk-' + c.id, max: 300 });
      txt.placeholder = t('check.custom');
      const rm = el('button', 'btn btn-ghost btn-sm', t('common.remove')); rm.type = 'button'; rm.disabled = ro;
      rm.addEventListener('click', () => {
        f.checklist.splice(f.checklist.indexOf(c), 1);
        if (c.persisted) f.removed.product_checklist_items.push(c.id);
        draw(); markDirty();
      });
      row.append(cb, txt, rm); box.append(row);
    });
    add.disabled = ro || f.checklist.length >= LIMITS.checklist;
  };
  add.addEventListener('click', () => {
    f.checklist.push({ id: uuid(), persisted: false, item_id: null, custom_label: '', is_checked: false });
    draw(); markDirty();
    const inputs = box.querySelectorAll('.check-custom input[type="text"]'); if (inputs.length) inputs[inputs.length - 1].focus();
  });
  b.append(el('p', 'label-like', t('form.checklist')), box, add,
    field('form.nextStep', textCtl(f.values, 'next_research_step', { rows: 3, max: 20000 })),
    field('form.notes', textCtl(f.values, 'notes', { rows: 3, max: 20000 })));
  draw();
}

/* =====================================================================
   Phase 6 — Contributor "Added Products": the contributor's own products
   Server-side search + status filter, keyset pagination (20 + 1 extra row),
   batched signed thumbnails. Opening a product reuses the Phase 5 route/form.
   ===================================================================== */
const LIST_PAGE = 20;
const LIST_SEARCH_MS = 300;
const LIST_STATUSES = ['draft', 'pending', 'accepted', 'rejected', 'successful'];
const LIST_COLS = 'id, status, name_ar, name_fr, name_en, other_names, created_at, updated_at, product_images(storage_path, position)';
const DATE_LOCALE = { ar: 'ar-u-nu-latn', fr: 'fr-FR', en: 'en-GB' };   // Arabic month names, Western digits (as in the form)

const L = {   // list state; rows are kept in memory only while the page is open
  active: false, status: '', q: '', term: '', rows: [], hasMore: false, loading: false,
  error: null, sig: null, seq: 0, timer: null, thumbs: {}, els: {}
};
const dateFmt = {};
function fmtDate(iso, withTime) {
  const key = state.lang + (withTime ? 't' : 'd');
  if (!dateFmt[key]) {
    dateFmt[key] = new Intl.DateTimeFormat(DATE_LOCALE[state.lang],
      withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : dateFmt[key].format(d);
}
function firstImagePath(r) {
  const imgs = (r.product_images || []).slice().sort((a, b) => a.position - b.position);
  return imgs.length ? imgs[0].storage_path : null;
}
const isOwnerEditable = (status) => status === 'draft' || status === 'pending';   // mirrors product_statuses.owner_can_edit

/* ===== Data ===== */
async function loadList(reset) {
  if (!L.active) return;
  const seq = ++L.seq;
  if (reset) {
    L.term = normalizeName(L.q).slice(0, 100);   // same normalisation as products.search_text
    L.rows = []; L.hasMore = false; L.thumbs = {};
    if (L.els.grid) L.els.grid.replaceChildren();
  }
  L.loading = true; L.error = null;
  paintListState();
  try {
    let q = sb.from('products').select(LIST_COLS)
      .eq('created_by', state.profile.id)                      // RLS already limits rows; this lets the planner use the owner index
      .order('position', { ascending: true, referencedTable: 'product_images', foreignTable: 'product_images' })
      .limit(1, { referencedTable: 'product_images', foreignTable: 'product_images' });
    if (L.status) q = q.eq('status', L.status);
    if (L.term) q = q.ilike('search_text', '%' + L.term.replace(/[\\%_]/g, '\\$&') + '%');   // trigram-indexed column
    const last = reset ? null : L.rows[L.rows.length - 1];
    if (last) {   // keyset: stable even if rows change while paging
      q = q.or('updated_at.lt.' + last.updated_at + ',and(updated_at.eq.' + last.updated_at + ',id.lt.' + last.id + ')');
    }
    const { data, error } = await q.order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(LIST_PAGE + 1);
    if (error) throw error;
    if (seq !== L.seq || !L.active) return;                    // a newer search/filter started: drop this answer

    const more = data.length > LIST_PAGE;                      // the extra row tells us whether another page exists
    const page = data.slice(0, LIST_PAGE);
    const paths = page.map(firstImagePath).filter(Boolean);
    let urls = {};
    try { urls = await signUrls(paths); } catch (e) { /* thumbnails are optional: placeholders are shown */ }
    if (seq !== L.seq || !L.active) return;

    Object.assign(L.thumbs, urls);
    const known = new Set(L.rows.map((r) => r.id));
    const fresh = page.filter((r) => !known.has(r.id));
    L.rows = L.rows.concat(fresh); L.hasMore = more; L.loading = false;
    appendCards(fresh);
    paintListState();
  } catch (e) {
    if (seq !== L.seq || !L.active) return;
    L.loading = false; L.error = authErrorKey(e);
    paintListState();
  }
}
function applyFilters() {
  const term = normalizeName(L.q).slice(0, 100);
  if (term === L.term && !L.error) return;
  loadList(true);
}
function setListStatus(s) {
  if (s === L.status) return;
  L.status = s;
  L.els.chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.status === s)));
  L.els.chips.forEach((c) => c.classList.toggle('on', c.dataset.status === s));
  clearTimeout(L.timer);
  loadList(true);
}

/* ===== Lifecycle (called from renderModule) ===== */
function enterList() { L.active = true; renderList(); loadList(true); }
function leaveList() {
  L.active = false; L.seq++; clearTimeout(L.timer);
  L.rows = []; L.hasMore = false; L.loading = false; L.error = null; L.thumbs = {}; L.els = {}; L.sig = null;
}
function resetList() { leaveList(); L.q = ''; L.term = ''; L.status = ''; }   // logout: nothing carries over to the next user

/* ===== UI ===== */
function listPlaceholder() {
  const d = el('div', 'pthumb-ph'); d.setAttribute('aria-hidden', 'true');
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const shapes = [['rect', { x: 3, y: 4, width: 18, height: 16, rx: 2.5 }], ['circle', { cx: 9, cy: 10, r: 1.6 }],
    ['path', { d: 'M4 18l5-5 4 4 3-3 4 4' }]];
  shapes.forEach(([tag, attrs]) => {
    const n = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach((k) => n.setAttribute(k, String(attrs[k])));
    svg.append(n);
  });
  d.append(svg);
  return d;
}
function buildCard(r) {
  const editable = isOwnerEditable(r.status);
  const a = el('a', 'pcard'); a.href = '#/contributor/add/' + r.id;   // existing route + Phase 5 form (read-only when not editable)
  const thumb = el('div', 'pthumb');
  const path = firstImagePath(r), url = path && L.thumbs[path];
  if (url) {
    const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = url;
    img.addEventListener('error', () => thumb.replaceChildren(listPlaceholder()));
    thumb.append(img);
  } else thumb.append(listPlaceholder());
  const body = el('div', 'pbody');
  const title = locName(r, 'name_') || (r.other_names && r.other_names[0]) || t('drafts.untitled');
  const head = el('div', 'phead');
  head.append(el('h3', 'ptitle', title), el('span', 'badge badge-' + r.status, t('status.' + r.status)));
  const meta = el('p', 'pmeta');
  meta.append(el('span', null, t('plist.created', { date: fmtDate(r.created_at, false) })),
    el('span', null, t('plist.updated', { date: fmtDate(r.updated_at, true) })));
  body.append(head, el('p', 'phint', t('plist.hint.' + r.status)), meta,
    el('span', 'pact' + (editable ? ' pact-edit' : ''), t(editable ? 'plist.continue' : 'plist.view')));
  a.append(thumb, body);
  return a;
}
function appendCards(rows) {
  if (!L.els.grid) return;
  const frag = document.createDocumentFragment();
  rows.forEach((r) => frag.append(buildCard(r)));
  L.els.grid.append(frag);
}
function listStateBox(icon, titleKey, bodyKey, action) {
  const b = el('div', 'pstate');
  b.append(el('div', 'pstate-ic', icon), el('h3', null, t(titleKey)));
  if (bodyKey) b.append(el('p', 'hint', t(bodyKey)));
  if (action) b.append(action);
  return b;
}
function paintListState() {
  const E = L.els;
  if (!E.grid) return;
  E.state.replaceChildren(); E.more.replaceChildren();
  E.grid.setAttribute('aria-busy', String(L.loading));
  E.summary.textContent = L.rows.length ? t(L.hasMore ? 'plist.shownMore' : 'plist.shown', { n: L.rows.length }) : '';
  const filtered = !!(L.status || L.term);
  if (L.loading && !L.rows.length) {
    for (let i = 0; i < 4; i++) {
      const sk = el('div', 'pcard pcard-sk');
      sk.append(el('div', 'pthumb skeleton'));
      const b = el('div', 'pbody'); b.append(el('div', 'skeleton sk-title'), el('div', 'skeleton sk-line'), el('div', 'skeleton sk-line short'));
      sk.append(b); E.state.append(sk);
    }
    E.state.classList.add('plist-grid'); return;
  }
  E.state.classList.remove('plist-grid');
  if (L.error && !L.rows.length) {
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => loadList(true));
    const box = listStateBox('!', 'plist.errorTitle', null, null);
    box.append(el('p', 'error', t(L.error)), retry);
    E.state.append(box); return;
  }
  if (!L.rows.length) {
    if (filtered) {
      const clear = el('button', 'btn btn-secondary', t('plist.clearFilters')); clear.type = 'button';
      clear.addEventListener('click', clearListFilters);
      E.state.append(listStateBox('⌕', 'plist.noResultsTitle', 'plist.noResultsBody', clear));
    } else {
      const go = el('a', 'btn btn-primary', t('plist.emptyCta')); go.href = '#/contributor/add';
      E.state.append(listStateBox('▤', 'plist.emptyTitle', 'plist.emptyBody', go));
    }
    return;
  }
  if (L.error) {   // load-more failure: keep what is shown, offer a retry
    E.more.append(el('p', 'error', t(L.error)));
    const retry = el('button', 'btn btn-secondary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => loadList(false));
    E.more.append(retry);
  } else if (L.hasMore) {
    const more = el('button', 'btn btn-secondary', t(L.loading ? 'plist.loading' : 'plist.loadMore')); more.type = 'button';
    more.disabled = L.loading;
    more.addEventListener('click', () => loadList(false));
    E.more.append(more);
  }
}
function clearListFilters() {
  L.q = ''; L.status = '';
  if (L.els.input) L.els.input.value = '';
  if (L.els.clear) L.els.clear.hidden = true;
  L.els.chips.forEach((c) => { c.setAttribute('aria-pressed', String(c.dataset.status === '')); c.classList.toggle('on', c.dataset.status === ''); });
  clearTimeout(L.timer);
  loadList(true);
}
/* Builds the page from state (also used after a language switch: no refetch) */
function renderList() {
  const body = $('module-body');
  L.sig = state.lang;
  body.replaceChildren();
  const wrap = el('div', 'plist');
  const tools = el('div', 'plist-tools');

  const sw = el('div', 'psearch');
  const inp = el('input'); inp.type = 'search'; inp.id = 'plist-q'; inp.maxLength = 100; inp.value = L.q;
  inp.placeholder = t('plist.search'); inp.autocomplete = 'off'; inp.setAttribute('aria-label', t('plist.search'));
  const clear = el('button', 'psearch-x', '×'); clear.type = 'button'; clear.hidden = !L.q;
  clear.setAttribute('aria-label', t('plist.clear')); clear.title = t('plist.clear');
  inp.addEventListener('input', () => {
    L.q = inp.value; clear.hidden = !inp.value;
    clearTimeout(L.timer); L.timer = setTimeout(applyFilters, LIST_SEARCH_MS);   // debounce; stale answers are dropped by L.seq
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(L.timer); applyFilters(); } });
  clear.addEventListener('click', () => { inp.value = ''; L.q = ''; clear.hidden = true; clearTimeout(L.timer); applyFilters(); inp.focus(); });
  sw.append(inp, clear);

  const chipBox = el('div', 'chips plist-chips'); chipBox.setAttribute('role', 'group'); chipBox.setAttribute('aria-label', t('plist.filterLabel'));
  const chips = [''].concat(LIST_STATUSES).map((s) => {
    const c = el('button', 'chip' + (s === L.status ? ' on' : ''), t(s ? 'status.' + s : 'plist.all')); c.type = 'button';
    c.dataset.status = s; c.setAttribute('aria-pressed', String(s === L.status));
    c.addEventListener('click', () => setListStatus(s));
    chipBox.append(c); return c;
  });
  tools.append(sw, chipBox);

  const summary = el('p', 'hint plist-summary'); summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', 'plist-grid'), stateBox = el('div', 'plist-state'), more = el('div', 'plist-more');
  wrap.append(tools, summary, grid, stateBox, more);
  body.append(wrap);
  L.els = { input: inp, clear, chips, summary, grid, state: stateBox, more };
  appendCards(L.rows);
  paintListState();
}

/* =====================================================================
   Phase 7 — Admin "Products" & review workflow
   List: server-side search/filter, keyset paging (20 + 1), batched thumbnails.
   Review view: read-only content in the 8 sections, history, activity.
   EVERY status change goes through the RPC change_product_status();
   the buttons and the "reason required" flag come from product_status_transitions.
   ===================================================================== */
const ADMIN_STATUSES = ['pending', 'accepted', 'rejected', 'successful'];   // drafts are never visible to admins
const ADMIN_COLS = 'id, status, name_ar, name_fr, name_en, other_names, created_at, submitted_at, updated_at, ' +
  'contributor:profiles!created_by(full_name), product_images(storage_path, position)';
const TRANSITION_UI = {   // label + style per transition; WHICH transitions exist comes from the database
  'pending>accepted': { key: 'rv.accept', tone: 'primary' },
  'pending>rejected': { key: 'rv.reject', tone: 'danger' },
  'accepted>successful': { key: 'rv.markSuccessful', tone: 'primary' },
  'accepted>pending': { key: 'rv.returnPending', tone: 'secondary' },
  'rejected>pending': { key: 'rv.returnPending', tone: 'secondary' }
};
const ACTIVITY_CODES = ['product_created', 'product_submitted', 'product_viewed', 'product_edited', 'product_accepted',
  'product_rejected', 'product_re_reviewed', 'product_marked_successful', 'supplier_added', 'supplier_edited',
  'supplier_removed', 'product_trashed', 'product_restored'];

const A = {   // admin list state
  active: false, status: 'pending', q: '', term: '', rows: [], hasMore: false, loading: false,
  error: null, sig: null, seq: 0, timer: null, thumbs: {}, els: {}
};
const R = {   // admin review state
  active: false, id: null, seq: 0, sig: null, data: null, busy: false, viewed: false, activity: null
};
const TR = { rows: null };   // admin transitions, loaded once per session

/* ===== Data: transitions, list ===== */
async function loadTransitions() {
  if (TR.rows) return TR.rows;
  const r = await sb.from('product_status_transitions').select('from_status, to_status, requires_reason').eq('actor', 'admin');
  if (r.error) throw r.error;
  TR.rows = r.data || [];
  return TR.rows;
}
async function loadAdminList(reset) {
  if (!A.active) return;
  const seq = ++A.seq;
  if (reset) {
    A.term = normalizeName(A.q).slice(0, 100);
    A.rows = []; A.hasMore = false; A.thumbs = {};
    if (A.els.grid) A.els.grid.replaceChildren();
  }
  A.loading = true; A.error = null;
  paintAdminList();
  try {
    let q = sb.from('products').select(ADMIN_COLS)
      .is('deleted_at', null)                                   // trashed products belong to the Recycle Bin, not to this list
      .order('position', { ascending: true, referencedTable: 'product_images', foreignTable: 'product_images' })
      .limit(1, { referencedTable: 'product_images', foreignTable: 'product_images' });
    q = A.status ? q.eq('status', A.status) : q.in('status', ADMIN_STATUSES);
    if (A.term) q = q.ilike('search_text', '%' + A.term.replace(/[\\%_]/g, '\\$&') + '%');
    const last = reset ? null : A.rows[A.rows.length - 1];
    if (last) q = q.or('updated_at.lt.' + last.updated_at + ',and(updated_at.eq.' + last.updated_at + ',id.lt.' + last.id + ')');
    const { data, error } = await q.order('updated_at', { ascending: false }).order('id', { ascending: false }).limit(LIST_PAGE + 1);
    if (error) throw error;
    if (seq !== A.seq || !A.active) return;                     // stale answer

    const more = data.length > LIST_PAGE;
    const page = data.slice(0, LIST_PAGE);
    let urls = {};
    try { urls = await signUrls(page.map(firstImagePath).filter(Boolean)); } catch (e) { /* placeholders */ }
    if (seq !== A.seq || !A.active) return;

    Object.assign(A.thumbs, urls);
    const known = new Set(A.rows.map((r) => r.id));
    const fresh = page.filter((r) => !known.has(r.id));
    A.rows = A.rows.concat(fresh); A.hasMore = more; A.loading = false;
    appendAdminCards(fresh);
    paintAdminList();
  } catch (e) {
    if (seq !== A.seq || !A.active) return;
    A.loading = false; A.error = authErrorKey(e);
    paintAdminList();
  }
}
function applyAdminFilters() {
  const term = normalizeName(A.q).slice(0, 100);
  if (term === A.term && !A.error) return;
  loadAdminList(true);
}
function setAdminStatus(s) {
  if (s === A.status) return;
  A.status = s;
  syncAdminChips();
  clearTimeout(A.timer);
  loadAdminList(true);
}
function syncAdminChips() {
  (A.els.chips || []).forEach((c) => { const on = c.dataset.status === A.status; c.setAttribute('aria-pressed', String(on)); c.classList.toggle('on', on); });
}
function enterAdminList() { A.active = true; renderAdminList(); loadAdminList(true); }
function leaveAdminList() {
  A.active = false; A.seq++; clearTimeout(A.timer);
  A.rows = []; A.hasMore = false; A.loading = false; A.error = null; A.thumbs = {}; A.els = {}; A.sig = null;
}
function leaveReview() { R.active = false; R.seq++; R.id = null; R.data = null; R.sig = null; R.activity = null; R.busy = false; }
function resetAdmin() {   // logout: nothing carries over to the next user
  leaveAdminList(); leaveReview();
  A.q = ''; A.term = ''; A.status = 'pending'; TR.rows = null;
}

/* ===== List UI ===== */
function buildAdminCard(r) {
  const a = el('a', 'pcard'); a.href = '#/admin/products/' + r.id;
  const thumb = el('div', 'pthumb');
  const path = firstImagePath(r), url = path && A.thumbs[path];
  if (url) {
    const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = url;
    img.addEventListener('error', () => thumb.replaceChildren(listPlaceholder()));
    thumb.append(img);
  } else thumb.append(listPlaceholder());
  const body = el('div', 'pbody');
  const title = locName(r, 'name_') || (r.other_names && r.other_names[0]) || t('drafts.untitled');
  const head = el('div', 'phead');
  head.append(el('h3', 'ptitle', title), el('span', 'badge badge-' + r.status, t('status.' + r.status)));
  const who = (r.contributor && r.contributor.full_name) || t('alist.unknown');
  const meta = el('p', 'pmeta');
  if (r.submitted_at) meta.append(el('span', null, t('alist.submitted', { date: fmtDate(r.submitted_at, false) })));
  meta.append(el('span', null, t('plist.updated', { date: fmtDate(r.updated_at, true) })));
  const pending = r.status === 'pending';
  body.append(head, el('p', 'phint', t('alist.hint.' + r.status)), el('p', 'pby', t('alist.by', { name: who })), meta,
    el('span', 'pact' + (pending ? ' pact-edit' : ''), t(pending ? 'alist.review' : 'alist.open')));
  a.append(thumb, body);
  return a;
}
function appendAdminCards(rows) {
  if (!A.els.grid) return;
  const frag = document.createDocumentFragment();
  rows.forEach((r) => frag.append(buildAdminCard(r)));
  A.els.grid.append(frag);
}
function paintAdminList() {
  const E = A.els;
  if (!E.grid) return;
  E.state.replaceChildren(); E.more.replaceChildren();
  E.grid.setAttribute('aria-busy', String(A.loading));
  E.summary.textContent = A.rows.length ? t(A.hasMore ? 'plist.shownMore' : 'plist.shown', { n: A.rows.length }) : '';
  if (A.loading && !A.rows.length) {
    for (let i = 0; i < 4; i++) {
      const sk = el('div', 'pcard pcard-sk');
      sk.append(el('div', 'pthumb skeleton'));
      const b = el('div', 'pbody'); b.append(el('div', 'skeleton sk-title'), el('div', 'skeleton sk-line'), el('div', 'skeleton sk-line short'));
      sk.append(b); E.state.append(sk);
    }
    E.state.classList.add('plist-grid'); return;
  }
  E.state.classList.remove('plist-grid');
  if (A.error && !A.rows.length) {
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => loadAdminList(true));
    const box = listStateBox('!', 'plist.errorTitle', null, null);
    box.append(el('p', 'error', t(A.error)), retry);
    E.state.append(box); return;
  }
  if (!A.rows.length) {
    const act = (key, fn) => { const b = el('button', 'btn btn-secondary', t(key)); b.type = 'button'; b.addEventListener('click', fn); return b; };
    if (A.status === 'pending' && !A.term) {
      E.state.append(listStateBox('✓', 'alist.queueEmptyTitle', 'alist.queueEmptyBody', act('alist.showAll', () => { A.status = ''; syncAdminChips(); loadAdminList(true); })));
    } else if (A.status || A.term) {
      E.state.append(listStateBox('⌕', 'plist.noResultsTitle', 'plist.noResultsBody', act('plist.clearFilters', clearAdminFilters)));
    } else {
      E.state.append(listStateBox('▤', 'alist.noneTitle', 'alist.noneBody', null));
    }
    return;
  }
  if (A.error) {
    E.more.append(el('p', 'error', t(A.error)));
    const retry = el('button', 'btn btn-secondary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => loadAdminList(false));
    E.more.append(retry);
  } else if (A.hasMore) {
    const more = el('button', 'btn btn-secondary', t(A.loading ? 'plist.loading' : 'plist.loadMore')); more.type = 'button';
    more.disabled = A.loading;
    more.addEventListener('click', () => loadAdminList(false));
    E.more.append(more);
  }
}
function clearAdminFilters() {
  A.q = ''; A.status = '';
  if (A.els.input) A.els.input.value = '';
  if (A.els.clear) A.els.clear.hidden = true;
  syncAdminChips(); clearTimeout(A.timer);
  loadAdminList(true);
}
function renderAdminList() {
  const body = $('module-body');
  A.sig = state.lang;
  body.replaceChildren();
  const wrap = el('div', 'plist');
  const tools = el('div', 'plist-tools');
  const sw = el('div', 'psearch');
  const inp = el('input'); inp.type = 'search'; inp.id = 'alist-q'; inp.maxLength = 100; inp.value = A.q;
  inp.placeholder = t('plist.search'); inp.autocomplete = 'off'; inp.setAttribute('aria-label', t('plist.search'));
  const clear = el('button', 'psearch-x', '×'); clear.type = 'button'; clear.hidden = !A.q;
  clear.setAttribute('aria-label', t('plist.clear')); clear.title = t('plist.clear');
  inp.addEventListener('input', () => {
    A.q = inp.value; clear.hidden = !inp.value;
    clearTimeout(A.timer); A.timer = setTimeout(applyAdminFilters, LIST_SEARCH_MS);   // debounce; stale answers dropped by A.seq
  });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(A.timer); applyAdminFilters(); } });
  clear.addEventListener('click', () => { inp.value = ''; A.q = ''; clear.hidden = true; clearTimeout(A.timer); applyAdminFilters(); inp.focus(); });
  sw.append(inp, clear);

  const chipBox = el('div', 'chips plist-chips'); chipBox.setAttribute('role', 'group'); chipBox.setAttribute('aria-label', t('plist.filterLabel'));
  const chips = [''].concat(ADMIN_STATUSES).map((s) => {
    const c = el('button', 'chip' + (s === A.status ? ' on' : ''), t(s ? 'status.' + s : 'plist.all')); c.type = 'button';
    c.dataset.status = s; c.setAttribute('aria-pressed', String(s === A.status));
    c.addEventListener('click', () => setAdminStatus(s));
    chipBox.append(c); return c;
  });
  tools.append(sw, chipBox);
  const summary = el('p', 'hint plist-summary'); summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', 'plist-grid'), stateBox = el('div', 'plist-state'), more = el('div', 'plist-more');
  wrap.append(tools, summary, grid, stateBox, more);
  body.append(wrap);
  A.els = { input: inp, clear, chips, summary, grid, state: stateBox, more };
  appendAdminCards(A.rows);
  paintAdminList();
}

/* ===== Review view: data ===== */
function enterReview(id) {
  R.active = true; R.id = id; R.data = null; R.viewed = false; R.busy = false; R.activity = null; R.sig = null;
  $('module-body').replaceChildren(skeleton(6));
  loadReview();
}
async function loadReview() {
  const seq = ++R.seq, id = R.id;
  try {
    const d = await withLoading(async () => {
      const [f, hist, trans] = await Promise.all([
        (async () => { await loadLookups(); return loadProduct(id); })(),
        sb.from('product_status_history')
          .select('id, from_status, to_status, action, reason, changed_at, actor:profiles!changed_by(full_name)')
          .eq('product_id', id).order('changed_at', { ascending: false }).order('id', { ascending: false }),
        loadTransitions()
      ]);
      if (hist.error) throw hist.error;
      if (f.status === 'draft' || f.row.deleted_at) throw { code: 'PGRST116', message: 'product.not_found' };   // drafts / trash are not reviewable
      const pr = await sb.from('profiles').select('id, full_name, email, phone, is_active').eq('id', f.row.created_by).maybeSingle();
      return { f, history: hist.data || [], contributor: pr.error ? null : pr.data, transitions: trans };
    });
    if (seq !== R.seq || !R.active) return;
    R.data = d; R.activity = null;
    renderReview();
    window.scrollTo({ top: 0 });
    if (!R.viewed) {   // once per opening; the database keeps one log per admin and product
      R.viewed = true;
      sb.rpc('log_product_view', { p_product_id: id }).then(() => {}, () => {});
    }
  } catch (e) {
    if (seq !== R.seq || !R.active) return;
    const box = el('div', 'card center');
    box.append(el('p', 'error', t(authErrorKey(e))));
    const back = el('a', 'btn btn-secondary', t('rv.back')); back.href = '#/admin/products';
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => enterReview(id));
    box.append(back, retry);
    $('module-body').replaceChildren(box);
  }
}
function latestReason(history, status) {   // same rule as the contributor banner (reviewNote)
  return history.length ? reviewNote(status, history[0]) : null;
}
function rvActionsFor(d) {
  const order = Object.keys(TRANSITION_UI);
  return d.transitions
    .filter((x) => x.from_status === d.f.status && TRANSITION_UI[x.from_status + '>' + x.to_status])
    .map((x) => ({ to: x.to_status, needsReason: x.requires_reason || x.to_status === 'rejected',   // rejection always asks for a reason, even before the DB flag is set
      ui: TRANSITION_UI[x.from_status + '>' + x.to_status], idx: order.indexOf(x.from_status + '>' + x.to_status) }))
    .sort((a, b) => a.idx - b.idx);
}

/* ===== Review view: status change (RPC only) ===== */
function openStatusModal(a) {
  const d = R.data, id = d.f.id;
  openModal(a.ui.key, (body) => {
    body.append(el('p', null, t('rv.confirm.' + a.to)));
    let ta = null;
    if (a.needsReason) {
      const w = el('div', 'field');
      const l = el('label', null, t('rv.reason') + ' *'); l.htmlFor = 'rv-reason';
      ta = el('textarea'); ta.id = 'rv-reason'; ta.rows = 4; ta.maxLength = 2000; ta.dir = 'auto';
      w.append(l, ta, el('p', 'hint', t('rv.reasonHint')));
      body.append(w);
    }
    const err = el('p', 'error'); err.setAttribute('role', 'alert'); err.hidden = true;
    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn btn-ghost', t('common.cancel')); cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    const ok = el('button', 'btn ' + ({ primary: 'btn-primary', danger: 'btn-danger', secondary: 'btn-secondary' })[a.ui.tone], t(a.ui.key)); ok.type = 'button';
    ok.addEventListener('click', async () => {
      if (ok.disabled || R.busy) return;
      const reason = ta ? ta.value.trim() : '';
      if (a.needsReason && !reason) { err.textContent = t('err.reasonRequired'); err.hidden = false; ta.focus(); return; }
      ok.disabled = true; R.busy = true; err.hidden = true;
      const r = await withLoading(() => sb.rpc('change_product_status', { p_product_id: id, p_to_status: a.to, p_reason: reason || null }));
      R.busy = false;
      if (r.error) {   // the database is the authority: show its answer; refresh if the product changed meanwhile
        const key = authErrorKey(r.error);
        err.textContent = t(key); err.hidden = false; ok.disabled = false;
        if (key === 'err.transitionNotAllowed' || key === 'err.productNotFound') { closeModal(); toast('error', key); loadReview(); }
        return;
      }
      closeModal(); toast('success', 'rv.toast.' + a.to);
      loadReview();   // reload status, dates and history from the database
    });
    actions.append(cancel, ok);
    body.append(err, actions);
    (ta || cancel).focus();
  });
}
function rvButtons(d) {
  const frag = document.createDocumentFragment();
  const acts = rvActionsFor(d);
  acts.forEach((a) => {
    const b = el('button', 'btn ' + ({ primary: 'btn-primary', danger: 'btn-danger', secondary: 'btn-secondary' })[a.ui.tone], t(a.ui.key));
    b.type = 'button'; b.addEventListener('click', () => openStatusModal(a));
    frag.append(b);
  });
  if (!acts.length) frag.append(el('p', 'hint', t('rv.noActions')));
  return frag;
}

/* ===== Review view: UI ===== */
function rvField(labelKey, value, o = {}) {
  const w = el('div', 'rv-field'); w.append(el('dt', null, t(labelKey)));
  const dd = el('dd', o.pre ? 'rv-pre' : null);
  const v = value == null ? '' : String(value).trim();
  if (v && o.href) {   // only validated http(s) URLs are ever turned into links
    const link = el('a', 'rv-link', v); link.href = o.href; link.target = '_blank'; link.rel = 'noopener noreferrer nofollow';
    dd.append(link); if (o.dir) dd.dir = o.dir;
  } else if (v) { dd.textContent = v; if (o.dir) dd.dir = o.dir; else if (o.pre) dd.dir = 'auto'; }
  else { dd.textContent = '—'; dd.classList.add('rv-empty'); }
  w.append(dd);
  return w;
}
function rvList(fields) { const dl = el('dl', 'rv-fields'); fields.forEach((x) => dl.append(x)); return dl; }
function fmtNum(n) { return new Intl.NumberFormat(DATE_LOCALE[state.lang], { maximumFractionDigits: 2 }).format(n); }
function rvChips(items) {
  const box = el('div', 'chips');
  items.forEach((x) => box.append(el('span', 'tag tag-ro', x)));
  return box;
}
function openViewer(f, start) {
  let i = start;
  openModal('rv.imageTitle', (body) => {
    body.classList.add('rv-viewer');
    const stage = el('div', 'rv-stage'), cap = el('p', 'hint rv-cap');
    const nav = el('div', 'modal-actions');
    const prev = el('button', 'btn btn-secondary', t('rv.prev')); prev.type = 'button';
    const next = el('button', 'btn btn-secondary', t('rv.next')); next.type = 'button';
    const show = (k) => {
      i = (k + f.images.length) % f.images.length;
      stage.replaceChildren();
      const u = f.images[i].url;
      if (u) { const im = el('img'); im.alt = t('form.imageN', { n: i + 1 }); im.src = u; im.addEventListener('error', () => stage.replaceChildren(listPlaceholder())); stage.append(im); }
      else stage.append(listPlaceholder());
      cap.textContent = (i + 1) + ' / ' + f.images.length;
      prev.disabled = next.disabled = f.images.length < 2;
    };
    prev.addEventListener('click', () => show(i - 1)); next.addEventListener('click', () => show(i + 1));
    nav.append(prev, next);
    body.append(stage, cap, nav);
    show(i);
  });
}
function rvSection(i, key, build) {
  const d = el('details', 'fsec'); d.open = true; d.dataset.sec = key;
  const sm = el('summary');
  sm.append(el('span', 'fsec-n', String(i + 1)), el('span', null, t('sec.' + key)));
  const b = el('div', 'fsec-body'); build(b); d.append(sm, b);
  return d;
}
function rvGeneral(b, f) {
  const v = f.values;
  b.append(rvList([
    rvField('form.nameAr', v.name_ar, { dir: 'rtl' }), rvField('form.nameFr', v.name_fr, { dir: 'ltr' }), rvField('form.nameEn', v.name_en, { dir: 'ltr' })]));
  const on = el('div', 'rv-field'); on.append(el('dt', null, t('form.otherNames')));
  const dd = el('dd'); if (f.otherNames.length) dd.append(rvChips(f.otherNames)); else { dd.textContent = '—'; dd.className = 'rv-empty'; }
  on.append(dd);
  const nn = el('div', 'rv-field'); nn.append(el('dt', null, t('form.niches')));
  const nd = el('dd'), names = P.niches.filter((n) => f.nicheIds.has(n.id)).map((n) => locName(n, 'name_'));
  if (names.length) nd.append(rvChips(names)); else { nd.textContent = '—'; nd.className = 'rv-empty'; }
  nn.append(nd);
  const mm = el('div', 'rv-field'); mm.append(el('dt', null, t('form.micros')));
  const md = el('dd'), mnames = P.micros.filter((m) => f.microIds.has(m.id)).map((m) => locName(m, 'name_'));
  if (mnames.length) md.append(rvChips(mnames)); else { md.textContent = '—'; md.className = 'rv-empty'; }
  mm.append(md);
  const dl = el('dl', 'rv-fields'); dl.append(on, nn, mm, rvField('form.source', v.source ? t('source.' + v.source) : ''));
  b.append(dl);
  const gal = el('div', 'rv-field'); gal.append(el('dt', null, t('form.images') + ' (' + f.images.length + ')'));
  const g = el('dd', 'img-grid rv-gallery');
  if (!f.images.length) { g.className = 'rv-empty'; g.textContent = '—'; }
  f.images.forEach((im, i) => {
    const c = el('button', 'img-card rv-thumb' + (i === 0 ? ' main' : '')); c.type = 'button';
    c.setAttribute('aria-label', t('form.imageN', { n: i + 1 }));
    if (im.url) { const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.src = im.url; img.addEventListener('error', () => c.replaceChildren(listPlaceholder())); c.append(img); }
    else c.append(listPlaceholder());
    if (i === 0) c.append(el('span', 'img-main', t('img.main')));
    c.addEventListener('click', () => openViewer(f, i));
    g.append(c);
  });
  gal.append(g);
  const gdl = el('dl', 'rv-fields'); gdl.append(gal); b.append(gdl);
}
function rvAnalysis(b, f) {
  const v = f.values;
  b.append(rvList([rvField('form.description', v.description, { pre: true }), rvField('form.problemSolved', v.problem_solved, { pre: true }),
    rvField('form.potentialCustomers', v.potential_customers, { pre: true }), rvField('form.potentialUses', v.potential_uses, { pre: true }),
    rvField('form.strengths', v.strengths, { pre: true }), rvField('form.weaknesses', v.weaknesses, { pre: true }),
    rvField('form.pointsToVerify', v.points_to_verify, { pre: true })]));
}
function rvEvaluation(b, f) {
  const v = f.values, both = v.visual_value && v.actual_value;
  b.append(rvList([rvField('form.visualValue', v.visual_value), rvField('form.actualValue', v.actual_value),
    rvField('form.valueScore', both ? (Number(v.visual_value) + Number(v.actual_value)) + ' / 10' : ''),
    rvField('form.competition', v.competition ? t('comp.' + v.competition) : ''), rvField('form.testability', v.testability_notes, { pre: true })]));
}
function rvMarketing(b, f) {
  if (!f.angles.length) { b.append(el('p', 'rv-empty', '—')); return; }
  f.angles.forEach((a, i) => {
    const c = el('div', 'row-card');
    c.append(el('strong', null, t('angle.n', { n: i + 1 })), rvList([rvField('angle.name', a.name), rvField('angle.details', a.details, { pre: true })]));
    b.append(c);
  });
}
function rvCompetitor(b, f) {
  const v = f.values, a = parsePrice(v.price_from), z = parsePrice(v.price_to);
  const price = a !== null && z !== null && !Number.isNaN(a) && !Number.isNaN(z) ? fmtNum(a) + ' – ' + fmtNum(z) + ' ' + v.currency_code : '';
  b.append(rvList([rvField('rv.priceRange', price, { dir: 'ltr' }),
    rvField('form.salesMethod', v.competitor_sales_method ? t('sales.' + v.competitor_sales_method) : '')]));
}
function rvSuppliers(b, f) {
  if (!f.suppliers.length) { b.append(el('p', 'rv-empty', '—')); return; }
  f.suppliers.forEach((s, i) => {
    const c = el('div', 'row-card');
    c.append(el('strong', null, t('supplier.n', { n: i + 1 })));
    const dl = el('dl', 'rv-fields');
    dl.append(rvField('supplier.name', s.name), rvField('supplier.method', s.contact_method ? t('contact.' + s.contact_method) : ''));
    const url = s.contact_details && /^https?:\/\/\S+$/i.test(s.contact_details.trim()) ? s.contact_details.trim() : null;
    dl.append(rvField('supplier.details', s.contact_details, { dir: 'ltr', href: url }), rvField('supplier.message', s.supplier_message, { pre: true }));
    c.append(dl); b.append(c);
  });
}
function rvChecklist(b, f) {
  const box = el('ul', 'rv-checks');
  const items = P.checklistItems.filter((it) => it.is_active || f.checklist.some((c) => c.item_id === it.id));
  const add = (label, done) => {
    const li = el('li', done ? 'done' : '');
    const m = el('span', 'rv-mark', done ? '✓' : '○'); m.setAttribute('aria-label', t(done ? 'rv.done' : 'rv.todo'));
    li.append(m, el('span', null, label)); box.append(li);
  };
  items.forEach((it) => { const e = f.checklist.find((c) => c.item_id === it.id); add(locName(it, 'label_'), !!(e && e.is_checked)); });
  f.checklist.filter((c) => !c.item_id).forEach((c) => add(c.custom_label, !!c.is_checked));
  if (box.children.length) b.append(el('p', 'label-like', t('form.checklist')), box);
  b.append(rvList([rvField('form.nextStep', f.values.next_research_step, { pre: true }), rvField('form.notes', f.values.notes, { pre: true })]));
}
function rvHistoryCard(d) {
  const card = el('section', 'rv-card');
  card.append(el('h3', null, t('rv.history')));
  if (!d.history.length) { card.append(el('p', 'hint', t('rv.noHistory'))); return card; }
  const ol = el('ol', 'rv-timeline');
  d.history.forEach((h) => {
    const li = el('li');
    const top = el('div', 'rv-tl-top');
    top.append(el('strong', null, t('hist.' + h.action)), el('span', 'badge badge-' + h.to_status, t('status.' + h.to_status)));
    li.append(top);
    const who = h.actor && h.actor.full_name;
    li.append(el('p', 'hint', (who ? t('rv.by', { name: who }) + ' · ' : '') + fmtDate(h.changed_at, true)));
    if (h.reason) { const r = el('p', 'rv-reason rv-pre', h.reason); r.dir = 'auto'; li.append(r); }
    ol.append(li);
  });
  card.append(ol);
  return card;
}
function rvActivityCard(d) {
  const det = el('details', 'rv-card rv-activity');
  det.append(el('summary', null, t('rv.activity')));
  const list = el('div', 'rv-act-list'); det.append(list);
  const paint = () => {
    list.replaceChildren();
    if (!R.activity.length) { list.append(el('p', 'hint', t('rv.noActivity'))); return; }
    const ul = el('ul', 'rv-acts');
    R.activity.forEach((x) => {
      const li = el('li');
      li.append(el('span', null, ACTIVITY_CODES.includes(x.action) ? t('act.' + x.action) : x.action),
        el('span', 'hint', (x.user_name ? x.user_name + ' · ' : '') + fmtDate(x.created_at, true)));
      ul.append(li);
    });
    list.append(ul);
  };
  det.addEventListener('toggle', async () => {
    if (!det.open) return;
    if (R.activity) { paint(); return; }
    list.replaceChildren(skeleton(3));
    const id = R.id, seq = R.seq;
    const r = await sb.from('activity_logs').select('id, action, user_name, created_at')
      .eq('product_id', id).order('created_at', { ascending: false }).limit(30);
    if (seq !== R.seq) return;
    if (r.error) { list.replaceChildren(el('p', 'error', t(authErrorKey(r.error)))); return; }
    R.activity = r.data || []; paint();
  });
  if (R.activity) paint();
  return det;
}
function renderReview() {
  const d = R.data, f = d.f, row = f.row, st = f.status, body = $('module-body');
  R.sig = state.lang;
  body.replaceChildren();
  const root = el('div', 'rview');
  const back = el('a', 'rv-back', t('rv.back')); back.href = '#/admin/products';

  const title = locName(f.values, 'name_') || f.otherNames[0] || t('drafts.untitled');
  const head = el('div', 'rv-head');
  head.append(el('h2', null, title));
  const who = d.contributor && d.contributor.full_name;
  const sub = [];
  if (who) sub.push(t('alist.by', { name: who }));
  if (row.submitted_at) sub.push(t('alist.submitted', { date: fmtDate(row.submitted_at, false) }));
  head.append(el('p', 'hint', sub.join(' · ')));

  // status banner
  const dateKey = { accepted: 'accepted_at', rejected: 'rejected_at', successful: 'successful_at' }[st];
  const banner = el('div', 'rv-banner rv-banner-' + st);
  banner.append(el('span', 'badge badge-' + st, t('status.' + st)),
    el('strong', null, st === 'pending' ? t('rv.banner.pending') : t('rv.banner.' + st, { date: dateKey && row[dateKey] ? fmtDate(row[dateKey], true) : '' })));
  const note = latestReason(d.history, st);
  if (note) { const r = el('p', 'rv-reason rv-pre', note.reason || t('rv.note.noReason')); r.dir = 'auto'; banner.append(el('span', 'hint', t('rv.note.' + note.kind)), r); }
  banner.append(el('p', 'hint', t('rv.readonly')));

  // main: 8 sections (read-only)
  const main = el('div', 'rv-main');
  const builders = { general: rvGeneral, analysis: rvAnalysis, evaluation: rvEvaluation, marketing: rvMarketing,
    competitor: rvCompetitor, suppliers: rvSuppliers, risks: (b, ff) => b.append(rvList([rvField('form.commercialRisks', ff.values.commercial_risks, { pre: true })])),
    checklist: rvChecklist };
  SECTIONS.forEach((k, i) => main.append(rvSection(i, k, (b) => builders[k](b, f))));

  // aside: actions, contributor, dates, history, activity
  const aside = el('aside', 'rv-aside');
  const act = el('section', 'rv-card rv-actions-card');
  act.append(el('h3', null, t('rv.actions')), rvButtons(d));
  const con = el('section', 'rv-card');
  con.append(el('h3', null, t('rv.contributor')));
  if (d.contributor) {
    const c = d.contributor, line = el('div', 'rv-person');
    line.append(el('div', 'avatar', initials(c.full_name)));
    const info = el('div'); info.append(el('strong', null, c.full_name));
    info.append(el('p', 'hint', c.email));
    if (c.phone) { const p = el('p', 'hint', c.phone); p.dir = 'ltr'; info.append(p); }
    if (!c.is_active) info.append(el('p', 'row-hint', t('rv.disabled')));
    line.append(info); con.append(line);
  } else con.append(el('p', 'hint', t('alist.unknown')));
  const dates = el('section', 'rv-card');
  dates.append(el('h3', null, t('rv.dates')));
  const dl = el('dl', 'rv-fields rv-dates');
  [['rv.created', row.created_at], ['rv.submitted', row.submitted_at], ['rv.updated', row.updated_at],
   ['rv.accepted', row.accepted_at], ['rv.rejected', row.rejected_at], ['rv.successful', row.successful_at]]
    .forEach(([k, v]) => { if (v) dl.append(rvField(k, fmtDate(v, true))); });
  dates.append(dl);
  aside.append(act, con, dates, rvHistoryCard(d), rvActivityCard(d));

  const layout = el('div', 'rv-layout'); layout.append(main, aside);
  const bar = el('div', 'rv-actionbar'); bar.append(rvButtons(d));
  root.append(back, head, banner, layout, bar);
  body.append(root);
}

/* =====================================================================
   Phase 8 — Admin notifications (in-app only: bell, badge, panel)
   Data: RPC get_due_notifications() / notification_action(id, 'view'|'snooze'|'dismiss').
   Live: one Realtime channel on the admin's own notification rows.
   Timer: exactly one setTimeout, for the next snooze due time (taken from the database).
   No database change; no browser notifications, sounds or permission prompts.
   ===================================================================== */
const NOTIF_MIN_DELAY = 5000;   // floor for the due timer (protects against client/server clock skew)
const NOTIF = {
  active: false, userId: null,
  gen: 0,          // bumped on start/stop: late responses from a previous session are ignored
  seq: 0,          // bumped on every local action: responses requested before it are stale
  rows: [], loaded: false, error: false, inflight: false, dirty: false, lastLoad: 0,
  nextDue: null,   // ms timestamp of the earliest snoozed reminder (from the database)
  timer: null, channel: null, subscribed: false,
  busy: new Set(), ver: 0, sig: null
};
const notifRtf = {};

function startNotifications() {
  const p = state.profile;
  if (!p || p.role !== 'admin') return;
  if (NOTIF.active && NOTIF.userId === p.id) return;   // never subscribe twice
  stopNotifications();
  NOTIF.active = true; NOTIF.userId = p.id;
  subscribeNotifications(p.id);
  notifChanged();
  loadNotifications();
}

function stopNotifications() {   // logout / session end: nothing carries over to the next user
  clearTimeout(NOTIF.timer); NOTIF.timer = null;
  if (NOTIF.channel) {
    const ch = NOTIF.channel; NOTIF.channel = null;
    try { Promise.resolve(sb.removeChannel(ch)).catch(() => {}); } catch (e) { /* ignore */ }
  }
  NOTIF.gen++; NOTIF.seq++;
  Object.assign(NOTIF, { active: false, userId: null, rows: [], loaded: false, error: false, inflight: false,
    dirty: false, lastLoad: 0, nextDue: null, subscribed: false, sig: null });
  NOTIF.busy.clear();
  closeNotifPanel(false);
  renderNotifUI();
}

function subscribeNotifications(uid) {
  NOTIF.subscribed = false;
  NOTIF.channel = sb.channel('admin-notifications-' + uid)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: 'recipient_id=eq.' + uid },
      () => { if (NOTIF.active && NOTIF.userId === uid) loadNotifications(); })
    .subscribe((status) => {
      if (status !== 'SUBSCRIBED' || !NOTIF.active || NOTIF.userId !== uid) return;
      if (NOTIF.subscribed) loadNotifications();   // re-subscribed after a dropped connection: catch up
      NOTIF.subscribed = true;
    });
}

/* Loads the due list (+ the earliest pending reminder). Concurrent calls are coalesced into one follow-up load. */
async function loadNotifications() {
  if (!NOTIF.active) return;
  if (NOTIF.inflight) { NOTIF.dirty = true; return; }
  NOTIF.inflight = true; NOTIF.dirty = false; NOTIF.lastLoad = Date.now();
  const gen = NOTIF.gen, seq = NOTIF.seq;
  let due, snoozed;
  try {
    [due, snoozed] = await Promise.all([
      sb.rpc('get_due_notifications'),
      sb.from('notifications').select('id, remind_at').eq('state', 'snoozed').order('remind_at', { ascending: true }).limit(100)
    ]);
  } catch (e) { due = { error: e }; snoozed = { error: e }; }
  if (gen !== NOTIF.gen) return;   // signed out (or another admin signed in) while waiting
  NOTIF.inflight = false;
  if (seq === NOTIF.seq) {         // otherwise a local action happened meanwhile: this answer may be stale
    if (due.error) {
      NOTIF.error = true;
      if (NOTIF.nextDue != null && NOTIF.nextDue <= Date.now()) NOTIF.nextDue = Date.now() + 30000;   // retry later
    } else {
      NOTIF.error = false; NOTIF.loaded = true;
      NOTIF.rows = (due.data || []).slice().sort((x, y) => new Date(y.created_at) - new Date(x.created_at));   // newest first
      if (!snoozed.error) {
        const dueIds = new Set(NOTIF.rows.map((r) => r.id));
        const next = (snoozed.data || []).find((r) => r.remind_at && !dueIds.has(r.id));
        NOTIF.nextDue = next ? Date.parse(next.remind_at) : null;
      }
    }
    scheduleNotifTimer();
    notifChanged();
  }
  if (NOTIF.dirty) loadNotifications();
}

function scheduleNotifTimer() {   // the one and only timer
  clearTimeout(NOTIF.timer); NOTIF.timer = null;
  if (!NOTIF.active || NOTIF.nextDue == null || Number.isNaN(NOTIF.nextDue)) return;
  const delay = Math.min(Math.max(NOTIF.nextDue - Date.now(), NOTIF_MIN_DELAY), 2147483647);
  NOTIF.timer = setTimeout(() => { NOTIF.timer = null; loadNotifications(); }, delay);
}

function refreshNotifOnFocus() {   // tab / window regains focus
  if (NOTIF.active && Date.now() - NOTIF.lastLoad > 1000) loadNotifications();
}

/* ===== Actions ===== */
async function notifAct(n, action) {
  if (NOTIF.busy.has(n.id)) return;
  const gen = NOTIF.gen;
  NOTIF.busy.add(n.id); notifChanged();
  let data = null, err = null;
  try {
    const r = await withLoading(() => sb.rpc('notification_action', { p_notification_id: n.id, p_action: action }));
    data = r.data; err = r.error;
  } catch (e) { err = e; }
  if (gen !== NOTIF.gen) return;   // signed out meanwhile
  NOTIF.busy.delete(n.id);

  if (action === 'view') {   // viewing only marks the notification as viewed: it keeps reminding until the product is reviewed
    closeNotifPanel(false);
    notifChanged();
    if (err) loadNotifications();   // bookkeeping failed: navigate anyway, re-sync the list
    location.hash = '#/admin/products/' + n.product_id;
    return;
  }
  NOTIF.seq++;   // anything requested before this action is now stale
  if (NOTIF.inflight) NOTIF.dirty = true;
  if (err) {   // e.g. already resolved by the other admin: tell the user and re-sync
    toast('error', authErrorKey(err));
    notifChanged();
    loadNotifications();
    return;
  }
  NOTIF.rows = NOTIF.rows.filter((r) => r.id !== n.id);
  if (action === 'snooze' && data && data.remind_at) {   // reschedule from the RPC response
    const at = Date.parse(data.remind_at);
    if (!Number.isNaN(at)) { NOTIF.nextDue = NOTIF.nextDue == null ? at : Math.min(NOTIF.nextDue, at); scheduleNotifTimer(); }
  }
  notifChanged();
  if (!$('notif-panel').hidden) ($('notif-body').querySelector('button:not(:disabled)') || $('notif-close')).focus();   // the removed item took focus with it
}

function retryNotifications() {
  NOTIF.error = false; NOTIF.loaded = false;
  notifChanged();
  loadNotifications();
}

/* ===== Panel / bell UI ===== */
function openNotifPanel() {
  if (!NOTIF.active) return;
  closeProfileCard(false);
  $('notif-panel').hidden = false;
  $('bell-btn').setAttribute('aria-expanded', 'true');
  if (NOTIF.error) { NOTIF.error = false; NOTIF.loaded = false; }
  notifChanged();   // renders the panel
  loadNotifications();   // refresh whenever the panel opens
  $('notif-close').focus();
}
function closeNotifPanel(returnFocus) {
  if ($('notif-panel').hidden) return;
  $('notif-panel').hidden = true;
  $('bell-btn').setAttribute('aria-expanded', 'false');
  if (returnFocus) $('bell-btn').focus();
}

function notifChanged() { NOTIF.ver++; renderNotifUI(); }

function renderNotifUI() {
  const bell = $('bell-btn');
  const show = !!state.profile && state.profile.role === 'admin' && NOTIF.active;
  bell.hidden = !show;
  if (!show) { closeNotifPanel(false); $('bell-badge').hidden = true; return; }
  const n = NOTIF.rows.length;
  const badge = $('bell-badge');
  badge.hidden = n === 0;
  badge.textContent = n > 9 ? fmtNum(9) + '+' : fmtNum(n);
  bell.setAttribute('aria-label', n ? t('notif.bellCount', { n: fmtNum(n) }) : t('notif.bell'));
  bell.title = t('notif.bell');
  if (!$('notif-panel').hidden && NOTIF.sig !== state.lang + '|' + NOTIF.ver) renderNotifPanel();   // only when something changed
}

function relTime(iso) {   // "5 minutes ago" in the current language
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const rtf = notifRtf[state.lang] || (notifRtf[state.lang] = new Intl.RelativeTimeFormat(DATE_LOCALE[state.lang], { numeric: 'auto' }));
  const s = Math.round((d.getTime() - Date.now()) / 1000), a = Math.abs(s);   // negative = past
  if (s > -45) return rtf.format(0, 'second');   // also covers small client/server clock differences
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 30 * 86400) return rtf.format(Math.round(s / 86400), 'day');
  return fmtDate(iso, false);
}

function buildNotifItem(n) {
  const name = (n.payload && n.payload.product_name) || t('drafts.untitled');
  const who = (n.payload && n.payload.actor_name) || t('notif.unknownUser');
  const busy = NOTIF.busy.has(n.id);
  const li = el('li', 'notif-item');
  const title = el('p', 'notif-name', name); title.dir = 'auto';
  const when = el('time', null, relTime(n.created_at)); when.dateTime = n.created_at; when.title = fmtDate(n.created_at, true);
  const dot = el('span', null, '·'); dot.setAttribute('aria-hidden', 'true');
  const meta = el('p', 'notif-meta'); meta.append(el('span', null, t('notif.by', { name: who })), dot, when);
  const acts = el('div', 'notif-actions'); acts.setAttribute('role', 'group'); acts.setAttribute('aria-label', name);
  [['view', 'notif.open', 'btn btn-primary'], ['snooze', 'notif.snooze', 'btn btn-ghost'], ['dismiss', 'notif.dismiss', 'btn btn-ghost']]
    .forEach(([action, key, cls]) => {
      const b = el('button', cls, t(key)); b.type = 'button'; b.disabled = busy;
      b.addEventListener('click', () => notifAct(n, action));
      acts.append(b);
    });
  li.append(title, meta, acts);
  return li;
}

function renderNotifPanel() {
  NOTIF.sig = state.lang + '|' + NOTIF.ver;
  const body = $('notif-body');
  body.replaceChildren();
  body.setAttribute('aria-busy', String(!NOTIF.loaded && !NOTIF.error));
  if (NOTIF.error) {   // error + Retry
    const box = el('div', 'notif-state');
    const msg = el('p', 'error', t('notif.error')); msg.setAttribute('role', 'alert');
    const retry = el('button', 'btn btn-secondary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', retryNotifications);
    box.append(msg, retry); body.append(box);
    return;
  }
  if (!NOTIF.loaded) { body.append(skeleton(3)); return; }   // loading
  if (!NOTIF.rows.length) {   // empty
    const box = el('div', 'notif-state');
    box.append(el('p', 'notif-empty-title', t('notif.empty')), el('p', 'muted', t('notif.emptyHint')));
    body.append(box);
    return;
  }
  const ul = el('ul', 'notif-list');
  NOTIF.rows.forEach((n) => ul.append(buildNotifItem(n)));
  body.append(ul);
}

/* =====================================================================
   Phase 9 — Contributor statistics & admin contributor evaluation
   Contributor (#/contributor/stats): own products only, server-side head:true counts
     (no rows downloaded), recycle bin excluded (deleted_at IS NULL), status = CURRENT status.
     Submitted products are bucketed by submitted_at, drafts by created_at.
   Admin (#/admin/statistics): evaluations are written ONLY through the RPC save_evaluation()
     (validation, 6 scores, average, period rules, upsert, activity log all live in the database).
   No Realtime. No database changes.
   ===================================================================== */
const CRITERIA = ['products_added', 'product_quality', 'information_completeness',
                  'research_accuracy', 'accepted_products', 'checklist_compliance'];   // exactly six, same codes as the database
const STAT_STATUSES = ['draft', 'pending', 'accepted', 'rejected', 'successful'];
const STAT_PERIODS = ['week', 'month', 'all'];
const EVAL_WEEKS = 26;    // weekly periods offered (current week first, never a future one)
const EVAL_MONTHS = 12;   // monthly periods offered
const EVAL_HISTORY = 12;
const EVAL_COLS = 'id, contributor_id, evaluator_id, updated_by, period_type, period_start, period_end, average_score, ' +
  'created_at, updated_at, contributor_evaluation_scores(criterion, score)';

/* ===== Date helpers (local calendar: Monday-based weeks, calendar months) ===== */
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
function parseYmd(s) { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }
function weekStartOf(d) { return addDays(d, -((d.getDay() + 6) % 7)); }
const monthFmt = {};
function fmtMonth(d) {
  if (!monthFmt[state.lang]) monthFmt[state.lang] = new Intl.DateTimeFormat(DATE_LOCALE[state.lang], { month: 'long', year: 'numeric' });
  return monthFmt[state.lang].format(d);
}
const dayLabel = (d) => fmtDate(d.toISOString());   // local midnight -> same local day
function rangeLabel(from, to) { return t('stats.range', { from: dayLabel(from), to: dayLabel(to) }); }
function periodLabel(type, startStr) {
  const s = parseYmd(startStr);
  return type === 'monthly' ? fmtMonth(s) : rangeLabel(s, addDays(s, 6));
}
function periodEnd(type, startStr) {
  const s = parseYmd(startStr);
  return type === 'monthly' ? new Date(s.getFullYear(), s.getMonth() + 1, 0) : addDays(s, 6);
}
const fmtScore = (n) => fmtNum(Math.round(Number(n) * 100) / 100);

/* Small shared pieces */
function meter(score) {   // visual 0-10 indicator; score null = empty
  const m = el('div', 'meter'); m.setAttribute('aria-hidden', 'true');
  const f = el('div', 'meter-fill');
  const ok = typeof score === 'number' && !Number.isNaN(score);
  f.style.width = ok ? Math.max(0, Math.min(100, score * 10)) + '%' : '0%';
  f.dataset.level = !ok ? 'none' : score >= 7 ? 'hi' : score >= 4 ? 'mid' : 'lo';
  m.append(f); return m;
}
function errorBox(titleKey, errKey, onRetry) {
  const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button';
  retry.addEventListener('click', onRetry);
  const box = listStateBox('!', titleKey, null, null);
  box.append(el('p', 'error', t(errKey)), retry);
  return box;
}

/* =====================================================================
   Contributor statistics
   ===================================================================== */
const S = {
  active: false, period: 'week', life: null, per: {}, evals: null,
  err: { life: null, per: null }, loading: { life: false, per: false },
  lseq: 0, pseq: 0, sig: null, els: {}
};

function statsBounds(period) {   // [from, to) in local time; null = no limit
  const now = new Date();
  if (period === 'week') { const s = weekStartOf(now); return { from: s, to: addDays(s, 7) }; }
  if (period === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  return null;
}
async function countOwn(apply) {   // count only (head:true): no rows are transferred
  let q = sb.from('products').select('id', { count: 'exact', head: true })
    .eq('created_by', state.profile.id)   // RLS already limits rows to the owner
    .is('deleted_at', null);              // recycle bin is never counted
  const { count, error } = await apply(q);
  if (error) throw error;
  return count || 0;
}
async function fetchLifetime() {
  const n = await Promise.all(STAT_STATUSES.map((s) => countOwn((q) => q.eq('status', s))));
  const d = {}; STAT_STATUSES.forEach((s, i) => { d[s] = n[i]; });
  return d;
}
async function fetchPeriod(period) {
  const b = statsBounds(period), a = b.from.toISOString(), z = b.to.toISOString();
  const n = await Promise.all(STAT_STATUSES.map((s) => countOwn((q) => s === 'draft'
    ? q.eq('status', 'draft').gte('created_at', a).lt('created_at', z)             // drafts: created_at
    : q.eq('status', s).gte('submitted_at', a).lt('submitted_at', z))));           // submitted: submitted_at, current status
  const d = {}; STAT_STATUSES.forEach((s, i) => { d[s] = n[i]; });
  return d;
}
async function fetchOwnEvals() {   // read-only: a contributor may read only his own evaluations (RLS)
  const types = ['weekly', 'monthly'];
  const rs = await Promise.all(types.map((ty) => sb.from('contributor_evaluations')
    .select('period_type, period_start, period_end, average_score')
    .eq('contributor_id', state.profile.id).eq('period_type', ty)
    .order('period_start', { ascending: false }).limit(1)));
  const out = {};
  rs.forEach((r, i) => { if (r.error) throw r.error; out[types[i]] = r.data[0] || null; });
  return out;
}
async function loadLife() {
  const seq = ++S.lseq;
  S.err.life = null; S.loading.life = true; paintLife(); paintPeriod();
  try {
    const [life, evals] = await Promise.all([fetchLifetime(), fetchOwnEvals().catch(() => false)]);   // evaluation card is optional
    if (seq !== S.lseq || !S.active) return;
    S.life = life; S.evals = evals; S.loading.life = false;
    paintLife(); paintPeriod(); paintStatsEvals();
  } catch (e) {
    if (seq !== S.lseq || !S.active) return;
    S.loading.life = false; S.err.life = authErrorKey(e);
    paintLife(); paintPeriod();
  }
}
async function loadPeriod() {
  const key = S.period, seq = ++S.pseq;
  S.err.per = null;
  if (key === 'all' || S.per[key]) { S.loading.per = false; paintPeriod(); return; }   // "all" = lifetime numbers: no extra request
  S.loading.per = true; paintPeriod();
  try {
    const d = await fetchPeriod(key);
    if (seq !== S.pseq || !S.active) return;
    S.per[key] = d; S.loading.per = false; paintPeriod();
  } catch (e) {
    if (seq !== S.pseq || !S.active) return;
    S.loading.per = false; S.err.per = authErrorKey(e); paintPeriod();
  }
}
function setStatsPeriod(p) {
  if (p === S.period) return;
  S.period = p;
  S.els.chips.forEach((c) => { const on = c.dataset.period === p; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
  loadPeriod();
}
function enterStats() { S.active = true; renderStats(); loadLife(); loadPeriod(); }
function leaveStats() {
  S.active = false; S.lseq++; S.pseq++;
  S.life = null; S.per = {}; S.evals = null; S.err = { life: null, per: null }; S.loading = { life: false, per: false };
  S.els = {}; S.sig = null;
}
function resetStats() { leaveStats(); S.period = 'week'; }   // logout: nothing carries over to the next user

function statTile(label, value, status) {
  const d = el('div', 'stile'); if (status) d.dataset.status = status;
  const n = el('div', 'stile-n');
  if (value === null) n.append(el('span', 'skeleton sk-num'));
  else n.textContent = typeof value === 'number' ? fmtNum(value) : value;
  d.append(n, el('div', 'stile-l', label));
  return d;
}
function statTiles(data) {   // data: { draft, pending, ... } or null while loading
  const g = el('div', 'stats-grid');
  const total = data ? STAT_STATUSES.reduce((a, s) => a + data[s], 0) : null;
  g.append(statTile(t('stats.total'), total, 'total'));
  STAT_STATUSES.forEach((s) => g.append(statTile(t('status.' + s), data ? data[s] : null, s)));
  return g;
}
function paintLife() {
  const box = S.els.life; if (!box) return;
  box.replaceChildren(); box.setAttribute('aria-busy', String(S.loading.life));
  if (S.err.life) { box.append(errorBox('stats.errorTitle', S.err.life, loadLife)); return; }
  box.append(statTiles(S.life));
}
function paintPeriod() {
  const box = S.els.per; if (!box) return;
  const all = S.period === 'all';
  const loading = all ? S.loading.life : S.loading.per, err = all ? S.err.life : S.err.per;
  const data = all ? S.life : (S.per[S.period] || null);
  const b = statsBounds(S.period);
  S.els.range.textContent = b ? rangeLabel(b.from, addDays(b.to, -1)) : t('stats.rangeAll');
  box.replaceChildren(); box.setAttribute('aria-busy', String(loading));
  if (err) { box.append(errorBox('stats.errorTitle', err, all ? loadLife : loadPeriod)); return; }
  box.append(statTiles(loading ? null : data));
  const reviewed = data ? data.accepted + data.rejected + data.successful : 0;
  const rate = data && reviewed > 0 ? Math.round(1000 * (data.accepted + data.successful) / reviewed) / 10 : null;   // same rule as the database function
  const rt = el('div', 'stats-rate');
  rt.append(el('span', 'stats-rate-l', t('stats.acceptRate')),
            el('strong', 'stats-rate-n', !data || loading ? '…' : rate === null ? '—' : fmtNum(rate) + '%'));
  const rateHint = el('p', 'hint', t('stats.acceptRateHint'));
  box.append(rt, rateHint);
}
function paintStatsEvals() {
  const box = S.els.evals; if (!box) return;
  box.replaceChildren();
  box.hidden = !S.evals;   // hidden when not loaded (or not readable): never an empty card
  if (!S.evals) return;
  box.append(el('h2', null, t('stats.evals')), el('p', 'hint', t('stats.evalsHint')));
  const grid = el('div', 'seval-grid');
  [['weekly', 'stats.evalWeekly'], ['monthly', 'stats.evalMonthly']].forEach(([ty, key]) => {
    const ev = S.evals[ty];
    const c = el('div', 'seval');
    c.append(el('div', 'seval-l', t(key)));
    if (ev) {
      c.append(el('div', 'seval-n', fmtScore(ev.average_score) + ' / 10'), meter(Number(ev.average_score)),
               el('div', 'hint', periodLabel(ty, ev.period_start)));
    } else {
      c.append(el('div', 'seval-n seval-none', '—'), el('div', 'hint', t('stats.evalNone')));
    }
    grid.append(c);
  });
  box.append(grid);
}
/* Builds the page from state (also used after a language switch: no refetch) */
function renderStats() {
  S.sig = state.lang;
  const body = $('module-body'); body.replaceChildren();
  const wrap = el('div', 'stats');

  const s1 = el('section', 'scard');
  const h1 = el('div', 'scard-head');
  h1.append(el('h2', null, t('stats.lifetime')), el('span', 'stag', t('stats.tagLifetime')));
  const life = el('div', 'stats-box');
  s1.append(h1, el('p', 'hint', t('stats.lifetimeHint')), life);

  const s2 = el('section', 'scard scard-period');
  const h2 = el('div', 'scard-head');
  h2.append(el('h2', null, t('stats.period')), el('span', 'stag stag-period', t('stats.tagPeriod')));
  const chipBox = el('div', 'chips'); chipBox.setAttribute('role', 'group'); chipBox.setAttribute('aria-label', t('stats.periodLabel'));
  const chips = STAT_PERIODS.map((p) => {
    const c = el('button', 'chip' + (p === S.period ? ' on' : ''), t('stats.' + p)); c.type = 'button';
    c.dataset.period = p; c.setAttribute('aria-pressed', String(p === S.period));
    c.addEventListener('click', () => setStatsPeriod(p));
    chipBox.append(c); return c;
  });
  const range = el('p', 'stats-range'); range.setAttribute('role', 'status'); range.setAttribute('aria-live', 'polite');
  const per = el('div', 'stats-box');
  s2.append(h2, chipBox, range, el('p', 'hint', t('stats.periodHint')), per);

  const evals = el('section', 'scard'); evals.hidden = true;
  wrap.append(s1, s2, evals);
  body.append(wrap);
  S.els = { life, per, range, chips, evals };
  paintLife(); paintPeriod(); paintStatsEvals();
}

/* =====================================================================
   Admin contributor evaluation
   ===================================================================== */
const E = {   // list state
  active: false, type: 'weekly', start: null, q: '', people: null, byId: {}, evals: {},
  loading: false, error: null, seq: 0, sig: null, els: {}
};
let EV = null;   // the evaluation open in the modal (null when closed)

function evalPeriods(type) {   // newest first; the current period is the newest: no future period is ever offered
  const now = new Date(), out = [];
  if (type === 'weekly') { let s = weekStartOf(now); for (let i = 0; i < EVAL_WEEKS; i++) { out.push(ymd(s)); s = addDays(s, -7); } }
  else for (let i = 0; i < EVAL_MONTHS; i++) out.push(ymd(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  return out;
}
function personName(id) { const p = E.byId[id]; return p ? p.full_name : t('notif.unknownUser'); }
const scoreOf = (ev, k) => { const r = ((ev && ev.contributor_evaluation_scores) || []).find((x) => x.criterion === k); return r ? r.score : null; };

async function loadEval() {
  const seq = ++E.seq;
  E.loading = true; E.error = null; paintEval();
  try {
    const [pr, ev] = await Promise.all([
      E.people ? Promise.resolve(null)
        : sb.from('profiles').select('id, full_name, email, role, is_active, avatar_id').order('full_name', { ascending: true }).limit(1000),
      sb.from('contributor_evaluations').select(EVAL_COLS).eq('period_type', E.type).eq('period_start', E.start).limit(1000)
    ]);
    if (pr && pr.error) throw pr.error;
    if (ev.error) throw ev.error;
    if (seq !== E.seq || !E.active) return;   // a newer period / page change started: drop this answer
    if (pr) { E.people = pr.data; E.byId = {}; pr.data.forEach((p) => { E.byId[p.id] = p; }); }
    E.evals = {}; ev.data.forEach((r) => { E.evals[r.contributor_id] = r; });
    E.loading = false; paintEval();
  } catch (e) {
    if (seq !== E.seq || !E.active) return;
    E.loading = false; E.error = authErrorKey(e); paintEval();
  }
}
function evalCandidates() {
  // Active contributors are the candidates for NEW evaluations. A disabled contributor stays visible
  // (read-only) only when an evaluation already exists for the selected period: history stays intact.
  return (E.people || []).filter((p) => p.role === 'contributor' && (p.is_active || E.evals[p.id]));
}
function evalVisible() {
  const term = normalizeName(E.q);
  const all = evalCandidates();
  return { all, rows: term ? all.filter((p) => normalizeName(p.full_name + ' ' + p.email).includes(term)) : all };
}
function enterEval() {
  E.active = true;
  if (!E.start || !evalPeriods(E.type).includes(E.start)) E.start = evalPeriods(E.type)[0];
  renderEval(); loadEval();
}
function leaveEval() {
  if (EV) { EV = null; closeModal(); }
  E.active = false; E.seq++; E.loading = false; E.error = null; E.people = null; E.byId = {}; E.evals = {}; E.els = {}; E.sig = null;
}
function resetEval() { leaveEval(); E.type = 'weekly'; E.start = null; E.q = ''; }   // logout: nothing carries over

function setEvalType(type) {
  if (type === E.type) return;
  E.type = type; E.start = evalPeriods(type)[0];
  E.els.chips.forEach((c) => { const on = c.dataset.type === type; c.classList.toggle('on', on); c.setAttribute('aria-pressed', String(on)); });
  fillPeriodSelect();
  loadEval();
}
function fillPeriodSelect() {
  const sel = E.els.select; sel.replaceChildren();
  evalPeriods(E.type).forEach((s) => { const o = el('option', null, periodLabel(E.type, s)); o.value = s; sel.append(o); });
  sel.value = E.start;
}

function buildEvalCard(p) {
  const ev = E.evals[p.id];
  const card = el('article', 'ecard');
  const top = el('div', 'ecard-top');
  const av = el('div', 'avatar'); renderAvatar(av, p);
  const who = el('div', 'ecard-who');
  const em = el('p', 'ecard-mail', p.email); em.dir = 'ltr';
  who.append(el('h3', 'ecard-name', p.full_name), em);
  const badge = el('span', 'badge ' + (ev ? 'badge-accepted' : 'badge-pending'), t(ev ? 'eval.statusDone' : 'eval.statusNone'));
  top.append(av, who, badge);
  const foot = el('div', 'ecard-foot');
  const sc = el('div', 'ecard-score');
  sc.append(el('span', 'ecard-score-l', t('eval.average')),
            el('strong', 'ecard-score-n', ev ? fmtScore(ev.average_score) + ' / 10' : '—'),
            meter(ev ? Number(ev.average_score) : null));
  const btn = el('button', 'btn ' + (ev ? 'btn-secondary' : 'btn-primary'),
    t(!p.is_active ? 'eval.view' : ev ? 'eval.edit' : 'eval.evaluate'));
  btn.type = 'button';
  btn.addEventListener('click', () => openEvaluation(p.id));
  if (!p.is_active) card.append(top, el('p', 'hint ecard-inactive', t('eval.statusInactive')), foot);
  else card.append(top, foot);
  foot.append(sc, btn);
  return card;
}
function paintEval() {
  const X = E.els;
  if (!X.grid) return;
  X.state.replaceChildren(); X.grid.replaceChildren(); X.grid.setAttribute('aria-busy', String(E.loading));
  X.summary.textContent = '';
  if (E.loading) {
    for (let i = 0; i < 4; i++) {
      const sk = el('div', 'ecard ecard-sk');
      sk.append(el('div', 'skeleton sk-title'), el('div', 'skeleton sk-line'), el('div', 'skeleton sk-line short'));
      X.grid.append(sk);
    }
    return;
  }
  if (E.error) { X.state.append(errorBox('eval.errorTitle', E.error, loadEval)); return; }
  const { all, rows } = evalVisible();
  if (!all.length) { X.state.append(listStateBox('☺', 'eval.emptyTitle', 'eval.emptyBody', null)); return; }
  if (!rows.length) {
    const clear = el('button', 'btn btn-secondary', t('plist.clearFilters')); clear.type = 'button';
    clear.addEventListener('click', () => { E.q = ''; X.input.value = ''; X.clear.hidden = true; paintEval(); });
    X.state.append(listStateBox('⌕', 'eval.noResultsTitle', 'eval.noResultsBody', clear));
    return;
  }
  X.summary.textContent = t('eval.shown', { n: rows.length });
  rows.forEach((p) => X.grid.append(buildEvalCard(p)));
}
/* Builds the page from state (also used after a language switch: no refetch) */
function renderEval() {
  E.sig = state.lang;
  const body = $('module-body'); body.replaceChildren();
  const wrap = el('div', 'plist evalpage');
  const tools = el('div', 'plist-tools');

  const sw = el('div', 'psearch');
  const inp = el('input'); inp.type = 'search'; inp.maxLength = 100; inp.value = E.q;
  inp.placeholder = t('eval.search'); inp.autocomplete = 'off'; inp.setAttribute('aria-label', t('eval.search'));
  const clear = el('button', 'psearch-x', '×'); clear.type = 'button'; clear.hidden = !E.q;
  clear.setAttribute('aria-label', t('plist.clear')); clear.title = t('plist.clear');
  inp.addEventListener('input', () => { E.q = inp.value; clear.hidden = !inp.value; paintEval(); });   // in-memory filter: no request per keystroke
  clear.addEventListener('click', () => { inp.value = ''; E.q = ''; clear.hidden = true; paintEval(); inp.focus(); });
  sw.append(inp, clear);

  const row = el('div', 'eval-controls');
  const chipBox = el('div', 'chips'); chipBox.setAttribute('role', 'group'); chipBox.setAttribute('aria-label', t('eval.type'));
  const chips = ['weekly', 'monthly'].map((ty) => {
    const c = el('button', 'chip' + (ty === E.type ? ' on' : ''), t('eval.' + ty)); c.type = 'button';
    c.dataset.type = ty; c.setAttribute('aria-pressed', String(ty === E.type));
    c.addEventListener('click', () => setEvalType(ty));
    chipBox.append(c); return c;
  });
  const pw = el('div', 'eval-period');
  const lab = el('label', null, t('eval.period')); lab.htmlFor = 'eval-period';
  const sel = el('select'); sel.id = 'eval-period';
  sel.addEventListener('change', () => { E.start = sel.value; loadEval(); });
  pw.append(lab, sel);
  row.append(chipBox, pw);
  tools.append(sw, row);

  const summary = el('p', 'hint plist-summary'); summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', 'egrid'), stateBox = el('div', 'plist-state');
  wrap.append(tools, summary, grid, stateBox);
  body.append(wrap);
  E.els = { input: inp, clear, chips, select: sel, summary, grid, state: stateBox };
  fillPeriodSelect();
  paintEval();
}

/* ===== Evaluation modal ===== */
function parseScore(s, input) {   // null = empty, NaN = invalid, else integer 0..10
  if (input && input.validity && input.validity.badInput) return NaN;
  const v = String(s).trim();
  if (v === '') return null;
  if (!/^\d{1,2}$/.test(v)) return NaN;
  const n = Number(v);
  return n > 10 ? NaN : n;
}
function openEvaluation(id) {
  const p = E.byId[id];
  if (!p || !E.active) return;
  EV = { p, ctx: { type: E.type, start: E.start }, ev: E.evals[id] || null, hist: null, histErr: false, tried: false, saving: false, els: {} };
  $('modal').classList.add('modal-wide');
  openModal('eval.modalTitle', () => {});
  renderEvalModal();
  loadEvalHistory(EV);
}
function renderEvalModal() {
  const V = EV; if (!V) return;
  const { p, ctx, ev } = V, editable = !!p.is_active;
  const body = $('modal-body'); body.replaceChildren();

  const head = el('div', 'emod-head');
  const av = el('div', 'avatar'); renderAvatar(av, p);
  const who = el('div', 'emod-who');
  const em = el('p', 'ecard-mail', p.email); em.dir = 'ltr';
  who.append(el('p', 'emod-name', p.full_name), em);
  head.append(av, who);

  const per = el('div', 'emod-period');
  per.append(el('span', 'badge', t('eval.' + ctx.type)), el('strong', null, periodLabel(ctx.type, ctx.start)));
  body.append(head, per);

  if (ev) {
    const meta = el('div', 'emod-meta');
    meta.append(el('p', 'hint', t('eval.evaluatedBy', { name: personName(ev.evaluator_id) })));
    if (ev.updated_by && ev.updated_by !== ev.evaluator_id) {
      meta.append(el('p', 'hint', t('eval.updatedBy', { name: personName(ev.updated_by), date: fmtDate(ev.updated_at, true) })));
    } else {
      meta.append(el('p', 'hint', t('eval.evaluatedOn', { date: fmtDate(ev.updated_at, true) })));
    }
    body.append(meta);
  }
  if (!editable) body.append(el('p', 'banner banner-info', t('eval.inactiveNote')));

  const form = el('form'); form.noValidate = true;
  form.append(el('h3', 'emod-h', t('eval.criteria')), el('p', 'hint', t('eval.scoreHint')));
  const list = el('div', 'crit-list');
  const rows = {};
  CRITERIA.forEach((k) => {
    const row = el('div', 'crit');
    const lab = el('label', null, t('crit.' + k)); lab.htmlFor = 'crit-' + k;
    const inp = el('input'); inp.type = 'number'; inp.id = 'crit-' + k; inp.min = '0'; inp.max = '10'; inp.step = '1';
    inp.inputMode = 'numeric'; inp.dir = 'ltr'; inp.disabled = !editable;
    const cur = scoreOf(ev, k); inp.value = cur === null ? '' : String(cur);
    const m = el('div', 'crit-meter');
    const err = el('p', 'crit-err'); err.id = 'crit-err-' + k; err.hidden = true;
    inp.setAttribute('aria-describedby', err.id);
    inp.addEventListener('input', () => { refreshRow(k); refreshAverage(); });
    row.append(lab, inp, m, err);
    rows[k] = { inp, m, err }; list.append(row);
  });
  form.append(list);

  const avg = el('div', 'emod-avg');
  const avgL = el('span', 'emod-avg-l', t('eval.liveAverage'));
  const avgN = el('strong', 'emod-avg-n', '—');
  const avgM = el('div', 'emod-avg-m');
  const avgH = el('p', 'hint emod-avg-h', t('eval.avgPending'));
  avg.append(avgL, avgN, avgM, avgH);
  form.append(avg);

  const err = el('p', 'error'); err.setAttribute('role', 'alert'); err.hidden = true;
  const actions = el('div', 'modal-actions');
  const cancel = el('button', 'btn btn-ghost', t(editable ? 'common.cancel' : 'common.close')); cancel.type = 'button';
  cancel.addEventListener('click', closeModal);
  actions.append(cancel);
  let save = null;
  if (editable) {
    save = el('button', 'btn btn-primary', t('eval.save')); save.type = 'submit';
    actions.append(save);
  }
  form.append(err, actions);
  body.append(form);

  const hist = el('div', 'emod-hist');
  body.append(hist);
  V.els = { rows, avgN, avgM, avgH, err, save, hist, form };

  function refreshRow(k) {
    const r = rows[k], s = parseScore(r.inp.value, r.inp);
    const bad = Number.isNaN(s), missing = s === null && V.tried;
    r.m.replaceChildren(meter(bad ? null : s));
    r.inp.setAttribute('aria-invalid', String(bad || missing));
    r.err.hidden = !(bad || missing);
    r.err.textContent = bad ? t('eval.scoreInvalid') : missing ? t('eval.scoreMissing') : '';
  }
  function refreshAverage() {
    const vals = CRITERIA.map((k) => parseScore(rows[k].inp.value, rows[k].inp));
    const ok = vals.every((v) => v !== null && !Number.isNaN(v));
    const a = ok ? vals.reduce((x, y) => x + y, 0) / 6 : null;   // same formula as the database (sum / 6)
    avgN.textContent = ok ? fmtScore(a) + ' / 10' : '—';
    avgM.replaceChildren(meter(a));
    avgH.hidden = ok;
  }
  CRITERIA.forEach(refreshRow); refreshAverage();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (V.saving || !editable) return;
    V.tried = true; err.hidden = true;
    const scores = {}; let firstBad = null, anyInvalid = false;
    CRITERIA.forEach((k) => {
      const s = parseScore(rows[k].inp.value, rows[k].inp);
      if (s === null || Number.isNaN(s)) { if (Number.isNaN(s)) anyInvalid = true; if (!firstBad) firstBad = k; } else scores[k] = s;
      refreshRow(k);
    });
    if (firstBad) {   // incomplete / invalid: never sent to the database
      err.textContent = t(anyInvalid ? 'err.evalScores' : 'err.evalIncomplete'); err.hidden = false;
      rows[firstBad].inp.focus();
      return;
    }
    V.saving = true; save.disabled = true; save.textContent = t('eval.saving');
    try {
      const { data, error } = await sb.rpc('save_evaluation', {
        p_contributor_id: p.id, p_period_type: ctx.type, p_period_start: ctx.start, p_scores: scores   // the database validates everything again
      });
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      toast('success', 'eval.saved');
      let fresh = null;   // reload the stored evaluation (scores, average, evaluator) from the database
      try {
        const r = await sb.from('contributor_evaluations').select(EVAL_COLS).eq('id', row.id).single();
        if (!r.error) fresh = r.data;
      } catch (x) { /* fall back to the RPC result below */ }
      V.ev = fresh || Object.assign({}, row, { contributor_evaluation_scores: CRITERIA.map((k) => ({ criterion: k, score: scores[k] })) });
      if (E.active && E.type === ctx.type && E.start === ctx.start) { E.evals[p.id] = V.ev; paintEval(); }
      V.saving = false;
      if (EV === V && $('modal').open) { V.hist = null; V.histErr = false; V.tried = false; renderEvalModal(); loadEvalHistory(V); }
    } catch (x) {
      V.saving = false;
      if (EV !== V || !$('modal').open) return;
      const k = authErrorKey(x);
      err.textContent = t(k === 'err.generic' ? 'err.evalSave' : k); err.hidden = false;
      save.disabled = false; save.textContent = t('eval.save');
    }
  });
  paintEvalHistory(V);
  if (editable && window.matchMedia && matchMedia('(pointer: fine)').matches) { const first = CRITERIA.find((k) => rows[k].inp.value === '') || CRITERIA[0]; rows[first].inp.focus(); }
}
async function loadEvalHistory(V) {
  try {
    const { data, error } = await sb.from('contributor_evaluations')
      .select('id, period_type, period_start, period_end, average_score')
      .eq('contributor_id', V.p.id).eq('period_type', V.ctx.type)
      .order('period_start', { ascending: false }).limit(EVAL_HISTORY);
    if (error) throw error;
    if (EV !== V) return;
    V.hist = data; V.histErr = false;
  } catch (e) {
    if (EV !== V) return;
    V.hist = null; V.histErr = true;
  }
  paintEvalHistory(V);
}
function paintEvalHistory(V) {
  const box = V.els && V.els.hist; if (!box) return;
  box.replaceChildren();
  box.append(el('h3', 'emod-h', t('eval.history')));
  if (V.histErr) { box.append(el('p', 'hint', t('eval.historyError'))); return; }
  if (!V.hist) { box.append(skeleton(2)); return; }
  if (!V.hist.length) { box.append(el('p', 'hint', t('eval.historyEmpty'))); return; }
  const ul = el('ul', 'hist-list');
  V.hist.forEach((h) => {
    const li = el('li', 'hist-item' + (h.period_start === V.ctx.start ? ' current' : ''));
    const l = el('span', 'hist-l', periodLabel(h.period_type, h.period_start));
    if (h.period_start === V.ctx.start) l.append(' ', el('span', 'badge', t('eval.current')));
    li.append(l, el('strong', 'hist-n', fmtScore(h.average_score) + ' / 10'), meter(Number(h.average_score)));
    ul.append(li);
  });
  box.append(ul);
}

/* =====================================================================
   Phase 10 — Admin Product Organization + Recycle Bin
   One paging engine (keyset, server-side filters) serves both lists:
   O = organization (products NOT in the bin), B = recycle bin (products in the bin).
   ===================================================================== */
const ORG_COLS = 'id, status, name_ar, name_fr, name_en, other_names, created_at, submitted_at, accepted_at, rejected_at, successful_at, updated_at, ' +
  'contributor:profiles!created_by(full_name), product_images(storage_path, position)';
const BIN_COLS = ORG_COLS + ', deleted_at, deleter:profiles!deleted_by(full_name)';
const ORG_DATE_COL = { pending: 'submitted_at', accepted: 'accepted_at', rejected: 'rejected_at', successful: 'successful_at' };
const PURGE_WORD_KEY = 'bin.confirmWord';

function newPager(kind) {
  return { kind, active: false, status: '', q: '', term: '', niche: '', micro: '', rows: [], hasMore: false, loading: false,
    error: null, sig: null, seq: 0, timer: null, thumbs: {}, links: {}, els: {} };
}
const O = newPager('org'), B = newPager('bin');
const pagerFiltered = (X) => !!(X.status || X.term || X.niche || X.micro);
const prodTitle = (r) => locName(r, 'name_') || (r.other_names && r.other_names[0]) || t('drafts.untitled');
const nicheLabel = (id) => { const n = P.niches.find((x) => x.id === id); return n ? locName(n, 'name_') : ''; };
const microLabel = (id) => { const m = P.micros.find((x) => x.id === id); return m ? locName(m, 'name_') : ''; };

/* ----- shared small UI helpers ----- */
function buildSearch(X, id, apply) {
  const sw = el('div', 'psearch');
  const input = el('input'); input.type = 'search'; input.id = id; input.maxLength = 100; input.value = X.q;
  input.placeholder = t('plist.search'); input.autocomplete = 'off'; input.setAttribute('aria-label', t('plist.search'));
  const clear = el('button', 'psearch-x', '×'); clear.type = 'button'; clear.hidden = !X.q;
  clear.setAttribute('aria-label', t('plist.clear')); clear.title = t('plist.clear');
  input.addEventListener('input', () => {
    X.q = input.value; clear.hidden = !input.value;
    clearTimeout(X.timer); X.timer = setTimeout(apply, LIST_SEARCH_MS);   // debounce
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(X.timer); apply(); } });
  clear.addEventListener('click', () => { input.value = ''; X.q = ''; clear.hidden = true; clearTimeout(X.timer); apply(); input.focus(); });
  sw.append(input, clear);
  return { sw, input, clear };
}
function buildChipGroup(values, labelFn, current, onPick, ariaKey) {
  const box = el('div', 'chips plist-chips'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', t(ariaKey));
  const chips = values.map((v) => {
    const c = el('button', 'chip' + (v === current ? ' on' : ''), labelFn(v)); c.type = 'button';
    c.dataset.v = v; c.setAttribute('aria-pressed', String(v === current));
    c.addEventListener('click', () => onPick(v));
    box.append(c); return c;
  });
  return { box, chips };
}
function syncChips(chips, current) {
  (chips || []).forEach((c) => { const on = c.dataset.v === current; c.setAttribute('aria-pressed', String(on)); c.classList.toggle('on', on); });
}
function selectEl(id, ariaKey, options, value) {   // options: [[value, literal label]]
  const s = el('select', 'filter-select'); s.id = id; s.setAttribute('aria-label', t(ariaKey));
  options.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; s.append(o); });
  s.value = value; if (s.value !== value) s.value = '';
  return s;
}
function pagerThumb(X, r, tag) {
  const thumb = el(tag, 'pthumb');
  const path = firstImagePath(r), url = path && X.thumbs[path];
  if (url) {
    const img = el('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async'; img.src = url;
    img.addEventListener('error', () => thumb.replaceChildren(listPlaceholder()));
    thumb.append(img);
  } else thumb.append(listPlaceholder());
  return thumb;
}
function tagLine(labelKey, names) {
  const line = el('div', 'ptag-line');
  line.append(el('span', 'ptag-label', t(labelKey)));
  if (!names.length) line.append(el('span', 'ptag-none', '—'));
  names.forEach((n) => line.append(el('span', 'tag', n)));
  return line;
}

/* ----- data ----- */
async function pagerLinks(X, ids) {   // Niche / Micro-niche links of the loaded page (2 small queries)
  if (!ids.length) return;
  const [n, m] = await Promise.all([
    sb.from('product_niches').select('product_id, niche_id').in('product_id', ids),
    sb.from('product_micro_niches').select('product_id, micro_niche_id').in('product_id', ids)
  ]);
  if (n.error) throw n.error;
  if (m.error) throw m.error;
  ids.forEach((id) => { X.links[id] = { n: [], m: [] }; });
  (n.data || []).forEach((x) => { if (X.links[x.product_id]) X.links[x.product_id].n.push(x.niche_id); });
  (m.data || []).forEach((x) => { if (X.links[x.product_id]) X.links[x.product_id].m.push(x.micro_niche_id); });
}
async function pagerLoad(X, reset) {
  if (!X.active) return;
  const seq = ++X.seq, bin = X.kind === 'bin', oc = bin ? 'deleted_at' : 'updated_at';
  if (reset) {
    X.term = normalizeName(X.q).slice(0, 100);
    X.rows = []; X.hasMore = false; X.thumbs = {}; X.links = {};
    if (X.els.grid) X.els.grid.replaceChildren();
  }
  X.loading = true; X.error = null;
  pagerPaint(X);
  try {
    await loadLookups();                                         // niches + micro-niches (names, filters)
    if (seq !== X.seq || !X.active) return;
    if (!bin) fillOrgSelects();
    let cols = bin ? BIN_COLS : ORG_COLS;
    if (X.niche) cols += ', product_niches!inner(niche_id)';      // server-side Niche filter
    if (X.micro) cols += ', product_micro_niches!inner(micro_niche_id)';   // server-side Micro-niche filter
    let q = sb.from('products').select(cols);
    q = bin ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null);   // the bin and the normal list never mix
    q = q.order('position', { ascending: true, referencedTable: 'product_images', foreignTable: 'product_images' })
      .limit(1, { referencedTable: 'product_images', foreignTable: 'product_images' });
    q = X.status ? q.eq('status', X.status) : q.in('status', ADMIN_STATUSES);
    if (X.niche) q = q.eq('product_niches.niche_id', X.niche);
    if (X.micro) q = q.eq('product_micro_niches.micro_niche_id', X.micro);
    if (X.term) q = q.ilike('search_text', '%' + X.term.replace(/[\\%_]/g, '\\$&') + '%');
    const last = reset ? null : X.rows[X.rows.length - 1];
    if (last) q = q.or(oc + '.lt.' + last[oc] + ',and(' + oc + '.eq.' + last[oc] + ',id.lt.' + last.id + ')');
    const { data, error } = await q.order(oc, { ascending: false }).order('id', { ascending: false }).limit(LIST_PAGE + 1);
    if (error) throw error;
    if (seq !== X.seq || !X.active) return;
    const more = data.length > LIST_PAGE;
    const page = data.slice(0, LIST_PAGE);
    let urls = {};
    try { urls = await signUrls(page.map(firstImagePath).filter(Boolean)); } catch (e) { /* placeholders */ }
    if (!bin) { try { await pagerLinks(X, page.map((r) => r.id)); } catch (e) { /* tags simply stay empty */ } }
    if (seq !== X.seq || !X.active) return;
    Object.assign(X.thumbs, urls);
    const known = new Set(X.rows.map((r) => r.id));
    const fresh = page.filter((r) => !known.has(r.id));
    X.rows = X.rows.concat(fresh); X.hasMore = more; X.loading = false;
    pagerAppend(X, fresh);
    pagerPaint(X);
  } catch (e) {
    if (seq !== X.seq || !X.active) return;
    X.loading = false; X.error = authErrorKey(e);
    pagerPaint(X);
  }
}
function pagerApply(X) {
  const term = normalizeName(X.q).slice(0, 100);
  if (term === X.term && !X.error) return;
  pagerLoad(X, true);
}
function pagerSetStatus(X, s) {
  if (s === X.status) return;
  X.status = s; syncChips(X.els.chips, s); clearTimeout(X.timer);
  pagerLoad(X, true);
}
function pagerClear(X) {
  X.q = ''; X.status = ''; X.niche = ''; X.micro = ''; clearTimeout(X.timer);
  const E = X.els;
  if (E.input) E.input.value = '';
  if (E.clear) E.clear.hidden = true;
  syncChips(E.chips, '');
  if (X.kind === 'org') fillOrgSelects();
  pagerLoad(X, true);
}
function pagerAppend(X, rows) {
  if (!X.els.grid) return;
  const frag = document.createDocumentFragment();
  rows.forEach((r) => frag.append(X.kind === 'org' ? buildOrgCard(r) : buildBinCard(r)));
  X.els.grid.append(frag);
}
function pagerDrop(X, id) {   // after trash / restore / purge: the row leaves this list
  X.rows = X.rows.filter((r) => r.id !== id); delete X.links[id];
  if (X.els.grid) { X.els.grid.replaceChildren(); pagerAppend(X, X.rows); }
  pagerPaint(X);
}
function pagerLeave(X) {
  X.active = false; X.seq++; clearTimeout(X.timer);
  X.rows = []; X.hasMore = false; X.loading = false; X.error = null; X.thumbs = {}; X.links = {}; X.els = {}; X.sig = null;
}
function pagerPaint(X) {
  const E = X.els;
  if (!E.grid) return;
  E.state.replaceChildren(); E.more.replaceChildren();
  E.grid.setAttribute('aria-busy', String(X.loading));
  E.summary.textContent = X.rows.length ? t(X.hasMore ? 'plist.shownMore' : 'plist.shown', { n: X.rows.length }) : '';
  if (X.loading && !X.rows.length) {
    for (let i = 0; i < 4; i++) {
      const sk = el('div', 'pcard pcard-sk');
      sk.append(el('div', 'pthumb skeleton'));
      const b = el('div', 'pbody'); b.append(el('div', 'skeleton sk-title'), el('div', 'skeleton sk-line'), el('div', 'skeleton sk-line short'));
      sk.append(b); E.state.append(sk);
    }
    E.state.classList.add('plist-grid'); return;
  }
  E.state.classList.remove('plist-grid');
  if (X.error && !X.rows.length) {
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => pagerLoad(X, true));
    const box = listStateBox('!', 'plist.errorTitle', null, null);
    box.append(el('p', 'error', t(X.error)), retry);
    E.state.append(box); return;
  }
  if (!X.rows.length) {
    const clear = el('button', 'btn btn-secondary', t('plist.clearFilters')); clear.type = 'button';
    clear.addEventListener('click', () => pagerClear(X));
    if (pagerFiltered(X)) E.state.append(listStateBox('⌕', 'plist.noResultsTitle', 'plist.noResultsBody', clear));
    else if (X.kind === 'org') E.state.append(listStateBox('▤', 'org.noneTitle', 'org.noneBody', null));
    else E.state.append(listStateBox('♲', 'bin.emptyTitle', 'bin.emptyBody', null));
    return;
  }
  if (X.error) {
    E.more.append(el('p', 'error', t(X.error)));
    const retry = el('button', 'btn btn-secondary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => pagerLoad(X, false));
    E.more.append(retry);
  } else if (X.hasMore) {
    const more = el('button', 'btn btn-secondary', t(X.loading ? 'plist.loading' : 'plist.loadMore')); more.type = 'button';
    more.disabled = X.loading;
    more.addEventListener('click', () => pagerLoad(X, false));
    E.more.append(more);
  }
}

/* ----- Product Organization ----- */
function enterOrg() { O.active = true; renderOrg(); pagerLoad(O, true); }
function leaveOrg() { pagerLeave(O); }
function resetOrg() { leaveOrg(); O.q = ''; O.term = ''; O.status = ''; O.niche = ''; O.micro = ''; }
function microOptions() {   // Micro-niche filter options follow the chosen Niche
  const list = P.micros.filter((m) => !O.niche || m.niche_id === O.niche);
  return [['', t('org.allMicros')]].concat(list.map((m) => {
    const parent = !O.niche && m.niche_id ? nicheLabel(m.niche_id) : '';
    return [m.id, locName(m, 'name_') + (parent ? ' — ' + parent : '')];
  }));
}
function fillOrgSelects() {
  const E = O.els;
  if (!E.niche || !E.micro) return;
  const fill = (sel, options, value) => {
    sel.replaceChildren();
    options.forEach(([v, l]) => { const o = el('option', null, l); o.value = v; sel.append(o); });
    sel.value = value; if (sel.value !== value) sel.value = '';
  };
  fill(E.niche, [['', t('org.allNiches')]].concat(P.niches.map((n) => [n.id, locName(n, 'name_')])), O.niche);
  if (O.micro && !P.micros.some((m) => m.id === O.micro && (!O.niche || m.niche_id === O.niche))) O.micro = '';
  fill(E.micro, microOptions(), O.micro);
}
function setOrgNiche(v) {
  O.niche = v;
  if (O.micro) { const m = P.micros.find((x) => x.id === O.micro); if (!m || (v && m.niche_id !== v)) O.micro = ''; }   // never an incompatible Niche + Micro-niche
  fillOrgSelects(); pagerLoad(O, true);
}
function setOrgMicro(v) { O.micro = v; pagerLoad(O, true); }

function buildOrgCard(r) {
  const href = '#/admin/products/' + r.id;
  const card = el('div', 'pcard ocard');
  const th = pagerThumb(O, r, 'a'); th.href = href; th.tabIndex = -1; th.setAttribute('aria-hidden', 'true');
  const body = el('div', 'pbody');
  const head = el('div', 'phead');
  const h = el('h3', 'ptitle'); const link = el('a', 'ptitle-link', prodTitle(r)); link.href = href; h.append(link);
  head.append(h, el('span', 'badge badge-' + r.status, t('status.' + r.status)));
  const meta = el('p', 'pmeta');
  const dcol = ORG_DATE_COL[r.status];
  if (dcol && r[dcol]) meta.append(el('span', null, t('org.date.' + r.status, { date: fmtDate(r[dcol], false) })));
  meta.append(el('span', null, t('plist.updated', { date: fmtDate(r.updated_at, true) })));
  const who = (r.contributor && r.contributor.full_name) || t('alist.unknown');
  const L2 = O.links[r.id] || { n: [], m: [] };
  const acts = el('div', 'pactions');
  const open = el('a', 'btn btn-secondary btn-sm', t('org.open')); open.href = href;
  const trash = el('button', 'btn btn-danger-ghost btn-sm', t('org.trash')); trash.type = 'button';
  trash.addEventListener('click', () => askTrash(r));
  acts.append(open, trash);
  body.append(head, el('p', 'pby', t('alist.by', { name: who })), meta,
    tagLine('org.niche', L2.n.map(nicheLabel).filter(Boolean)), tagLine('org.micro', L2.m.map(microLabel).filter(Boolean)), acts);
  card.append(th, body);
  return card;
}
function askTrash(r) {
  confirmModal({
    titleKey: 'org.trashTitle', bodyText: t('org.trashBody', { name: prodTitle(r) }), confirmKey: 'org.trashConfirm', danger: true,
    onConfirm: async () => {
      try {
        const { error } = await withLoading(() => sb.rpc('trash_product', { p_product_id: r.id }));   // existing secure RPC
        if (error) throw error;
      } catch (e) { return authErrorKey(e); }
      toast('success', 'toast.trashed');
      pagerDrop(O, r.id);
      return null;
    }
  });
}
function renderOrg() {
  const body = $('module-body');
  O.sig = state.lang;
  body.replaceChildren();
  const wrap = el('div', 'plist');
  const tools = el('div', 'plist-tools');
  const s = buildSearch(O, 'org-q', () => pagerApply(O));
  const cg = buildChipGroup([''].concat(ADMIN_STATUSES), (v) => t(v ? 'status.' + v : 'plist.all'), O.status, (v) => pagerSetStatus(O, v), 'plist.filterLabel');
  const filters = el('div', 'org-filters');
  const nsel = selectEl('org-niche', 'org.niche', [['', t('org.allNiches')]], ''), msel = selectEl('org-micro', 'org.micro', [['', t('org.allMicros')]], '');
  nsel.addEventListener('change', () => setOrgNiche(nsel.value));
  msel.addEventListener('change', () => setOrgMicro(msel.value));
  const clr = el('button', 'btn btn-ghost btn-sm', t('plist.clearFilters')); clr.type = 'button';
  clr.addEventListener('click', () => pagerClear(O));
  filters.append(nsel, msel, clr);
  tools.append(s.sw, cg.box, filters);
  const summary = el('p', 'hint plist-summary'); summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', 'plist-grid'), stateBox = el('div', 'plist-state'), more = el('div', 'plist-more');
  wrap.append(el('p', 'hint org-intro', t('org.intro')), tools, summary, grid, stateBox, more);
  body.append(wrap);
  O.els = { input: s.input, clear: s.clear, chips: cg.chips, niche: nsel, micro: msel, summary, grid, state: stateBox, more };
  fillOrgSelects();
  pagerAppend(O, O.rows);
  pagerPaint(O);
}

/* ----- Recycle Bin ----- */
const CL = { n: null, running: false, failed: false };   // storage cleanup queue state
function enterBin() { B.active = true; renderBin(); pagerLoad(B, true); refreshCleanup(true); }
function leaveBin() { pagerLeave(B); }
function resetBin() { leaveBin(); B.q = ''; B.term = ''; B.status = ''; CL.n = null; CL.running = false; CL.failed = false; }

function buildBinCard(r) {
  const card = el('div', 'pcard ocard');
  const th = pagerThumb(B, r, 'div');
  const body = el('div', 'pbody');
  const head = el('div', 'phead');
  head.append(el('h3', 'ptitle', prodTitle(r)), el('span', 'badge badge-' + r.status, t('status.' + r.status)));
  const by = (r.deleter && r.deleter.full_name) || t('alist.unknown');
  const meta = el('p', 'pmeta');
  meta.append(el('span', null, t('bin.deletedOn', { date: fmtDate(r.deleted_at, true) })), el('span', null, t('bin.deletedBy', { name: by })));
  const owner = (r.contributor && r.contributor.full_name) || t('alist.unknown');
  const acts = el('div', 'pactions');
  const rest = el('button', 'btn btn-secondary btn-sm', t('bin.restore')); rest.type = 'button';
  rest.addEventListener('click', () => restoreProduct(r, rest));
  const purge = el('button', 'btn btn-danger btn-sm', t('bin.purge')); purge.type = 'button';
  purge.addEventListener('click', () => openPurge(r));
  acts.append(rest, purge);
  body.append(head, el('p', 'pby', t('alist.by', { name: owner })), meta, acts);
  card.append(th, body);
  return card;
}
async function restoreProduct(r, btn) {
  btn.disabled = true;
  try {
    const { error } = await withLoading(() => sb.rpc('restore_product', { p_product_id: r.id }));   // existing secure RPC
    if (error) throw error;
  } catch (e) {
    btn.disabled = false;
    toast('error', authErrorKey(e));
    if (/not_in_recycle_bin|not_found/.test(String((e && e.message) || ''))) pagerLoad(B, true);
    return;
  }
  toast('success', 'toast.restored');
  pagerDrop(B, r.id);
}
function openPurge(r) {
  const word = t(PURGE_WORD_KEY);
  openModal('bin.purgeTitle', (body) => {
    body.append(el('p', null, t('bin.purgeBody', { name: prodTitle(r) })), el('p', 'hint', t('bin.purgeWarn')));
    const w = el('div', 'field');
    const lab = el('label', null, t('bin.confirmLabel', { word })); lab.htmlFor = 'purge-confirm';
    const inp = el('input'); inp.id = 'purge-confirm'; inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
    inp.setAttribute('autocapitalize', 'off');
    w.append(lab, inp);
    const err = el('p', 'error'); err.setAttribute('role', 'alert'); err.hidden = true;
    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn btn-ghost', t('common.cancel')); cancel.type = 'button';
    cancel.addEventListener('click', closeModal);
    const ok = el('button', 'btn btn-danger', t('bin.purgeConfirm')); ok.type = 'button'; ok.disabled = true;
    inp.addEventListener('input', () => { ok.disabled = inp.value.trim().toLowerCase() !== word.toLowerCase(); });
    ok.addEventListener('click', async () => {
      if (ok.disabled || inp.value.trim().toLowerCase() !== word.toLowerCase()) return;
      ok.disabled = true; err.hidden = true;
      try {
        const { error } = await withLoading(() => sb.rpc('purge_product', { p_product_id: r.id }));   // only possible for products in the bin
        if (error) throw error;
      } catch (e) {
        err.textContent = t(authErrorKey(e)); err.hidden = false; ok.disabled = false; return;
      }
      closeModal();
      pagerDrop(B, r.id);
      toast('success', 'toast.purged');
      runCleanup();   // Storage files were queued by purge_product(): remove them now
    });
    actions.append(cancel, ok);
    body.append(w, err, actions);
    inp.focus();
  });
}

/* Storage cleanup: purge_product() queues the file paths; here they are removed through the Storage API,
   then acknowledged with ack_cleanup_queue(). Anything that fails stays queued and can be retried. */
async function cleanupCount() {
  const r = await sb.from('storage_cleanup_queue').select('id', { count: 'exact', head: true });
  if (r.error) throw r.error;
  return r.count || 0;
}
async function drainQueue() {
  let ok = true, after = 0;
  for (;;) {
    const r = await sb.from('storage_cleanup_queue').select('id, bucket, path').gt('id', after).order('id').limit(100);
    if (r.error) throw r.error;
    const rows = r.data || [];
    if (!rows.length) break;
    after = rows[rows.length - 1].id;
    const byBucket = {};
    rows.forEach((x) => { (byBucket[x.bucket] = byBucket[x.bucket] || []).push(x); });
    for (const bucket of Object.keys(byBucket)) {
      const items = byBucket[bucket];
      const rm = await sb.storage.from(bucket).remove(items.map((x) => x.path));
      if (rm.error) { ok = false; continue; }
      const ack = await sb.rpc('ack_cleanup_queue', { p_ids: items.map((x) => x.id) });
      if (ack.error) ok = false;
    }
  }
  return ok;
}
async function refreshCleanup(auto) {
  try { CL.n = await cleanupCount(); CL.failed = false; } catch (e) { CL.n = null; CL.failed = true; }
  paintCleanup();
  if (auto && CL.n > 0) runCleanup();
}
async function runCleanup() {
  if (CL.running) return;
  CL.running = true; CL.failed = false; paintCleanup();
  let ok = true;
  try { ok = await drainQueue(); } catch (e) { ok = false; }
  try { CL.n = await cleanupCount(); } catch (e) { CL.n = null; ok = false; }
  CL.running = false; CL.failed = !ok || (CL.n || 0) > 0;
  paintCleanup();
  if (CL.failed) toast('error', 'err.cleanup'); else toast('success', 'toast.cleanupDone');
}
function paintCleanup() {
  const box = B.els && B.els.banner;
  if (!box) return;
  box.replaceChildren();
  const show = CL.running || CL.failed || (CL.n || 0) > 0;
  box.hidden = !show;
  if (!show) return;
  if (CL.running) { box.append(el('p', null, t('bin.cleanupRunning'))); return; }
  box.append(el('p', null, CL.n > 0 ? t('bin.cleanupPending', { n: CL.n }) : t('err.cleanup')));
  const retry = el('button', 'btn btn-secondary btn-sm', t('bin.cleanupRetry')); retry.type = 'button';
  retry.addEventListener('click', runCleanup);
  box.append(retry);
}
function renderBin() {
  const body = $('module-body');
  B.sig = state.lang;
  body.replaceChildren();
  const wrap = el('div', 'plist');
  const tools = el('div', 'plist-tools');
  const s = buildSearch(B, 'bin-q', () => pagerApply(B));
  const cg = buildChipGroup([''].concat(ADMIN_STATUSES), (v) => t(v ? 'status.' + v : 'plist.all'), B.status, (v) => pagerSetStatus(B, v), 'plist.filterLabel');
  tools.append(s.sw, cg.box);
  const banner = el('div', 'cleanup-banner'); banner.setAttribute('role', 'status'); banner.hidden = true;
  const summary = el('p', 'hint plist-summary'); summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', 'plist-grid'), stateBox = el('div', 'plist-state'), more = el('div', 'plist-more');
  wrap.append(el('p', 'hint org-intro', t('bin.intro')), banner, tools, summary, grid, stateBox, more);
  body.append(wrap);
  B.els = { input: s.input, clear: s.clear, chips: cg.chips, banner, summary, grid, state: stateBox, more };
  pagerAppend(B, B.rows);
  pagerPaint(B); paintCleanup();
}

/* =====================================================================
   Phase 11B — Micro-niches (Niche → Micro-niche → Product), admin management
   ===================================================================== */
const M = { active: false, q: '', niche: '', state: '', sig: null, seq: 0, loading: false, error: null, timer: null, els: {} };
const MICRO_NAME_COLS = ['name_ar', 'name_fr', 'name_en'];

function enterMicro() {
  M.active = true; M.loading = true; M.error = null;
  renderMicro();
  const seq = ++M.seq;
  loadLookups(true).then(() => { if (seq === M.seq && M.active) { M.loading = false; renderMicro(); } })
    .catch((e) => { if (seq === M.seq && M.active) { M.loading = false; M.error = authErrorKey(e); paintMicro(); } });
}
function leaveMicro() { M.active = false; M.seq++; clearTimeout(M.timer); M.loading = false; M.error = null; M.els = {}; M.sig = null; }
function resetMicro() { leaveMicro(); M.q = ''; M.niche = ''; M.state = ''; }

function visibleMicros() {
  const term = normalizeName(M.q).slice(0, 100);
  return P.micros.filter((m) => {
    if (M.niche === 'none' ? m.niche_id : (M.niche && m.niche_id !== M.niche)) return false;
    if (M.state && (M.state === 'active') !== m.is_active) return false;
    if (!term) return true;
    const hay = MICRO_NAME_COLS.map((c) => m[c] || '').concat(nicheLabel(m.niche_id)).join(' ');
    return normalizeName(hay).includes(term);
  });
}
function buildMicroCard(m) {
  const card = el('div', 'pcard mcard' + (m.is_active ? '' : ' is-off'));
  const body = el('div', 'pbody');
  const head = el('div', 'phead');
  head.append(el('h3', 'ptitle', locName(m, 'name_')), el('span', 'badge ' + (m.is_active ? 'badge-accepted' : 'badge-rejected'), t(m.is_active ? 'micro.active' : 'micro.inactive')));
  const title = locName(m, 'name_');
  const others = MICRO_NAME_COLS.map((c) => m[c]).filter((v) => v && v !== title);
  const parent = el('div', 'ptag-line');
  parent.append(el('span', 'ptag-label', t('micro.parent')));
  if (m.niche_id && nicheLabel(m.niche_id)) parent.append(el('span', 'tag', nicheLabel(m.niche_id)));
  else parent.append(el('span', 'tag tag-warn', t('micro.unassigned')));
  const acts = el('div', 'pactions');
  const edit = el('button', 'btn btn-secondary btn-sm', t('micro.edit')); edit.type = 'button';
  edit.addEventListener('click', () => openMicroModal(m));
  const tog = el('button', 'btn btn-ghost btn-sm', t(m.is_active ? 'micro.deactivate' : 'micro.activate')); tog.type = 'button';
  tog.addEventListener('click', () => toggleMicro(m, tog));
  const del = el('button', 'btn btn-danger-ghost btn-sm', t('micro.delete')); del.type = 'button';
  del.addEventListener('click', () => askDeleteMicro(m));
  acts.append(edit, tog, del);
  body.append(head);
  if (others.length) { const o = el('p', 'pmeta', others.join(' · ')); o.dir = 'auto'; body.append(o); }
  body.append(parent, acts);
  card.append(body);
  return card;
}
function paintMicro() {
  const E = M.els;
  if (!E.grid) return;
  E.state.replaceChildren(); E.grid.replaceChildren();
  E.state.classList.remove('plist-grid');
  if (M.loading) {
    for (let i = 0; i < 4; i++) { const sk = el('div', 'pcard pcard-sk'); const b = el('div', 'pbody'); b.append(el('div', 'skeleton sk-title'), el('div', 'skeleton sk-line short')); sk.append(b); E.state.append(sk); }
    E.state.classList.add('plist-grid'); E.summary.textContent = ''; return;
  }
  if (M.error) {
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button'; retry.addEventListener('click', enterMicroRetry);
    const box = listStateBox('!', 'plist.errorTitle', null, null); box.append(el('p', 'error', t(M.error)), retry);
    E.state.append(box); E.summary.textContent = ''; return;
  }
  const rows = visibleMicros();
  E.summary.textContent = rows.length ? t('plist.shown', { n: rows.length }) : '';
  if (!rows.length) {
    if (M.q.trim() || M.niche || M.state) {
      const clear = el('button', 'btn btn-secondary', t('plist.clearFilters')); clear.type = 'button';
      clear.addEventListener('click', () => { M.q = ''; M.niche = ''; M.state = ''; renderMicro(); });
      E.state.append(listStateBox('⌕', 'plist.noResultsTitle', 'plist.noResultsBody', clear));
    } else {
      const add = el('button', 'btn btn-primary', '＋ ' + t('micro.add')); add.type = 'button'; add.addEventListener('click', () => openMicroModal(null));
      E.state.append(listStateBox('◈', 'micro.emptyTitle', 'micro.emptyBody', add));
    }
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach((m) => frag.append(buildMicroCard(m)));
  E.grid.append(frag);
}
function enterMicroRetry() { leaveMicro(); enterMicro(); }
function renderMicro() {
  const body = $('module-body');
  M.sig = state.lang;
  body.replaceChildren();
  const wrap = el('div', 'plist');
  const tools = el('div', 'plist-tools');
  const s = buildSearch(M, 'micro-q', () => paintMicro());
  const cg = buildChipGroup(['', 'active', 'inactive'], (v) => t(v ? 'micro.' + v : 'plist.all'), M.state, (v) => { M.state = v; syncChips(M.els.chips, v); paintMicro(); }, 'plist.filterLabel');
  const filters = el('div', 'org-filters');
  const nopts = [['', t('org.allNiches')], ['none', t('micro.noParentFilter')]].concat(P.niches.map((n) => [n.id, locName(n, 'name_')]));
  const nsel = selectEl('micro-niche-filter', 'org.niche', nopts, M.niche);
  nsel.addEventListener('change', () => { M.niche = nsel.value; paintMicro(); });
  const add = el('button', 'btn btn-primary btn-sm', '＋ ' + t('micro.add')); add.type = 'button';
  add.addEventListener('click', () => openMicroModal(null));
  filters.append(nsel, add);
  tools.append(s.sw, cg.box, filters);
  const summary = el('p', 'hint plist-summary'); summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', 'plist-grid'), stateBox = el('div', 'plist-state');
  wrap.append(el('p', 'hint org-intro', t('micro.intro')), tools, summary, grid, stateBox);
  body.append(wrap);
  M.els = { chips: cg.chips, summary, grid, state: stateBox };
  paintMicro();
}
function openMicroModal(row) {
  const edit = !!row;
  openModal(edit ? 'micro.editTitle' : 'micro.addTitle', (body) => {
    const form = el('form'); form.noValidate = true;
    const inputs = {};
    [['name_ar', 'micro.nameAr', 'rtl'], ['name_fr', 'micro.nameFr', 'ltr'], ['name_en', 'micro.nameEn', 'ltr']].forEach(([c, lk, dir]) => {
      const w = el('div', 'field'); const lab = el('label', null, t(lk)); lab.htmlFor = 'mn-' + c;
      const inp = el('input'); inp.type = 'text'; inp.id = 'mn-' + c; inp.maxLength = 100; inp.dir = dir; inp.value = (row && row[c]) || '';
      inputs[c] = inp; w.append(lab, inp); form.append(w);
    });
    const pw = el('div', 'field'); const pl = el('label', null, t('micro.parent') + ' *'); pl.htmlFor = 'mn-parent';
    const psel = el('select'); psel.id = 'mn-parent';
    const ph = el('option', null, t('micro.parentPh')); ph.value = ''; psel.append(ph);
    P.niches.filter((n) => n.is_active || (row && row.niche_id === n.id)).forEach((n) => { const o = el('option', null, locName(n, 'name_')); o.value = n.id; psel.append(o); });
    psel.value = (row && row.niche_id) || ''; if (psel.value !== ((row && row.niche_id) || '')) psel.value = '';
    pw.append(pl, psel);
    if (!P.niches.length) pw.append(el('p', 'hint', t('micro.noNiches')));
    form.append(pw);
    const aw = el('div', 'field'); const al = el('label', null, t('micro.state')); al.htmlFor = 'mn-active';
    const asel = el('select'); asel.id = 'mn-active';
    [['1', 'micro.active'], ['0', 'micro.inactive']].forEach(([v, k]) => { const o = el('option', null, t(k)); o.value = v; asel.append(o); });
    asel.value = !row || row.is_active ? '1' : '0';
    aw.append(al, asel); form.append(aw);
    const err = el('p', 'error'); err.setAttribute('role', 'alert'); err.hidden = true;
    const actions = el('div', 'modal-actions');
    const cancel = el('button', 'btn btn-ghost', t('common.cancel')); cancel.type = 'button'; cancel.addEventListener('click', closeModal);
    const save = el('button', 'btn btn-primary', t('common.save')); save.type = 'submit';
    actions.append(cancel, save); form.append(err, actions);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (save.disabled) return;
      save.disabled = true;
      const key = await saveMicro(row, { name_ar: inputs.name_ar.value, name_fr: inputs.name_fr.value, name_en: inputs.name_en.value, niche_id: psel.value, active: asel.value === '1' });
      save.disabled = false;
      if (key) { err.textContent = t(key); err.hidden = false; } else closeModal();
    });
    body.append(form);
    (edit ? inputs.name_ar : inputs.name_ar).focus();
  });
}
/* Returns a translation key on error, null on success (same contract as formModal) */
async function saveMicro(row, v) {
  const names = {};
  for (const c of MICRO_NAME_COLS) {
    if (!String(v[c]).trim()) { names[c] = null; continue; }
    const r = validateNicheName(v[c]);
    if (r.key) return r.key === 'err.nicheLong' ? 'err.microLong' : 'err.microInvalid';
    names[c] = r.name;
  }
  if (!MICRO_NAME_COLS.some((c) => names[c])) return 'err.microNeedName';
  if (!v.niche_id) return 'err.microParent';
  const dup = P.micros.some((m) => (!row || m.id !== row.id) && m.niche_id === v.niche_id &&
    MICRO_NAME_COLS.some((c) => m[c] && names[c] && normalizeName(m[c]) === normalizeName(names[c])));
  if (dup) return 'err.microDuplicate';
  try {
    const payload = Object.assign({}, names, { niche_id: v.niche_id, is_active: v.active });
    const { data, error } = await withLoading(() => row
      ? sb.from('micro_niches').update(payload).eq('id', row.id).select(MICRO_COLS).single()
      : sb.from('micro_niches').insert(Object.assign({ created_by: state.profile.id }, payload)).select(MICRO_COLS).single());
    if (error) throw error;
    if (row) P.micros = P.micros.map((m) => (m.id === row.id ? data : m)); else P.micros.push(data);
    sortMicros();
    if (M.active) paintMicro();
    toast('success', 'toast.microSaved');
    return null;
  } catch (e) {
    if (e && e.code === '23505') return 'err.microDuplicate';
    return authErrorKey(e);
  }
}
async function toggleMicro(m, btn) {
  btn.disabled = true;
  try {
    const { data, error } = await withLoading(() => sb.from('micro_niches').update({ is_active: !m.is_active }).eq('id', m.id).select(MICRO_COLS).single());
    if (error) throw error;
    P.micros = P.micros.map((x) => (x.id === m.id ? data : x));
    toast('success', 'toast.microSaved');
  } catch (e) { toast('error', authErrorKey(e)); }
  if (M.active) paintMicro();
}
function askDeleteMicro(m) {
  confirmModal({
    titleKey: 'micro.deleteTitle', bodyText: t('micro.deleteBody', { name: locName(m, 'name_') }), confirmKey: 'micro.delete', danger: true,
    onConfirm: async () => {
      try {
        const { data, error } = await withLoading(() => sb.from('micro_niches').delete().eq('id', m.id).select('id'));
        if (error) throw error;
        if (!data || !data.length) throw { code: '42501', message: 'auth.forbidden' };
      } catch (e) { return e && e.code === '23503' ? 'err.microInUse' : authErrorKey(e); }   // still used by products: deactivate instead
      P.micros = P.micros.filter((x) => x.id !== m.id);
      if (M.active) paintMicro();
      toast('success', 'toast.microDeleted');
      return null;
    }
  });
}

/* =====================================================================
   Phase 11A — Admin User Management
   Reads go through RLS (admins read all profiles). Every privileged change
   (create / edit / enable / disable / role / password / delete) is done by the
   "admin-users" Edge Function, which re-checks that the caller is an active admin and
   uses the service-role key ONLY on the server. No privileged key exists in the browser.
   ===================================================================== */
const USER_COLS = 'id, full_name, email, phone, gender, role, is_active, avatar_id, created_at';
const U = { active: false, loaded: false, loading: false, error: null, rows: [], q: '', role: '', status: '', sig: null, seq: 0, timer: null, els: {} };

async function adminUsers(action, payload) {
  const { data, error } = await sb.functions.invoke('admin-users', { body: Object.assign({ action }, payload) });
  if (error) {
    let code = '';
    try { const ctx = error.context; if (ctx && ctx.status === 404) code = 'user.function_unavailable'; else if (ctx && ctx.json) code = (await ctx.json()).error || ''; } catch (e) { /* keep generic */ }
    throw { name: error.name, message: code || String(error.message || '') };
  }
  if (data && data.error) throw { message: data.error };
  return data;
}
function enterUsers() { U.active = true; renderUsers(); loadUsers(); }
function leaveUsers() { U.active = false; U.seq++; clearTimeout(U.timer); U.loading = false; U.els = {}; U.sig = null; }
function resetUsers() { leaveUsers(); U.rows = []; U.loaded = false; U.error = null; U.q = ''; U.role = ''; U.status = ''; }
async function loadUsers() {
  const seq = ++U.seq;
  U.loading = true; U.error = null; paintUsers();
  try {
    const { data, error } = await sb.from('profiles').select(USER_COLS).order('created_at', { ascending: true });
    if (error) throw error;
    if (seq !== U.seq || !U.active) return;
    U.rows = data || []; U.loaded = true; U.loading = false;
  } catch (e) {
    if (seq !== U.seq || !U.active) return;
    U.loading = false; U.error = authErrorKey(e);
  }
  paintUsers();
}
function visibleUsers() {
  const term = normalizeName(U.q).slice(0, 100);
  return U.rows.filter((u) => (!U.role || u.role === U.role) && (!U.status || (U.status === 'active') === u.is_active) &&
    (!term || normalizeName(u.full_name + ' ' + u.email).includes(term)));
}
function buildUserCard(u) {
  const mine = u.id === state.profile.id;
  const card = el('div', 'pcard ucard' + (u.is_active ? '' : ' is-off'));
  const av = el('div', 'avatar'); renderAvatar(av, u);
  const body = el('div', 'pbody');
  const head = el('div', 'phead');
  const h = el('h3', 'ptitle', u.full_name); if (mine) h.append(' ', el('span', 'badge', t('users.you')));
  head.append(h);
  const em = el('p', 'pmeta u-email', u.email); em.dir = 'ltr';
  const badges = el('div', 'u-badges');
  badges.append(el('span', 'badge', t('role.' + u.role)), el('span', 'badge ' + (u.is_active ? 'badge-accepted' : 'badge-rejected'), t(u.is_active ? 'users.active' : 'users.disabled')));
  const meta = el('p', 'pmeta', t('users.created', { date: fmtDate(u.created_at, false) }));
  const manage = el('button', 'btn btn-secondary btn-sm', t('users.manage')); manage.type = 'button';
  manage.addEventListener('click', () => openUserModal(u.id));
  const acts = el('div', 'pactions'); acts.append(manage);
  body.append(head, em, badges, meta, acts);
  card.append(av, body);
  return card;
}
function paintUsers() {
  const E = U.els;
  if (!E.grid) return;
  E.state.replaceChildren(); E.grid.replaceChildren(); E.state.classList.remove('plist-grid');
  if (U.loading && !U.loaded) {
    for (let i = 0; i < 4; i++) { const sk = el('div', 'pcard pcard-sk'); sk.append(el('div', 'pthumb skeleton')); const b = el('div', 'pbody'); b.append(el('div', 'skeleton sk-title'), el('div', 'skeleton sk-line short')); sk.append(b); E.state.append(sk); }
    E.state.classList.add('plist-grid'); E.summary.textContent = ''; return;
  }
  if (U.error && !U.loaded) {
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button'; retry.addEventListener('click', loadUsers);
    const box = listStateBox('!', 'plist.errorTitle', null, null); box.append(el('p', 'error', t(U.error)), retry);
    E.state.append(box); E.summary.textContent = ''; return;
  }
  const rows = visibleUsers();
  E.summary.textContent = rows.length ? t('users.count', { n: rows.length }) : '';
  if (!rows.length) {
    if (U.q.trim() || U.role || U.status) {
      const clear = el('button', 'btn btn-secondary', t('plist.clearFilters')); clear.type = 'button';
      clear.addEventListener('click', () => { U.q = ''; U.role = ''; U.status = ''; renderUsers(); });
      E.state.append(listStateBox('⌕', 'plist.noResultsTitle', 'plist.noResultsBody', clear));
    } else E.state.append(listStateBox('☺', 'users.emptyTitle', 'users.emptyBody', null));
    return;
  }
  const frag = document.createDocumentFragment();
  rows.forEach((u) => frag.append(buildUserCard(u)));
  E.grid.append(frag);
  if (U.error) E.state.append(el('p', 'error', t(U.error)));
}
function renderUsers() {
  const body = $('module-body');
  U.sig = state.lang;
  body.replaceChildren();
  const wrap = el('div', 'plist');
  const tools = el('div', 'plist-tools');
  const s = buildSearch(U, 'users-q', () => paintUsers());
  s.input.placeholder = t('users.search'); s.input.setAttribute('aria-label', t('users.search'));
  const rg = buildChipGroup(['', 'admin', 'contributor'], (v) => t(v ? 'role.' + v : 'plist.all'), U.role, (v) => { U.role = v; syncChips(U.els.roleChips, v); paintUsers(); }, 'users.roleFilter');
  const sg = buildChipGroup(['', 'active', 'disabled'], (v) => t(v ? 'users.' + v : 'plist.all'), U.status, (v) => { U.status = v; syncChips(U.els.statusChips, v); paintUsers(); }, 'users.statusFilter');
  const add = el('button', 'btn btn-primary btn-sm', '＋ ' + t('users.add')); add.type = 'button'; add.addEventListener('click', openCreateUser);
  const row = el('div', 'org-filters'); row.append(sg.box, add);
  tools.append(s.sw, rg.box, row);
  const summary = el('p', 'hint plist-summary'); summary.setAttribute('role', 'status'); summary.setAttribute('aria-live', 'polite');
  const grid = el('div', 'plist-grid'), stateBox = el('div', 'plist-state');
  wrap.append(tools, summary, grid, stateBox);
  body.append(wrap);
  U.els = { roleChips: rg.chips, statusChips: sg.chips, summary, grid, state: stateBox };
  paintUsers();
}

/* ----- user actions ----- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function userFieldError(v, needPassword) {
  if (!v.full_name || Array.from(v.full_name).length > 80) return 'err.nameInvalid';
  if (!EMAIL_RE.test(v.email || '') || v.email.length > 254) return 'err.emailInvalid';
  if (v.phone && v.phone.length > 30) return 'err.phoneLong';
  if (needPassword && (!v.password || v.password.length < 8 || v.password.length > 72)) return 'err.passwordInvalid';
  return null;
}
async function userCall(action, payload, toastKey) {   // returns a translation key on error, null on success
  try { await withLoading(() => adminUsers(action, payload)); } catch (e) { return authErrorKey(e); }
  toast('success', toastKey);
  loadUsers();
  return null;
}
const ROLE_OPTIONS = [['contributor', 'role.contributor'], ['admin', 'role.admin']];
const GENDER_OPTIONS = [['', 'gender.unset'], ['male', 'gender.male'], ['female', 'gender.female']];
function openCreateUser() {
  formModal('users.addTitle', [
    { name: 'full_name', label: 'users.name', value: '', max: 80 },
    { name: 'email', label: 'users.email', value: '', max: 254, dir: 'ltr', auto: 'off' },
    { name: 'password', label: 'users.password', value: '', max: 72, type: 'password', auto: 'new-password', dir: 'ltr' },
    { name: 'role', label: 'users.role', value: 'contributor', options: ROLE_OPTIONS }
  ], (v) => userFieldError(v, true) || userCall('create', { full_name: v.full_name, email: v.email, password: v.password, role: v.role }, 'toast.userCreated'));
}
function openEditUser(u) {
  formModal('users.editTitle', [
    { name: 'full_name', label: 'users.name', value: u.full_name, max: 80 },
    { name: 'email', label: 'users.email', value: u.email, max: 254, dir: 'ltr' },
    { name: 'phone', label: 'users.phone', value: u.phone, max: 30, dir: 'ltr' },
    { name: 'gender', label: 'users.gender', value: u.gender || '', options: GENDER_OPTIONS }
  ], (v) => userFieldError(v, false) || userCall('update', { id: u.id, full_name: v.full_name, email: v.email, phone: v.phone, gender: v.gender }, 'toast.userUpdated'));
}
function openPasswordUser(u) {
  formModal('users.passwordTitle', [
    { name: 'password', label: 'users.newPassword', value: '', max: 72, type: 'password', auto: 'new-password', dir: 'ltr' },
    { name: 'confirm', label: 'users.passwordConfirm', value: '', max: 72, type: 'password', auto: 'new-password', dir: 'ltr' }
  ], (v) => {
    if (!v.password || v.password.length < 8 || v.password.length > 72) return 'err.passwordInvalid';
    if (v.password !== v.confirm) return 'err.passwordMismatch';
    return userCall('set_password', { id: u.id, password: v.password }, 'toast.passwordChanged');
  });
}
function openRoleUser(u) {
  formModal('users.roleTitle', [{ name: 'role', label: 'users.role', value: u.role, options: ROLE_OPTIONS }],
    (v) => (v.role === u.role ? null : userCall('set_role', { id: u.id, role: v.role }, 'toast.roleChanged')));
}
function openActiveUser(u) {
  const off = u.is_active;
  confirmModal({
    titleKey: off ? 'users.disableTitle' : 'users.enableTitle', bodyText: t(off ? 'users.disableBody' : 'users.enableBody', { name: u.full_name }),
    confirmKey: off ? 'users.disable' : 'users.enable', danger: off,
    onConfirm: () => userCall('set_active', { id: u.id, active: !off }, off ? 'toast.userDisabled' : 'toast.userEnabled')
  });
}
function openDeleteUser(u) {
  confirmModal({
    titleKey: 'users.deleteTitle', bodyText: t('users.deleteBody', { name: u.full_name }), confirmKey: 'users.delete', danger: true,
    onConfirm: () => userCall('delete', { id: u.id }, 'toast.userDeleted')
  });
}
function openUserModal(id) {
  const u = U.rows.find((x) => x.id === id);
  if (!u) return;
  const mine = u.id === state.profile.id;
  openModal('users.details', (body) => {
    $('modal').classList.add('modal-wide');
    const top = el('div', 'u-top');
    const av = el('div', 'avatar avatar-lg'); renderAvatar(av, u);
    const nm = el('div'); nm.append(el('p', 'pc-name', u.full_name), el('p', 'hint u-email', u.email));
    nm.lastChild.dir = 'ltr';
    top.append(av, nm);
    const dl = el('dl', 'rv-fields');
    const fld = (k, v, dir) => { const d = el('div', 'rv-field'); d.append(el('dt', null, t(k))); const dd = el('dd', v ? null : 'rv-empty', v || '—'); if (dir && v) dd.dir = dir; d.append(dd); return d; };
    dl.append(fld('users.name', u.full_name), fld('users.email', u.email, 'ltr'), fld('users.phone', u.phone, 'ltr'),
      fld('users.gender', u.gender ? t('gender.' + u.gender) : ''), fld('users.role', t('role.' + u.role)),
      fld('users.status', t(u.is_active ? 'users.active' : 'users.disabled')), fld('users.createdLabel', fmtDate(u.created_at, true)));
    const acts = el('div', 'u-actions');
    const btn = (key, cls, fn, disabled) => { const b = el('button', 'btn ' + cls, t(key)); b.type = 'button'; b.disabled = !!disabled; b.addEventListener('click', fn); acts.append(b); };
    btn('users.editInfo', 'btn-secondary', () => openEditUser(u));
    btn('users.changePassword', 'btn-secondary', () => openPasswordUser(u));
    btn('users.changeRole', 'btn-secondary', () => openRoleUser(u), mine);
    btn(u.is_active ? 'users.disable' : 'users.enable', 'btn-secondary', () => openActiveUser(u), mine);
    btn('users.delete', 'btn-danger', () => openDeleteUser(u), mine);
    body.append(top, dl, acts);
    if (mine) body.append(el('p', 'hint', t('users.selfNote')));
  });
}

/* =====================================================================
   Phase 13 — Chat (frontend only; built on the existing chat tables, RPCs, RLS and private Storage)
   Writes: ONLY through the existing RPCs (get_or_create_direct_conversation, create_group, add_member,
   remove_member, leave_conversation, send_message, mark_conversation_read) + the member's own pseudo
   (allowed UPDATE policy) + Storage uploads to the private chat buckets under <conversation_id>/.
   Realtime: ONE channel, tables "messages" and "conversation_members" (RLS-filtered by the server).
   The channel lives from sign-in to sign-out (so the unread dot works everywhere); stopChat() tears it down.
   ===================================================================== */
const CHAT_PAGE = 30;
const CHAT_MAX_ATTACH = 10;
const CHAT_KINDS = {
  image: { bucket: 'chat-images', max: 10485760, mimes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'], accept: 'image/jpeg,image/png,image/webp,image/gif' },
  video: { bucket: 'chat-videos', max: 52428800, mimes: ['video/mp4', 'video/webm', 'video/quicktime'], accept: 'video/mp4,video/webm,video/quicktime' },
  file: { bucket: 'chat-files', max: 26214400, accept: '.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv',
    mimes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain', 'text/csv'] }
};
const CHAT_EXT_MIME = { pdf: 'application/pdf', doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', txt: 'text/plain', csv: 'text/csv' };
const CHAT_MSG_COLS = 'id, conversation_id, sender_id, kind, body, latitude, longitude, created_at, message_attachments(id, bucket, storage_path, file_name, mime_type, size_bytes, created_at)';
const ATT_COLS = 'id, message_id, bucket, storage_path, file_name, mime_type, size_bytes, created_at';

const CH = {
  uid: null, gen: 0, channel: null, rt: 'idle', subscribedOnce: false,
  dir: new Map(), dirLoaded: false,
  convs: [], loaded: false, listLoading: false, listError: null, listSeq: 0, listTimer: null, listDirty: false, listInflight: false,
  q: '', qTimer: null,
  view: false, sig: null, mobileConv: false, els: {},
  activeId: null, tok: 0, msgs: [], msgsLoading: false, msgsError: null, hasOlder: false, olderLoading: false, newBelow: 0,
  sending: false, stickUntil: 0, uploads: [], drafts: {}, adding: new Set(), sign: new Map(), markTimer: null, paintTimer: null, vv: null
};
const chatSignQ = { items: [], timer: null };
const chatTime = {};

/* ----- tiny helpers ----- */
const chatConv = (id) => CH.convs.find((c) => c.id === id) || null;
const chatActive = () => (CH.activeId ? chatConv(CH.activeId) : null);
function safeHttpUrl(u) {   // only http(s) ever reaches src / href
  try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.href : null; } catch (e) { return null; }
}
function chatMemberName(m) {
  if (!m) return t('chat.unknownUser');
  if (m.pseudo) return m.pseudo;
  const u = CH.dir.get(m.user_id);
  return u ? u.full_name : t('chat.unknownUser');
}
function chatUserName(uid) {
  const conv = chatActive();
  const m = conv && conv.members.find((x) => x.user_id === uid);
  if (m) return chatMemberName(m);
  const u = CH.dir.get(uid);
  return u ? u.full_name : t('chat.unknownUser');
}
function chatOther(conv) { return conv.members.find((m) => m.user_id !== CH.uid) || null; }
function chatConvName(conv) { return conv.type === 'group' ? (conv.name || '') : chatMemberName(chatOther(conv)); }
function chatAvatar(name, avatarId, cls) {
  const n = el('div', 'avatar chat-av' + (cls ? ' ' + cls : '')); n.setAttribute('aria-hidden', 'true');
  renderAvatar(n, { full_name: name || '?', avatar_id: avatarId || null });
  return n;
}
function chatConvAvatar(conv, cls) {
  if (conv.type === 'group') return chatAvatar(conv.name, null, 'chat-av-group ' + (cls || ''));
  const o = chatOther(conv), u = o && CH.dir.get(o.user_id);
  return chatAvatar(chatConvName(conv), u && u.avatar_id, cls);
}
function chatShortTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const key = state.lang;
  if (!chatTime[key]) chatTime[key] = new Intl.DateTimeFormat(DATE_LOCALE[key], { timeStyle: 'short' });
  return chatTime[key].format(d);
}
function chatListTime(iso) {
  if (!iso) return '';
  const d = new Date(iso), n = new Date();
  return d.toDateString() === n.toDateString() ? chatShortTime(iso) : fmtDate(iso, false);
}
function fmtSize(b) {
  const nf = new Intl.NumberFormat(DATE_LOCALE[state.lang], { maximumFractionDigits: 1 });
  if (b >= 1048576) return nf.format(b / 1048576) + ' MB';
  if (b >= 1024) return nf.format(b / 1024) + ' KB';
  return nf.format(b) + ' B';
}
function chatPreview(conv) {
  const l = conv.last;
  if (!l) return t('chat.noMessagesShort');
  const who = l.sender_id === CH.uid ? t('chat.you') + ': ' : '';
  if (l.kind === 'text') return who + (l.body || '');
  return who + t('chat.kind.' + l.kind);
}
const chatNear = () => { const s = CH.els.msgs; return !s || s.scrollHeight - s.scrollTop - s.clientHeight < 90; };
function chatToBottom() { const s = CH.els.msgs; if (s) s.scrollTop = s.scrollHeight; }
function chatUnreadTotal() { return CH.convs.reduce((n, c) => n + (c.unread || 0), 0); }

/* ----- lifecycle ----- */
function startChat() {
  const p = state.profile;
  if (!p) return;
  if (CH.uid === p.id && CH.channel) return;   // never subscribe twice
  stopChat();
  CH.uid = p.id;
  const gen = CH.gen;
  chatSubscribe(p.id, gen);
  if (!state.avatars.length) loadAvatars().then(() => { if (gen === CH.gen) { chatPaintList(); chatPaintHeader(); } }).catch(() => {});
  chatLoadList();
}
function stopChat() {   // sign-out / session end: nothing carries over to the next user
  clearTimeout(CH.listTimer); clearTimeout(CH.qTimer); clearTimeout(CH.markTimer); clearTimeout(CH.paintTimer); clearTimeout(chatSignQ.timer);
  chatSignQ.items = []; chatSignQ.timer = null;
  if (CH.channel) {
    const ch = CH.channel; CH.channel = null;
    try { Promise.resolve(sb.removeChannel(ch)).catch(() => {}); } catch (e) { /* ignore */ }
  }
  chatViewport(false);
  CH.gen++; CH.tok++; CH.listSeq++;
  Object.assign(CH, { uid: null, rt: 'idle', subscribedOnce: false, dirLoaded: false, convs: [], loaded: false, listLoading: false, listError: null,
    listTimer: null, listDirty: false, listInflight: false, q: '', qTimer: null, view: false, sig: null, mobileConv: false, els: {},
    activeId: null, msgs: [], msgsLoading: false, msgsError: null, hasOlder: false, olderLoading: false, newBelow: 0, sending: false,
    uploads: [], markTimer: null, paintTimer: null });
  CH.dir = new Map(); CH.drafts = {}; CH.adding = new Set(); CH.sign = new Map();
  chatShell();
}
const resetChat = stopChat;

function chatSubscribe(uid, gen) {
  CH.rt = 'connecting';
  CH.channel = sb.channel('chat-' + uid)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (pl) => { if (gen === CH.gen) chatOnMessage(pl.new); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, (pl) => { if (gen === CH.gen) chatOnMember(pl); })
    .subscribe((status) => {
      if (gen !== CH.gen) return;
      if (status === 'SUBSCRIBED') {
        const again = CH.subscribedOnce;
        CH.rt = 'ok'; CH.subscribedOnce = true; chatPaintBanner();
        if (again) { chatLoadList(); chatCatchUp(); }   // re-subscribed after a dropped connection: catch up (client reconnects by itself)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        CH.rt = 'down'; chatPaintBanner();
      }
    });
}

/* ----- data: directory + conversation list ----- */
async function chatLoadDirectory(force) {
  if (CH.dirLoaded && !force) return;
  const gen = CH.gen;
  const r = await sb.from('user_directory').select('id, full_name, avatar_id, gender, role').order('full_name');   // active users only, no email/phone
  if (r.error) throw r.error;
  if (gen !== CH.gen) return;
  CH.dir = new Map((r.data || []).map((u) => [u.id, u]));
  CH.dirLoaded = true;
}
function chatSort() {
  CH.convs.sort((a, b) => (Date.parse(b.last_message_at || b.created_at) || 0) - (Date.parse(a.last_message_at || a.created_at) || 0));
}
function chatLoadList() {   // coalesced: one request in flight, at most one follow-up
  if (!CH.uid) return Promise.resolve();
  if (CH.listInflight) { CH.listDirty = true; return Promise.resolve(); }
  return chatDoLoadList();
}
async function chatDoLoadList() {
  const gen = CH.gen, seq = ++CH.listSeq;
  CH.listInflight = true; CH.listDirty = false;
  if (!CH.loaded) { CH.listLoading = true; chatPaintList(); }
  try {
    await chatLoadDirectory();
    const mine = await sb.from('conversation_members')
      .select('conversation_id, role, pseudo, last_read_at, joined_at, conversation:conversations(id, type, name, last_message_at, created_at)')
      .eq('user_id', CH.uid);
    if (mine.error) throw mine.error;
    const rows = (mine.data || []).filter((r) => r.conversation);
    const ids = rows.map((r) => r.conversation_id);
    let members = [], recent = [];
    if (ids.length) {
      const [m, w] = await Promise.all([
        sb.from('conversation_members').select('conversation_id, user_id, role, pseudo, last_read_at, joined_at').in('conversation_id', ids),
        sb.from('messages').select('id, conversation_id, sender_id, kind, body, created_at').in('conversation_id', ids)
          .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(200)   // ONE batched query for previews
      ]);
      if (m.error) throw m.error;
      members = m.data || []; recent = w.error ? [] : (w.data || []);
    }
    if (gen !== CH.gen) return;
    const lastBy = new Map();
    recent.forEach((x) => { if (!lastBy.has(x.conversation_id)) lastBy.set(x.conversation_id, x); });
    const convs = rows.map((r) => {
      const c = r.conversation;
      const ms = members.filter((x) => x.conversation_id === c.id);
      return { id: c.id, type: c.type, name: c.name, created_at: c.created_at, last_message_at: c.last_message_at, members: ms,
        me: ms.find((x) => x.user_id === CH.uid) || { role: r.role, pseudo: r.pseudo, last_read_at: r.last_read_at, user_id: CH.uid },
        last: lastBy.get(c.id) || null, unread: 0 };
    });
    // unread = messages from others newer than my last_read_at: exact counts only for conversations that can have some
    const cand = convs.filter((c) => c.last_message_at && (!c.me.last_read_at || c.last_message_at > c.me.last_read_at)).slice(0, 30);
    await Promise.all(cand.map(async (c) => {
      let q = sb.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id).neq('sender_id', CH.uid);
      if (c.me.last_read_at) q = q.gt('created_at', c.me.last_read_at);
      const r = await q;
      if (!r.error) c.unread = r.count || 0;
    }));
    // previews missing from the 200-message window (old, quiet conversations): a few single fetches, capped
    await Promise.all(convs.filter((c) => c.last_message_at && !c.last).slice(0, 15).map(async (c) => {
      const r = await sb.from('messages').select('id, conversation_id, sender_id, kind, body, created_at').eq('conversation_id', c.id)
        .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(1);
      if (!r.error && r.data && r.data[0]) c.last = r.data[0];
    }));
    if (gen !== CH.gen) return;
    if (seq === CH.listSeq) {
      const open = CH.activeId, openC = convs.find((c) => c.id === open);
      if (open && openC) openC.unread = chatActive() ? chatActive().unread : 0;   // keep what the open conversation already settled
      CH.convs = convs; chatSort();
      CH.loaded = true; CH.listError = null; CH.listLoading = false;
      if (open && !openC) chatUnavailable();
    }
  } catch (e) {
    if (gen !== CH.gen) return;
    CH.listLoading = false;
    if (!CH.loaded) CH.listError = authErrorKey(e);
  }
  if (gen !== CH.gen) return;
  CH.listInflight = false;
  chatPaintList(); chatPaintHeader(); chatShell();
  if (CH.listDirty) { CH.listDirty = false; chatLoadList(); }
}
function chatSoonReload() { clearTimeout(CH.listTimer); CH.listTimer = setTimeout(chatLoadList, 300); }

/* ----- realtime handlers ----- */
function chatSchedulePaint() { if (CH.paintTimer) return; CH.paintTimer = setTimeout(() => { CH.paintTimer = null; chatPaintList(); chatShell(); }, 60); }
async function chatOnMessage(m) {
  if (!m || !CH.uid) return;
  const conv = chatConv(m.conversation_id);
  if (!conv) { chatSoonReload(); return; }   // a conversation we do not know yet (the members INSERT event reloads too)
  if (!conv.last || m.created_at >= conv.last.created_at) conv.last = { id: m.id, conversation_id: m.conversation_id, sender_id: m.sender_id, kind: m.kind, body: m.body, created_at: m.created_at };
  if (!conv.last_message_at || m.created_at > conv.last_message_at) conv.last_message_at = m.created_at;
  chatSort();
  const visible = CH.view && CH.activeId === conv.id;
  if (visible) await chatAddMessage(m, { realtime: true });
  if ((!visible || document.visibilityState !== 'visible') && m.sender_id !== CH.uid) conv.unread = (conv.unread || 0) + 1;   // not looking at it
  chatSchedulePaint();
}
function chatOnMember(pl) {
  const ev = pl.eventType, row = ev === 'DELETE' ? pl.old : pl.new;
  if (!row) return;
  if (ev === 'DELETE') {
    const conv = chatConv(row.conversation_id);
    if (!conv) return;
    if (row.user_id === CH.uid) {   // we left / were removed
      CH.convs = CH.convs.filter((c) => c.id !== conv.id);
      if (CH.activeId === conv.id) { chatUnavailable(); toast('info', 'chat.removedFromConv'); }
      chatSchedulePaint();
    } else {
      conv.members = conv.members.filter((m) => m.user_id !== row.user_id);
      if (CH.activeId === conv.id) { chatPaintHeader(); chatRefreshGroupModal(conv.id); }
    }
    return;
  }
  const conv = chatConv(row.conversation_id);
  if (ev === 'INSERT') { chatSoonReload(); if (conv) chatRefreshGroupModal(conv.id); return; }   // new conversation / member added
  if (!conv) return;
  const m = conv.members.find((x) => x.user_id === row.user_id);
  if (!m) { chatSoonReload(); return; }
  if (row.user_id === CH.uid) {   // read on another device
    m.last_read_at = row.last_read_at; conv.me.last_read_at = row.last_read_at;
    if (conv.unread && row.last_read_at && conv.last_message_at && row.last_read_at >= conv.last_message_at) { conv.unread = 0; chatSchedulePaint(); }
  }
  if ((m.pseudo || null) !== (row.pseudo || null)) {   // someone changed a pseudo
    m.pseudo = row.pseudo || null;
    if (row.user_id === CH.uid) conv.me.pseudo = m.pseudo;
    chatSchedulePaint();
    if (CH.activeId === conv.id) { chatPaintHeader(); chatRenderMessages(true); chatRefreshGroupModal(conv.id); }
  }
}

/* ----- signed URLs for private chat files (batched + cached) ----- */
function chatUrl(att, fresh) {
  const key = att.bucket + '|' + att.storage_path, c = CH.sign.get(key);
  if (!fresh && c) { if (c.p) return c.p; if (c.exp > Date.now() + 60000) return Promise.resolve(c.url); }
  const gen = CH.gen;
  const p = new Promise((res, rej) => { chatSignQ.items.push({ att, key, res, rej, gen }); });
  CH.sign.set(key, { p, exp: 0 });
  if (!chatSignQ.timer) chatSignQ.timer = setTimeout(chatFlushSign, 0);
  return p;
}
async function chatFlushSign() {
  const items = chatSignQ.items; chatSignQ.items = []; chatSignQ.timer = null;
  const byBucket = {};
  items.forEach((i) => { (byBucket[i.att.bucket] = byBucket[i.att.bucket] || []).push(i); });
  await Promise.all(Object.keys(byBucket).map(async (bucket) => {
    const list = byBucket[bucket];
    let map = {};
    try {
      const r = await sb.storage.from(bucket).createSignedUrls(list.map((i) => i.att.storage_path), 3600);
      if (!r.error && r.data) r.data.forEach((x) => { if (x.signedUrl && !x.error) map[x.path] = safeHttpUrl(x.signedUrl); });
    } catch (e) { map = {}; }
    list.forEach((i) => {
      const url = map[i.att.storage_path];
      if (i.gen !== CH.gen) { i.rej(new Error('stale')); return; }
      if (url) { CH.sign.set(i.key, { url, exp: Date.now() + 3600000 }); i.res(url); }
      else { CH.sign.delete(i.key); i.rej(new Error('sign')); }
    });
  }));
}
async function chatOpenFile(att) {   // download / open through a fresh, short-lived signed URL
  try {
    const r = await sb.storage.from(att.bucket).createSignedUrl(att.storage_path, 120, { download: att.file_name });
    const url = !r.error && r.data && safeHttpUrl(r.data.signedUrl);
    if (!url) throw new Error('sign');
    const a = el('a'); a.href = url; a.rel = 'noopener noreferrer'; a.target = '_blank'; a.download = att.file_name;
    document.body.append(a); a.click(); a.remove();
  } catch (e) { toast('error', 'err.chatFileUnavailable'); }
}
function chatViewer(att) {
  const dlg = el('dialog', 'chat-viewer'); dlg.setAttribute('aria-label', t('chat.viewer'));
  const close = el('button', 'btn btn-ghost icon-btn chat-viewer-x', '×'); close.type = 'button'; close.setAttribute('aria-label', t('common.close'));
  const img = el('img'); img.alt = att.file_name;
  const box = el('div', 'chat-viewer-box'); box.append(img);
  dlg.append(close, box);
  const done = () => { if (dlg.open) dlg.close(); };
  close.addEventListener('click', done);
  dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target === box) done(); });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg); dlg.showModal();
  chatUrl(att).then((u) => { img.src = u; }).catch(() => { chatUrl(att, true).then((u) => { img.src = u; }).catch(() => { done(); toast('error', 'err.chatFileUnavailable'); }); });
}

/* ----- messages ----- */
const chatIsMedia = (k) => k === 'image' || k === 'video' || k === 'file';
async function chatFetchAtts(ids) {   // attachments for realtime / RPC-returned messages: one batched query
  if (!ids.length) return {};
  const r = await sb.from('message_attachments').select(ATT_COLS).in('message_id', ids);
  const out = {};
  if (!r.error) (r.data || []).forEach((a) => { (out[a.message_id] = out[a.message_id] || []).push(a); });
  return out;
}
async function chatOpenConv(id) {
  if (!chatConv(id)) return;
  const tok = ++CH.tok;
  Object.assign(CH, { activeId: id, msgs: [], msgsLoading: true, msgsError: null, hasOlder: false, olderLoading: false, newBelow: 0, uploads: [] });
  CH.mobileConv = true;
  chatRenderConv(); chatPaintList(); chatApplyView();
  await chatLoadMessages(true, tok);
}
async function chatLoadMessages(reset, tok) {
  const id = CH.activeId;
  if (!id) return;
  if (!reset) { if (CH.olderLoading || !CH.hasOlder) return; CH.olderLoading = true; chatPaintTop(); }
  const gen = CH.gen, oldest = CH.msgs[0];
  try {
    let q = sb.from('messages').select(CHAT_MSG_COLS).eq('conversation_id', id)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(CHAT_PAGE + 1);
    if (!reset && oldest) q = q.or('created_at.lt.' + oldest.created_at + ',and(created_at.eq.' + oldest.created_at + ',id.lt.' + oldest.id + ')');
    const { data, error } = await q;
    if (error) throw error;
    if (gen !== CH.gen || tok !== CH.tok) return;   // another conversation was opened meanwhile
    const more = data.length > CHAT_PAGE;
    const page = data.slice(0, CHAT_PAGE).reverse();   // chronological
    const have = new Set(CH.msgs.map((m) => m.id));
    const fresh = page.filter((m) => !have.has(m.id));
    if (reset) { CH.msgs = fresh; CH.msgsLoading = false; CH.msgsError = null; CH.hasOlder = more; CH.stickUntil = Date.now() + 4000; chatRenderMessages(false); chatToBottom(); chatMarkRead(); }
    else {
      const s = CH.els.msgs, before = s ? s.scrollHeight : 0;
      CH.msgs = fresh.concat(CH.msgs); CH.hasOlder = more; CH.olderLoading = false;
      chatRenderMessages(false);
      if (s) s.scrollTop = s.scrollHeight - before + s.scrollTop;   // keep the reader where they were
    }
    chatPaintTop();
  } catch (e) {
    if (gen !== CH.gen || tok !== CH.tok) return;
    if (reset) { CH.msgsLoading = false; CH.msgsError = authErrorKey(e); chatRenderMessages(false); }
    else { CH.olderLoading = false; chatPaintTop(); toast('error', authErrorKey(e)); }
  }
}
async function chatCatchUp() {   // after a reconnect: merge anything missed into the open conversation
  const id = CH.activeId, tok = CH.tok;
  if (!id || !CH.view) return;
  const r = await sb.from('messages').select(CHAT_MSG_COLS).eq('conversation_id', id)
    .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(CHAT_PAGE);
  if (r.error || tok !== CH.tok) return;
  const have = new Set(CH.msgs.map((m) => m.id));
  const fresh = (r.data || []).filter((m) => !have.has(m.id)).reverse();
  if (!fresh.length) return;
  const near = chatNear();
  CH.msgs = CH.msgs.concat(fresh); chatRenderMessages(false);
  if (near) { chatToBottom(); chatMarkRead(); } else { CH.newBelow += fresh.length; chatPaintJump(); }
}
/* One entry point for a message that arrives (realtime or send_message response): de-duplicated by id */
async function chatAddMessage(m, opts) {
  const o = opts || {}, tok = CH.tok;
  if (m.conversation_id !== CH.activeId || CH.msgs.some((x) => x.id === m.id) || CH.adding.has(m.id)) return;
  CH.adding.add(m.id);
  try {
    if (chatIsMedia(m.kind) && !m.message_attachments) {
      const atts = await chatFetchAtts([m.id]);
      m = Object.assign({}, m, { message_attachments: atts[m.id] || [] });
    }
  } finally { CH.adding.delete(m.id); }
  if (tok !== CH.tok || m.conversation_id !== CH.activeId || CH.msgs.some((x) => x.id === m.id)) return;
  const mine = m.sender_id === CH.uid, near = chatNear();
  const prev = CH.msgs[CH.msgs.length - 1];
  CH.msgs.push(m);
  if (CH.els.list) {
    CH.els.empty.hidden = true;
    CH.els.list.append(...chatMsgNodes(m, prev));
  }
  if (mine || near) {
    CH.stickUntil = Date.now() + 3000; chatToBottom();
    if (!mine) chatMarkRead(true);   // only when the tab is visible
  } else { CH.newBelow += 1; chatPaintJump(); }
  void o;
}
function chatMarkRead(onlyIfVisible) {
  const id = CH.activeId;
  if (!id) return;
  if (onlyIfVisible && document.visibilityState !== 'visible') return;
  clearTimeout(CH.markTimer);
  const gen = CH.gen;
  CH.markTimer = setTimeout(async () => {
    if (gen !== CH.gen || id !== CH.activeId || !CH.view) return;
    const conv = chatConv(id);
    if (conv && !conv.unread && conv.me.last_read_at && conv.last_message_at && conv.me.last_read_at >= conv.last_message_at) return;   // nothing new
    const { error } = await sb.rpc('mark_conversation_read', { p_conversation_id: id });
    if (gen !== CH.gen || error) return;
    const c = chatConv(id);
    if (c) { c.unread = 0; c.me.last_read_at = new Date().toISOString(); }
    chatSchedulePaint();
  }, 350);
}

/* ----- sending ----- */
async function chatSendText() {
  const ta = CH.els.ta, id = CH.activeId;
  if (!ta || !id || CH.sending) return;
  const text = ta.value;
  if (!text.trim()) return;
  if (text.length > 4000) { toast('error', 'err.chatTooLong'); return; }
  CH.sending = true; chatPaintComposer();
  const gen = CH.gen;
  try {
    const { data, error } = await sb.rpc('send_message', { p_conversation_id: id, p_kind: 'text', p_body: text });
    if (error) throw error;
    if (gen !== CH.gen) return;
    delete CH.drafts[id];
    if (CH.els.ta && CH.activeId === id) { CH.els.ta.value = ''; chatGrow(); }
    chatAfterSend(data);
  } catch (e) { if (gen === CH.gen) toast('error', authErrorKey(e)); }
  if (gen !== CH.gen) return;
  CH.sending = false; chatPaintComposer();
  if (CH.els.ta && CH.activeId === id) CH.els.ta.focus();
}
function chatAfterSend(msg) {   // server-confirmed message: update the list preview and show it (de-duplicated against Realtime)
  if (!msg || !msg.id) return;
  const conv = chatConv(msg.conversation_id);
  if (conv) {
    conv.last = { id: msg.id, conversation_id: msg.conversation_id, sender_id: msg.sender_id, kind: msg.kind, body: msg.body, created_at: msg.created_at };
    conv.last_message_at = msg.created_at; chatSort(); chatSchedulePaint();
  }
  if (CH.activeId === msg.conversation_id) chatAddMessage(msg, {});
}
function chatSafeName(name) {
  const dot = name.lastIndexOf('.');
  let ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) : '';
  let base = (dot > 0 ? name.slice(0, dot) : name).normalize('NFKD').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 50);
  if (!base) base = 'file';
  return base + (ext ? '.' + ext : '');
}
function chatMimeOf(file, kind) {
  const spec = CHAT_KINDS[kind];
  let m = String(file.type || '').toLowerCase();
  if (kind === 'file' && (!m || m === 'application/octet-stream')) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    m = CHAT_EXT_MIME[ext] || '';   // the browser gave no type: map the few document extensions we allow
  }
  return spec.mimes.includes(m) ? m : null;
}
async function chatSniff(file, mime) {   // do not trust the declared type alone for images / PDF
  const rules = { 'image/jpeg': [[0, [0xff, 0xd8, 0xff]]], 'image/png': [[0, [0x89, 0x50, 0x4e, 0x47]]], 'image/gif': [[0, [0x47, 0x49, 0x46, 0x38]]],
    'image/webp': [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]], 'application/pdf': [[0, [0x25, 0x50, 0x44, 0x46]]] };
  const rule = rules[mime];
  if (!rule) return true;
  try {
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    return rule.every(([off, sig]) => sig.every((v, i) => b[off + i] === v));
  } catch (e) { return false; }
}
async function chatSendFiles(kind, fileList) {
  const id = CH.activeId, spec = CHAT_KINDS[kind];
  const files = Array.from(fileList || []);
  if (!id || !files.length || CH.sending) return;
  if (files.length > CHAT_MAX_ATTACH) { toast('error', 'err.chatTooMany'); return; }
  const checked = [];
  for (const f of files) {
    if (f.size < 1 || f.size > spec.max) { toast('error', 'err.chatFileTooLarge'); return; }
    const mime = chatMimeOf(f, kind);
    if (!mime || !(await chatSniff(f, mime))) { toast('error', 'err.chatFileType'); return; }
    checked.push({ file: f, mime, name: f.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'file' });
  }
  const gen = CH.gen, caption = CH.els.ta ? CH.els.ta.value : '';
  CH.sending = true;
  CH.uploads = checked.map((c) => ({ name: c.name, kind, state: 'uploading' }));
  chatPaintComposer();
  const done = [];
  try {
    for (let i = 0; i < checked.length; i++) {
      const c = checked[i], path = id + '/' + uuid() + '-' + chatSafeName(c.name);
      const r = await sb.storage.from(spec.bucket).upload(path, c.file, { contentType: c.mime, upsert: false, cacheControl: '3600' });
      if (gen !== CH.gen) return;
      if (r.error) { if (CH.uploads[i]) CH.uploads[i].state = 'failed'; throw r.error; }
      CH.uploads[i].state = 'done'; chatPaintComposer();
      done.push({ storage_path: path, file_name: c.name, mime_type: c.mime, size_bytes: c.file.size });
    }
    const { data, error } = await sb.rpc('send_message', { p_conversation_id: id, p_kind: kind, p_body: caption.trim() || null, p_attachments: done });
    if (error) throw error;
    if (gen !== CH.gen) return;
    if (caption.trim()) { delete CH.drafts[id]; if (CH.els.ta && CH.activeId === id) { CH.els.ta.value = ''; chatGrow(); } }
    chatAfterSend(data);
  } catch (e) {
    if (gen === CH.gen) toast('error', authErrorKey(e));
    if (done.length) sb.storage.from(spec.bucket).remove(done.map((d) => d.storage_path)).catch(() => {});   // do not leave orphaned uploads
  }
  if (gen !== CH.gen) return;
  CH.sending = false; CH.uploads = []; chatPaintComposer();
}

/* ----- shell integration (unread dot on the avatar + badge on the profile-card Chat button) ----- */
function chatShell() {
  const n = chatUnreadTotal();
  const av = $('avatar-btn'), pc = $('pc-chat');
  if (av) { if (n) av.dataset.unread = '1'; else delete av.dataset.unread; }
  if (pc) { if (n) pc.dataset.badge = n > 99 ? '99+' : String(n); else delete pc.dataset.badge; }
}

/* ----- view: enter / leave / render ----- */
function enterChat() {
  CH.view = true; CH.mobileConv = false; CH.activeId = null; CH.msgs = []; CH.tok++;
  $('view-module').classList.add('module-chat');
  renderChat();
  chatViewport(true);
  if (CH.uid) chatLoadList();
}
function leaveChat() {
  CH.view = false; CH.activeId = null; CH.msgs = []; CH.tok++; CH.els = {}; CH.sig = null; CH.uploads = []; CH.newBelow = 0;
  $('view-module').classList.remove('module-chat');
  clearTimeout(CH.qTimer); chatViewport(false);
}
function chatViewport(on) {   // keep the composer visible when a phone keyboard opens
  const vv = window.visualViewport;
  if (CH.vv) { vv && vv.removeEventListener('resize', CH.vv); CH.vv = null; document.documentElement.style.removeProperty('--chat-vh'); }
  if (!on || !vv) return;
  CH.vv = () => document.documentElement.style.setProperty('--chat-vh', vv.height + 'px');
  vv.addEventListener('resize', CH.vv); CH.vv();
}
function chatApplyView() { if (CH.els.root) CH.els.root.dataset.view = CH.mobileConv && CH.activeId ? 'conv' : 'list'; }
function renderChat() {
  const body = $('module-body');
  CH.sig = state.lang;
  body.replaceChildren();
  const root = el('div', 'chat');
  const side = el('aside', 'chat-side'); side.setAttribute('aria-label', t('chat.conversations'));
  const head = el('div', 'chat-side-head');
  const nd = el('button', 'btn btn-primary btn-sm', '＋ ' + t('chat.newConv')); nd.type = 'button'; nd.addEventListener('click', openNewDirect);
  const ng = el('button', 'btn btn-secondary btn-sm', t('chat.newGroup')); ng.type = 'button'; ng.addEventListener('click', openNewGroup);
  head.append(nd, ng);
  const sw = el('div', 'psearch');
  const input = el('input'); input.type = 'search'; input.maxLength = 100; input.value = CH.q; input.autocomplete = 'off';
  input.placeholder = t('chat.searchConvs'); input.setAttribute('aria-label', t('chat.searchConvs'));
  input.addEventListener('input', () => { CH.q = input.value; clearTimeout(CH.qTimer); CH.qTimer = setTimeout(chatPaintList, 200); });
  sw.append(input);
  const banner = el('div', 'chat-conn'); banner.setAttribute('role', 'status'); banner.hidden = true;
  const list = el('div', 'chat-list');
  side.append(head, sw, banner, list);
  const main = el('section', 'chat-main'); main.setAttribute('aria-label', t('chat.conversation'));
  root.append(side, main);
  body.append(root);
  CH.els = { root, side, main, convList: list, banner, search: input };
  chatApplyView(); chatPaintBanner(); chatPaintList();
  if (CH.activeId) chatRenderConv(); else chatPaintPlaceholder();
}
function chatPaintBanner() {
  const b = CH.els.banner;
  if (!b) return;
  b.hidden = CH.rt === 'ok' || CH.rt === 'idle';
  b.textContent = CH.rt === 'down' ? t('chat.connLost') : CH.rt === 'connecting' ? t('chat.connConnecting') : '';
}
function chatPaintPlaceholder() {
  const m = CH.els.main;
  if (!m) return;
  ['head', 'who', 'info', 'msgs', 'list', 'top', 'empty', 'jump', 'ups', 'ta', 'send', 'ab', 'menu'].forEach((k) => { delete CH.els[k]; });   // the open-conversation DOM is gone
  m.replaceChildren(listStateBox('✉', 'chat.pickTitle', 'chat.pickBody', null));
  m.classList.add('chat-main-empty');
}

/* ----- conversation list (with client-side search over conversations and people) ----- */
function chatPaintList() {
  const box = CH.els.convList;
  if (!box) return;
  box.replaceChildren();
  if (CH.listLoading && !CH.loaded) { for (let i = 0; i < 5; i++) { const sk = el('div', 'chat-item chat-item-sk'); sk.append(el('div', 'skeleton chat-sk-av'), el('div', 'skeleton sk-line')); box.append(sk); } return; }
  if (CH.listError && !CH.loaded) {
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => { CH.listError = null; chatLoadList(); });
    const s = listStateBox('!', 'chat.listErrorTitle', null, null); s.append(el('p', 'error', t(CH.listError)), retry); box.append(s); return;
  }
  const term = normalizeName(CH.q).slice(0, 100);
  const convs = CH.convs.filter((c) => !term || normalizeName(chatConvName(c) + ' ' + c.members.map(chatMemberName).join(' ')).includes(term));
  const ul = el('ul', 'chat-items');
  convs.forEach((c) => ul.append(chatItem(c)));
  let people = [];
  if (term) {   // people without a direct conversation yet
    const have = new Set(CH.convs.filter((c) => c.type === 'direct').map((c) => (chatOther(c) || {}).user_id));
    people = [...CH.dir.values()].filter((u) => u.id !== CH.uid && !have.has(u.id) && normalizeName(u.full_name).includes(term)).slice(0, 8);
  }
  if (!convs.length && !people.length) {
    box.append(term ? listStateBox('⌕', 'chat.noResultsTitle', 'chat.noResultsBody', null)
      : (() => { const b = el('button', 'btn btn-primary', t('chat.startConv')); b.type = 'button'; b.addEventListener('click', openNewDirect); return listStateBox('✉', 'chat.emptyTitle', 'chat.emptyBody', b); })());
    return;
  }
  if (convs.length) box.append(ul);
  if (people.length) {
    box.append(el('p', 'chat-sec', t('chat.people')));
    const pl = el('ul', 'chat-items');
    people.forEach((u) => {
      const b = el('button', 'chat-item'); b.type = 'button';
      const info = el('div', 'chat-item-info'); info.append(el('span', 'chat-item-name', u.full_name), el('span', 'chat-item-prev', t('role.' + u.role)));
      b.append(chatAvatar(u.full_name, u.avatar_id), info);
      b.addEventListener('click', () => chatStartDirect(u.id));
      const li = el('li'); li.append(b); pl.append(li);
    });
    box.append(pl);
  }
}
function chatItem(c) {
  const b = el('button', 'chat-item' + (c.id === CH.activeId ? ' on' : '') + (c.unread ? ' unread' : '')); b.type = 'button';
  if (c.id === CH.activeId) b.setAttribute('aria-current', 'true');
  const info = el('div', 'chat-item-info');
  const top = el('div', 'chat-item-top');
  const nm = el('span', 'chat-item-name', chatConvName(c));
  if (c.type === 'group') nm.prepend(el('span', 'chat-grp', '⚑ '));
  top.append(nm, el('span', 'chat-item-time', chatListTime(c.last_message_at)));
  const bot = el('div', 'chat-item-top');
  bot.append(el('span', 'chat-item-prev', chatPreview(c)));
  if (c.unread) { const bd = el('span', 'chat-badge', c.unread > 99 ? '99+' : String(c.unread)); bd.setAttribute('aria-label', t('chat.unreadN', { n: c.unread })); bot.append(bd); }
  info.append(top, bot);
  b.append(chatConvAvatar(c), info);
  b.addEventListener('click', () => { if (CH.activeId !== c.id || !CH.mobileConv) chatOpenConv(c.id); });
  const li = el('li'); li.append(b);
  return li;
}
async function chatStartDirect(uid) {
  try {
    const { data, error } = await withLoading(() => sb.rpc('get_or_create_direct_conversation', { p_other_user_id: uid }));
    if (error) throw error;
    closeModal();
    CH.q = ''; if (CH.els.search) CH.els.search.value = '';
    await chatLoadList();
    if (chatConv(data)) chatOpenConv(data); else toast('error', 'err.chatUnavailable');
  } catch (e) { toast('error', authErrorKey(e)); }
}

/* ----- active conversation ----- */
function chatUnavailable() {   // removed from it / no longer accessible: friendly message, back to the list
  CH.tok++; CH.activeId = null; CH.msgs = []; CH.mobileConv = false;
  if (CH.els.root) { chatApplyView(); chatPaintPlaceholder(); chatPaintList(); }
  if ($('modal').open && $('modal').dataset.chatConv) closeModal();
}
function chatRenderConv() {
  const main = CH.els.main, conv = chatActive();
  if (!main || !conv) return;
  main.classList.remove('chat-main-empty');
  main.replaceChildren();
  const head = el('header', 'chat-head');
  const back = el('button', 'btn btn-ghost icon-btn chat-back', '←'); back.type = 'button'; back.setAttribute('aria-label', t('chat.back'));
  back.addEventListener('click', () => { CH.mobileConv = false; chatApplyView(); });
  const who = el('div', 'chat-head-who');
  const info = el('div', 'chat-head-info');
  const det = el('button', 'btn btn-ghost icon-btn chat-det', 'ⓘ'); det.type = 'button'; det.setAttribute('aria-label', t('chat.details')); det.title = t('chat.details');
  det.addEventListener('click', () => openConvDetails(CH.activeId));
  head.append(back, who, info, det);
  const conn = el('div', 'chat-conn'); conn.hidden = true;
  const wrap = el('div', 'chat-msgs-wrap');
  const msgs = el('div', 'chat-msgs'); msgs.setAttribute('role', 'log'); msgs.setAttribute('aria-live', 'polite'); msgs.setAttribute('aria-relevant', 'additions'); msgs.tabIndex = 0;
  msgs.setAttribute('aria-label', t('chat.messages'));
  const top = el('div', 'chat-top');
  const list = el('div', 'chat-msg-list');
  const empty = el('div', 'chat-empty'); empty.hidden = true;
  empty.append(el('p', 'muted', t('chat.noMessages')));
  msgs.append(top, list, empty);
  const jump = el('button', 'chat-jump'); jump.type = 'button'; jump.hidden = true;
  jump.addEventListener('click', () => { CH.newBelow = 0; chatToBottom(); chatPaintJump(); chatMarkRead(); });
  wrap.append(msgs, jump);
  const ups = el('div', 'chat-uploads'); ups.hidden = true;
  const comp = el('div', 'chat-composer');
  const att = el('div', 'chat-attach');
  const ab = el('button', 'btn btn-ghost icon-btn', '📎'); ab.type = 'button'; ab.setAttribute('aria-label', t('chat.attach')); ab.title = t('chat.attach');
  ab.setAttribute('aria-haspopup', 'menu'); ab.setAttribute('aria-expanded', 'false');
  const menu = el('div', 'chat-menu'); menu.setAttribute('role', 'menu'); menu.hidden = true;
  const inputs = {};
  ['image', 'video', 'file'].forEach((k) => {
    const fi = el('input'); fi.type = 'file'; fi.hidden = true; fi.multiple = true; fi.accept = CHAT_KINDS[k].accept;
    fi.addEventListener('change', () => { const f = Array.from(fi.files); fi.value = ''; chatSendFiles(k, f); });
    inputs[k] = fi;
    const mi = el('button', 'chat-menu-item', t('chat.kind.' + k)); mi.type = 'button'; mi.setAttribute('role', 'menuitem');
    mi.addEventListener('click', () => { menu.hidden = true; ab.setAttribute('aria-expanded', 'false'); fi.click(); });
    menu.append(mi);
  });
  ab.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; ab.setAttribute('aria-expanded', String(!menu.hidden)); if (!menu.hidden) menu.firstChild.focus(); });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.hidden = true; ab.setAttribute('aria-expanded', 'false'); ab.focus(); } });
  att.append(ab, menu, inputs.image, inputs.video, inputs.file);
  const ta = el('textarea'); ta.rows = 1; ta.maxLength = 4000; ta.placeholder = t('chat.typeMessage'); ta.setAttribute('aria-label', t('chat.typeMessage'));
  ta.value = CH.drafts[conv.id] || '';
  const coarse = window.matchMedia && matchMedia('(pointer: coarse)').matches;
  ta.addEventListener('input', () => { CH.drafts[CH.activeId] = ta.value; chatGrow(); chatPaintComposer(); });
  ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !coarse) { e.preventDefault(); chatSendText(); } });
  const send = el('button', 'btn btn-primary chat-send', t('chat.send')); send.type = 'button'; send.addEventListener('click', chatSendText);
  comp.append(att, ta, send);
  const hint = el('p', 'hint chat-hint', t('chat.enterHint')); hint.hidden = coarse;
  main.append(head, conn, wrap, ups, comp, hint);
  msgs.addEventListener('scroll', () => {
    if (chatNear()) { if (CH.newBelow) { CH.newBelow = 0; chatMarkRead(true); } }
    chatPaintJump();
    if (msgs.scrollTop < 120 && CH.hasOlder && !CH.olderLoading && !CH.msgsLoading) chatLoadMessages(false, CH.tok);
  }, { passive: true });
  Object.assign(CH.els, { head, who, info, msgs, list, top, empty, jump, ups, ta, send, ab, menu });
  chatPaintHeader(); chatPaintComposer(); chatRenderMessages(false);
}
function chatCloseMenuOnce(e) {
  const m = CH.els && CH.els.menu;
  if (!m || m.hidden) return;
  if (!e.target.closest('.chat-attach')) { m.hidden = true; if (CH.els.ab) CH.els.ab.setAttribute('aria-expanded', 'false'); }
}
function chatGrow() { const ta = CH.els.ta; if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 140) + 'px'; }
function chatPaintHeader() {
  const conv = chatActive(), E = CH.els;
  if (!conv || !E.who) return;
  E.who.replaceChildren(chatConvAvatar(conv));
  E.info.replaceChildren(el('h2', 'chat-head-name', chatConvName(conv)));
  if (conv.type === 'group') E.info.append(el('p', 'chat-head-sub', t('chat.membersN', { n: conv.members.length })));
  else { const o = chatOther(conv), u = o && CH.dir.get(o.user_id); E.info.append(el('p', 'chat-head-sub', u ? t('role.' + u.role) : t('chat.unknownUser'))); }
}
function chatPaintComposer() {
  const E = CH.els;
  if (!E.send) return;
  const empty = !E.ta.value.trim();
  E.send.disabled = CH.sending || empty;
  E.send.textContent = t(CH.sending && !CH.uploads.length ? 'chat.sending' : 'chat.send');
  E.ab.disabled = CH.sending; E.ta.readOnly = false;
  E.ups.hidden = !CH.uploads.length;
  E.ups.replaceChildren();
  CH.uploads.forEach((u) => {
    const row = el('div', 'chat-up chat-up-' + u.state);
    row.append(el('span', 'chat-up-kind', t('chat.kind.' + u.kind)), el('span', 'chat-up-name', u.name), el('span', 'chat-up-state', t('chat.up.' + u.state)));
    if (u.state === 'uploading') row.append(el('span', 'chat-up-bar'));
    E.ups.append(row);
  });
}
function chatPaintTop() {
  const top = CH.els.top;
  if (!top) return;
  top.replaceChildren();
  if (CH.olderLoading) top.append(el('p', 'hint', t('chat.loadingOlder')));
  else if (CH.hasOlder) { const b = el('button', 'btn btn-ghost btn-sm', t('chat.loadOlder')); b.type = 'button'; b.addEventListener('click', () => chatLoadMessages(false, CH.tok)); top.append(b); }
}
function chatPaintJump() {
  const j = CH.els.jump, s = CH.els.msgs;
  if (!j || !s) return;
  const far = s.scrollHeight - s.scrollTop - s.clientHeight > 320;
  j.hidden = !(CH.newBelow || far);
  j.textContent = CH.newBelow ? '↓ ' + t('chat.newMessages', { n: CH.newBelow }) : '↓';
  j.setAttribute('aria-label', CH.newBelow ? t('chat.newMessages', { n: CH.newBelow }) : t('chat.jumpLatest'));
  j.classList.toggle('chat-jump-new', !!CH.newBelow);
}
function chatRenderMessages(keepScroll) {
  const E = CH.els;
  if (!E.list) return;
  const s = E.msgs, from = s.scrollTop;
  E.list.replaceChildren();
  chatPaintTop();
  if (CH.msgsLoading) { E.empty.hidden = true; for (let i = 0; i < 4; i++) { const sk = el('div', 'skeleton chat-sk-msg' + (i % 2 ? ' r' : '')); E.list.append(sk); } return; }
  if (CH.msgsError) {
    E.empty.hidden = true;
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button';
    retry.addEventListener('click', () => { CH.msgsError = null; CH.msgsLoading = true; chatRenderMessages(false); chatLoadMessages(true, CH.tok); });
    const box = listStateBox('!', 'chat.msgErrorTitle', null, null); box.append(el('p', 'error', t(CH.msgsError)), retry); E.list.append(box); return;
  }
  E.empty.hidden = CH.msgs.length > 0;
  const frag = document.createDocumentFragment();
  CH.msgs.forEach((m, i) => frag.append(...chatMsgNodes(m, CH.msgs[i - 1])));
  E.list.append(frag);
  if (keepScroll) s.scrollTop = from;
}
const chatDayKey = (iso) => new Date(iso).toDateString();
function chatMsgNodes(m, prev) {
  const out = [];
  const conv = chatActive();
  if (!prev || chatDayKey(prev.created_at) !== chatDayKey(m.created_at)) out.push(el('div', 'msg-day', fmtDate(m.created_at, false)));
  const mine = m.sender_id === CH.uid, group = conv && conv.type === 'group';
  const cont = !!prev && prev.sender_id === m.sender_id && chatDayKey(prev.created_at) === chatDayKey(m.created_at) && Date.parse(m.created_at) - Date.parse(prev.created_at) < 300000;
  const row = el('div', 'msg ' + (mine ? 'mine' : 'theirs') + (cont ? ' cont' : '')); row.dataset.id = m.id;
  if (!mine && group) {
    const u = CH.dir.get(m.sender_id);
    row.append(cont ? el('div', 'chat-av-gap') : chatAvatar(chatUserName(m.sender_id), u && u.avatar_id, 'chat-av-sm'));
  }
  const bub = el('div', 'msg-bubble');
  if (!mine && group && !cont) bub.append(el('p', 'msg-sender', chatUserName(m.sender_id)));
  const atts = (m.message_attachments || []).slice().sort((a, b) => (a.created_at || '').localeCompare(b.created_at || ''));
  if (m.kind === 'image') bub.append(chatImages(atts));
  else if (m.kind === 'video') atts.forEach((a) => bub.append(chatVideo(a)));
  else if (m.kind === 'file') atts.forEach((a) => bub.append(chatFileRow(a)));
  else if (m.kind === 'location') bub.append(el('p', 'msg-loc', '📍 ' + Number(m.latitude).toFixed(5) + ', ' + Number(m.longitude).toFixed(5)));
  if (m.body) bub.append(el('p', 'msg-text', m.body));   // textContent only: message text is never HTML
  bub.append(el('span', 'msg-time', chatShortTime(m.created_at)));
  row.append(bub);
  out.push(row);
  return out;
}
function chatImages(atts) {
  const g = el('div', 'msg-imgs' + (atts.length > 1 ? ' multi' : ''));
  atts.forEach((a) => {
    const b = el('button', 'msg-img'); b.type = 'button'; b.setAttribute('aria-label', t('chat.openImage', { name: a.file_name }));
    const img = el('img'); img.alt = a.file_name; img.loading = 'lazy'; img.decoding = 'async';
    let retried = false;
    img.addEventListener('load', () => { if (Date.now() < CH.stickUntil) chatToBottom(); });   // late-loading image must not push the latest message out of view
    const load = (fresh) => chatUrl(a, fresh).then((u) => { img.src = u; }).catch(() => { b.classList.add('broken'); });
    img.addEventListener('error', () => { if (!retried) { retried = true; load(true); } else b.classList.add('broken'); });   // expired URL: sign again once
    load(false);
    b.addEventListener('click', () => chatViewer(a));
    b.append(img); g.append(b);
  });
  return g;
}
function chatVideo(a) {
  const box = el('div', 'msg-video');
  const play = el('button', 'msg-video-play'); play.type = 'button'; play.setAttribute('aria-label', t('chat.playVideo', { name: a.file_name }));
  play.append(el('span', 'msg-video-icon', '▶'), el('span', 'msg-video-name', a.file_name), el('span', 'msg-video-size', fmtSize(a.size_bytes)));
  play.addEventListener('click', async () => {
    play.disabled = true;
    try {
      const u = await chatUrl(a);
      const v = el('video'); v.controls = true; v.preload = 'metadata'; v.setAttribute('playsinline', ''); v.src = u;
      v.addEventListener('error', () => { chatUrl(a, true).then((n) => { v.src = n; }).catch(() => toast('error', 'err.chatFileUnavailable')); }, { once: true });
      box.replaceChildren(v); v.play().catch(() => {});
    } catch (e) { play.disabled = false; toast('error', 'err.chatFileUnavailable'); }
  });
  box.append(play);
  return box;
}
function chatFileRow(a) {
  const b = el('button', 'msg-file'); b.type = 'button'; b.setAttribute('aria-label', t('chat.downloadFile', { name: a.file_name }));
  const ext = (a.file_name.split('.').pop() || '').slice(0, 5).toUpperCase();
  const info = el('span', 'msg-file-info');
  info.append(el('span', 'msg-file-name', a.file_name), el('span', 'msg-file-meta', ext + ' · ' + fmtSize(a.size_bytes)));
  b.append(el('span', 'msg-file-icon', '▤'), info, el('span', 'msg-file-dl', '⭳'));
  b.addEventListener('click', () => chatOpenFile(a));
  return b;
}

/* ----- people picker (new conversation / new group / add member) ----- */
function chatPicker(opts) {   // opts: { exclude:Set, onPick(user), selected?:Set, multi?:bool }
  const box = el('div', 'chat-picker');
  const sw = el('div', 'psearch');
  const input = el('input'); input.type = 'search'; input.maxLength = 100; input.autocomplete = 'off';
  input.placeholder = t('chat.searchPeople'); input.setAttribute('aria-label', t('chat.searchPeople'));
  sw.append(input);
  const list = el('ul', 'chat-items chat-picker-list');
  box.append(sw, list);
  let timer = null, seq = 0;
  const paint = () => {
    const my = ++seq, term = normalizeName(input.value).slice(0, 100);
    list.replaceChildren();
    const users = [...CH.dir.values()].filter((u) => u.id !== CH.uid && !(opts.exclude && opts.exclude.has(u.id)) && (!term || normalizeName(u.full_name).includes(term)));
    if (my !== seq) return;
    if (!users.length) { list.append(el('li', 'hint chat-picker-none', t(term ? 'chat.noResultsTitle' : 'chat.noPeople'))); return; }
    users.forEach((u) => {
      const on = opts.selected && opts.selected.has(u.id);
      const b = el('button', 'chat-item' + (on ? ' on' : '')); b.type = 'button';
      if (opts.multi) b.setAttribute('aria-pressed', String(!!on));
      const info = el('div', 'chat-item-info'); info.append(el('span', 'chat-item-name', u.full_name), el('span', 'chat-item-prev', t('role.' + u.role)));
      b.append(chatAvatar(u.full_name, u.avatar_id), info);
      if (opts.multi) b.append(el('span', 'chat-check', on ? '✓' : ''));
      b.addEventListener('click', () => { opts.onPick(u); if (opts.multi) paint(); });
      const li = el('li'); li.append(b); list.append(li);
    });
  };
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(paint, 200); });
  box.refresh = paint;
  return box;
}
async function chatEnsureDir(body, render) {   // refresh the directory (people may have been added) with a loading + retry state
  body.replaceChildren(skeleton(3));
  try { await chatLoadDirectory(true); render(); }
  catch (e) {
    body.replaceChildren();
    const retry = el('button', 'btn btn-primary', t('common.retry')); retry.type = 'button'; retry.addEventListener('click', () => chatEnsureDir(body, render));
    body.append(el('p', 'error', t(authErrorKey(e))), retry);
  }
}
function openNewDirect() {
  openModal('chat.newConv', (body) => {
    chatEnsureDir(body, () => {
      body.replaceChildren();
      const p = chatPicker({ onPick: (u) => chatStartDirect(u.id) });
      body.append(p); p.refresh();
    });
  });
}
function openNewGroup() {
  openModal('chat.newGroup', (body) => {
    chatEnsureDir(body, () => {
      body.replaceChildren();
      const sel = new Set();
      const f = el('div', 'field'); const lab = el('label', null, t('chat.groupName')); lab.htmlFor = 'grp-name';
      const nm = el('input'); nm.id = 'grp-name'; nm.type = 'text'; nm.maxLength = 80; f.append(lab, nm);
      const chips = el('div', 'chips chat-sel'); chips.setAttribute('aria-live', 'polite');
      const paintChips = () => {
        chips.replaceChildren();
        if (!sel.size) { chips.append(el('span', 'hint', t('chat.noneSelected'))); return; }
        sel.forEach((id) => { const u = CH.dir.get(id); const c = el('button', 'chip on', (u ? u.full_name : '') + ' ×'); c.type = 'button'; c.setAttribute('aria-label', t('chat.removeFromSel', { name: u ? u.full_name : '' }));
          c.addEventListener('click', () => { sel.delete(id); paintChips(); picker.refresh(); }); chips.append(c); });
      };
      const picker = chatPicker({ multi: true, selected: sel, onPick: (u) => { if (sel.has(u.id)) sel.delete(u.id); else sel.add(u.id); paintChips(); } });
      const err = el('p', 'error'); err.setAttribute('role', 'alert'); err.hidden = true;
      const actions = el('div', 'modal-actions');
      const cancel = el('button', 'btn btn-ghost', t('common.cancel')); cancel.type = 'button'; cancel.addEventListener('click', closeModal);
      const ok = el('button', 'btn btn-primary', t('chat.createGroup')); ok.type = 'button';
      ok.addEventListener('click', async () => {
        const name = nm.value.trim().replace(/\s+/g, ' ');
        if (!name) { err.textContent = t('err.chatInvalidName'); err.hidden = false; nm.focus(); return; }
        if (!sel.size) { err.textContent = t('err.chatNoMembers'); err.hidden = false; return; }
        ok.disabled = true; err.hidden = true;
        try {
          const { data, error } = await withLoading(() => sb.rpc('create_group', { p_name: name, p_member_ids: [...sel] }));
          if (error) throw error;
          closeModal(); await chatLoadList();
          if (chatConv(data)) chatOpenConv(data);
        } catch (e) { err.textContent = t(authErrorKey(e)); err.hidden = false; ok.disabled = false; }
      });
      actions.append(cancel, ok);
      body.append(f, el('p', 'label-like', t('chat.selectMembers')), chips, picker, err, actions);
      paintChips(); picker.refresh(); nm.focus();
    });
  });
}

/* ----- conversation details: members, pseudo, add / remove (owner), leave ----- */
function chatRefreshGroupModal(id) { if ($('modal').open && $('modal').dataset.chatConv === id) openConvDetails(id); }
function openConvDetails(id) {
  const conv = chatConv(id);
  if (!conv) return;
  const group = conv.type === 'group', owner = conv.me.role === 'owner';
  openModal(group ? 'chat.groupDetails' : 'chat.details', (body) => {
    $('modal').dataset.chatConv = id;
    $('modal').classList.add('modal-wide');
    if (group) body.append(el('p', 'chat-det-name', conv.name));
    body.append(el('p', 'label-like', group ? t('chat.membersN', { n: conv.members.length }) : t('chat.participants')));
    const ul = el('ul', 'chat-items chat-members');
    conv.members.slice().sort((a, b) => (b.role === 'owner') - (a.role === 'owner') || new Date(a.joined_at) - new Date(b.joined_at)).forEach((m) => {
      const u = CH.dir.get(m.user_id);
      const li = el('li', 'chat-member');
      const info = el('div', 'chat-item-info');
      const nm = el('span', 'chat-item-name', chatMemberName(m));
      if (m.user_id === CH.uid) nm.append(' ', el('span', 'badge', t('users.you')));
      if (m.role === 'owner' && group) nm.append(' ', el('span', 'badge badge-pending', t('chat.owner')));
      const sub = [];
      if (m.pseudo && u) sub.push(u.full_name);
      if (u) sub.push(t('role.' + u.role));
      info.append(nm, el('span', 'chat-item-prev', sub.join(' · ')));
      li.append(chatAvatar(chatMemberName(m), u && u.avatar_id), info);
      if (group && owner && m.user_id !== CH.uid && m.role !== 'owner') {
        const rm = el('button', 'btn btn-danger-ghost btn-sm', t('chat.removeMember')); rm.type = 'button';
        rm.setAttribute('aria-label', t('chat.removeMemberName', { name: chatMemberName(m) }));
        rm.addEventListener('click', () => askRemoveMember(conv, m)); li.append(rm);
      }
      ul.append(li);
    });
    body.append(ul);
    const acts = el('div', 'chat-det-actions');
    const ps = el('button', 'btn btn-secondary', t('chat.editPseudo')); ps.type = 'button'; ps.addEventListener('click', () => openPseudo(conv));
    acts.append(ps);
    if (group && owner) { const am = el('button', 'btn btn-secondary', t('chat.addMember')); am.type = 'button'; am.addEventListener('click', () => openAddMember(conv)); acts.append(am); }
    if (group) { const lv = el('button', 'btn btn-danger', t('chat.leaveGroup')); lv.type = 'button'; lv.addEventListener('click', () => askLeave(conv)); acts.append(lv); }
    body.append(acts);
    body.append(el('p', 'hint', t('chat.pseudoHint')));
  });
}
function openPseudo(conv) {
  formModal('chat.editPseudo', [{ name: 'pseudo', label: 'chat.pseudo', value: conv.me.pseudo || '', max: 40 }], async (v) => {
    const val = (v.pseudo || '').replace(/\s+/g, ' ').trim();
    if (val === (conv.me.pseudo || '')) return null;
    try {
      const { error } = await withLoading(() => sb.from('conversation_members').update({ pseudo: val || null })   // only the allowed column
        .eq('conversation_id', conv.id).eq('user_id', CH.uid));
      if (error) throw error;
    } catch (e) { return e && e.code === '23505' ? 'err.chatPseudoTaken' : authErrorKey(e); }
    const m = conv.members.find((x) => x.user_id === CH.uid);
    if (m) m.pseudo = val || null;
    conv.me.pseudo = val || null;
    toast('success', 'toast.pseudoSaved');
    chatPaintList(); chatPaintHeader(); if (CH.activeId === conv.id) chatRenderMessages(true);
    return null;
  });
}
function openAddMember(conv) {
  openModal('chat.addMember', (body) => {
    chatEnsureDir(body, () => {
      body.replaceChildren();
      const exclude = new Set(conv.members.map((m) => m.user_id));
      const p = chatPicker({ exclude, onPick: async (u) => {
        try {
          const { error } = await withLoading(() => sb.rpc('add_member', { p_conversation_id: conv.id, p_user_id: u.id }));
          if (error) throw error;
          toast('success', 'toast.memberAdded');
          await chatLoadList(); closeModal(); openConvDetails(conv.id);
        } catch (e) { toast('error', authErrorKey(e)); }
      } });
      body.append(p); p.refresh();
    });
  });
}
function askRemoveMember(conv, m) {
  confirmModal({ titleKey: 'chat.removeMember', bodyText: t('chat.removeMemberBody', { name: chatMemberName(m) }), confirmKey: 'chat.removeMember', danger: true,
    onConfirm: async () => {
      try { const { error } = await withLoading(() => sb.rpc('remove_member', { p_conversation_id: conv.id, p_user_id: m.user_id })); if (error) throw error; }
      catch (e) { return authErrorKey(e); }
      toast('success', 'toast.memberRemoved');
      await chatLoadList(); setTimeout(() => openConvDetails(conv.id), 60);
      return null;
    } });
}
function askLeave(conv) {
  confirmModal({ titleKey: 'chat.leaveGroup', bodyText: t(conv.me.role === 'owner' ? 'chat.leaveOwnerBody' : 'chat.leaveBody', { name: conv.name }), confirmKey: 'chat.leaveGroup', danger: true,
    onConfirm: async () => {
      try { const { error } = await withLoading(() => sb.rpc('leave_conversation', { p_conversation_id: conv.id })); if (error) throw error; }   // ownership transfer is done by the database
      catch (e) { return authErrorKey(e); }
      toast('success', 'toast.leftGroup');
      CH.convs = CH.convs.filter((c) => c.id !== conv.id);
      if (CH.activeId === conv.id) chatUnavailable();
      chatSchedulePaint(); chatLoadList();
      return null;
    } });
}

/* ===== UI wiring ===== */
function showRoleStep() {
  $('login-form').hidden = true;
  $('step-role').hidden = false;
  $('email').value = ''; $('password').value = '';
  renderError();
}
function choosePortal(portal) {
  state.portal = portal;
  setError(null);
  $('step-role').hidden = true;
  $('login-form').hidden = false;
  renderDynamicText();
  $('email').focus();
}

function wireUI() {
  $('view-loading').append(skeleton(3));
  document.querySelectorAll('[data-portal]').forEach((b) => b.addEventListener('click', () => choosePortal(b.dataset.portal)));
  $('back-btn').addEventListener('click', () => { state.portal = null; setError(null); showRoleStep(); renderDynamicText(); });
  $('login-form').addEventListener('submit', handleLogin);
  $('lang-select').addEventListener('change', (e) => applyLanguage(e.target.value));
  $('theme-btn').addEventListener('click', () => applyTheme(state.theme === 'dark' ? 'light' : 'dark'));
  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', (e) => { if (P.form && hasUnsaved(P.form)) { e.preventDefault(); e.returnValue = ''; } });

  // profile card
  $('avatar-btn').addEventListener('click', () => toggleProfileCard($('profile-card').hidden));
  $('pc-close').addEventListener('click', () => closeProfileCard(true));
  $('pc-change-name').addEventListener('click', openChangeName);
  $('pc-info').addEventListener('click', openPersonalInfo);
  $('pc-chat').addEventListener('click', () => { closeProfileCard(false); location.hash = '#/chat'; });   // Phase 13
  document.addEventListener('click', chatCloseMenuOnce);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && CH.view && CH.activeId && chatNear()) chatMarkRead(); });
  $('pc-pencil').addEventListener('click', openAvatarPicker);
  $('pc-logout').addEventListener('click', handleLogout);
  document.addEventListener('click', (e) => {
    if (!$('profile-card').hidden && !e.target.closest('#profile-card') && !e.target.closest('#avatar-btn')) closeProfileCard(false);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeProfileCard(true); closeNotifPanel(true); } });

  // admin notifications (bell exists for admins only; see Phase 8)
  $('bell-btn').addEventListener('click', () => { if ($('notif-panel').hidden) openNotifPanel(); else closeNotifPanel(true); });
  $('notif-close').addEventListener('click', () => closeNotifPanel(true));
  document.addEventListener('click', (e) => {   // composedPath: still correct if the clicked button was re-rendered away
    const path = e.composedPath();
    if (!$('notif-panel').hidden && !path.includes($('notif-panel')) && !path.includes($('bell-btn'))) closeNotifPanel(false);
  });
  window.addEventListener('focus', refreshNotifOnFocus);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshNotifOnFocus(); });

  // modal
  $('modal-close').addEventListener('click', closeModal);
  $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });   // backdrop click
  $('modal').addEventListener('close', () => {
    $('modal').classList.remove('modal-wide'); EV = null;   // Phase 9 evaluation modal
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  });
}

/* ===== Boot ===== */
function showLoginWith(errorKey) {
  state.profile = null;
  showRoleStep();
  setError(errorKey);
  location.hash = '#/login';
  route();
}

async function boot() {
  wireUI();
  applyTheme(store.get('theme') ||
    (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  applyLanguage(store.get('lang') || 'ar');

  if (!configIsValid()) return showLoginWith('err.config');
  if (!window.supabase) return showLoginWith('err.network');

  sb = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  });
  updateLogo();

  // Session ended elsewhere (other tab, expiry): back to login. Deferred so no Supabase call runs inside the callback.
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') setTimeout(() => { state.profile = null; route(); }, 0);
  });

  // Session restoration
  try {
    const { data } = await sb.auth.getSession();
    if (data.session) { await enterApp(data.session, null); return; }
  } catch (e) {
    return showLoginWith(authErrorKey(e));
  }
  showLoginWith(null);
}

document.addEventListener('DOMContentLoaded', boot);