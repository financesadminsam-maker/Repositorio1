// Almacenamiento local-first: todo se guarda en localStorage y, si Supabase
// está configurado y hay sesión iniciada, se sincroniza con la nube.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LS_KEY = 'finanzas.v1';
const KINDS = ['accounts', 'categories', 'transactions', 'recurring', 'goals', 'simItems'];

export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

const nowISO = () => new Date().toISOString();

const DEFAULT_SETTINGS = {
  displayCurrency: 'MXN',
  usdRate: 18.5, // pesos por dólar
  usdRateUpdated: null,
  ratePerAppointment: 100,
  weeklyMinimum: 1500,
  goodWeekAppointments: 22,
  appointmentsCategoryId: 'cat-citas',
};

function defaultData() {
  const t = nowISO();
  const cat = (id, name, icon, color, type, limit = 0) => ({ id, name, icon, color, type, limit, updatedAt: t });
  return {
    settings: { ...DEFAULT_SETTINGS, updatedAt: t },
    accounts: [
      { id: 'acc-efectivo', name: 'Efectivo', type: 'efectivo', currency: 'MXN', initialBalance: 0, updatedAt: t },
      { id: 'acc-debito', name: 'Tarjeta de débito', type: 'debito', currency: 'MXN', initialBalance: 0, updatedAt: t },
    ],
    categories: [
      cat('cat-citas', 'Citas (Psicólogo)', '🧠', '#4ade80', 'ingreso'),
      cat('cat-extra', 'Trabajo extra', '💼', '#22d3ee', 'ingreso'),
      cat('cat-otros-ing', 'Otros ingresos', '💰', '#a3e635', 'ingreso'),
      cat('cat-comida', 'Comida', '🍔', '#f97316', 'gasto'),
      cat('cat-transporte', 'Transporte', '🚌', '#60a5fa', 'gasto'),
      cat('cat-casa', 'Casa y servicios', '🏠', '#a78bfa', 'gasto'),
      cat('cat-suscripciones', 'Suscripciones', '📺', '#f472b6', 'gasto'),
      cat('cat-salud', 'Salud', '💊', '#34d399', 'gasto'),
      cat('cat-ocio', 'Ocio y salidas', '🎮', '#facc15', 'gasto'),
      cat('cat-tecnologia', 'Tecnología', '💻', '#38bdf8', 'gasto'),
      cat('cat-ropa', 'Ropa', '👕', '#fb7185', 'gasto'),
      cat('cat-otros', 'Otros gastos', '📦', '#94a3b8', 'gasto'),
    ],
    transactions: [],
    recurring: [],
    goals: [],
    simItems: [], // ingresos y gastos supuestos del simulador (no son movimientos reales)
    meta: { lastPull: null, dirty: {} },
  };
}

let data = load();
const listeners = new Set();

function load() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const base = defaultData();
      return {
        ...base,
        ...parsed,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings || {}) },
        meta: { lastPull: null, dirty: {}, ...(parsed.meta || {}) },
      };
    }
  } catch (e) {
    console.warn('No se pudo leer el almacenamiento local', e);
  }
  return defaultData();
}

function persist() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('No se pudo guardar en el almacenamiento local', e);
  }
}

function emit() {
  persist();
  listeners.forEach((fn) => fn());
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------- Lectura ----------

export const getSettings = () => data.settings;
export const list = (kind) => data[kind].filter((x) => !x.deleted);
export const get = (kind, id) => data[kind].find((x) => x.id === id && !x.deleted);
// Incluye los eliminados: sirve para no volver a crear algo que el usuario borró.
export const exists = (kind, id) => data[kind].some((x) => x.id === id);

// ---------- Escritura ----------

function markDirty(kind, id) {
  data.meta.dirty[`${kind}:${id}`] = true;
  scheduleSync();
}

export function save(kind, obj, { silent = false } = {}) {
  const item = { ...obj, id: obj.id || uid(), updatedAt: nowISO() };
  const i = data[kind].findIndex((x) => x.id === item.id);
  if (i >= 0) data[kind][i] = { ...data[kind][i], ...item };
  else data[kind].push(item);
  markDirty(kind, item.id);
  if (!silent) emit();
  return item;
}

export function saveMany(kind, items) {
  const saved = items.map((it) => save(kind, it, { silent: true }));
  emit();
  return saved;
}

export function remove(kind, id) {
  const item = data[kind].find((x) => x.id === id);
  if (!item) return;
  item.deleted = true;
  item.updatedAt = nowISO();
  markDirty(kind, id);
  emit();
}

export function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch, updatedAt: nowISO() };
  markDirty('settings', 'settings');
  emit();
}

// ---------- Respaldo ----------

export function exportBackup() {
  const { meta, ...rest } = data;
  return { version: 1, exportedAt: nowISO(), ...rest };
}

export function importBackup(backup) {
  if (!backup || !Array.isArray(backup.transactions)) throw new Error('Archivo de respaldo no válido');
  const base = defaultData();
  data = {
    ...base,
    settings: { ...DEFAULT_SETTINGS, ...(backup.settings || {}) },
    ...Object.fromEntries(KINDS.map((k) => [k, backup[k] || base[k]])),
    meta: { lastPull: null, dirty: {} },
  };
  // Marca todo como pendiente para subirlo a la nube.
  KINDS.forEach((k) => data[k].forEach((x) => (data.meta.dirty[`${k}:${x.id}`] = true)));
  data.meta.dirty['settings:settings'] = true;
  emit();
  scheduleSync();
}

// ---------- Sincronización con Supabase ----------

let client = null;
let session = null;
let syncTimer = null;
let syncing = false;
export const syncState = { status: 'local', message: 'Guardado solo en este dispositivo', email: null };

export const cloudConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);

function setSync(status, message) {
  syncState.status = status;
  syncState.message = message;
  listeners.forEach((fn) => fn());
}

export async function initCloud() {
  if (!cloudConfigured()) return;
  client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const { data: s } = await client.auth.getSession();
  session = s.session;
  syncState.email = session?.user?.email || null;
  client.auth.onAuthStateChange((_evt, newSession) => {
    const wasLoggedOut = !session;
    session = newSession;
    syncState.email = newSession?.user?.email || null;
    if (newSession && wasLoggedOut) sync();
    if (!newSession) setSync('local', 'Sesión cerrada: guardado solo en este dispositivo');
  });
  if (session) await sync();
  else setSync('local', 'Inicia sesión para sincronizar entre dispositivos');
  window.addEventListener('online', () => sync());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
}

export async function signIn(email, password) {
  if (!client) throw new Error('Supabase no está configurado');
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUp(email, password) {
  if (!client) throw new Error('Supabase no está configurado');
  const { error } = await client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}

export async function signOut() {
  if (client) await client.auth.signOut();
}

function scheduleSync() {
  if (!client || !session) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(sync, 1200);
}

function findLocal(kind, id) {
  if (kind === 'settings') return data.settings;
  return data[kind]?.find((x) => x.id === id);
}

export async function sync() {
  if (!client || !session || syncing) return;
  if (!navigator.onLine) return setSync('offline', 'Sin internet: se sincronizará al reconectar');
  syncing = true;
  setSync('syncing', 'Sincronizando…');
  try {
    const userId = session.user.id;

    // 1) Subir cambios pendientes.
    const keys = Object.keys(data.meta.dirty);
    if (keys.length) {
      const rows = keys
        .map((key) => {
          const [kind, id] = key.split(/:(.+)/);
          const item = findLocal(kind, id);
          if (!item) return null;
          // updated_at lo pone el servidor (trigger), así no dependemos del reloj del dispositivo.
          return { user_id: userId, kind, id, data: item, deleted: !!item.deleted };
        })
        .filter(Boolean);
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await client.from('items').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,kind,id' });
        if (error) throw error;
      }
      keys.forEach((k) => delete data.meta.dirty[k]);
    }

    // 2) Bajar cambios hechos en otros dispositivos.
    let query = client.from('items').select('kind,id,data,updated_at').order('updated_at', { ascending: true }).limit(5000);
    if (data.meta.lastPull) query = query.gt('updated_at', data.meta.lastPull);
    const { data: remote, error } = await query;
    if (error) throw error;
    let latest = data.meta.lastPull;
    for (const row of remote || []) {
      const incoming = row.data;
      if (row.kind === 'settings') {
        if (!data.settings.updatedAt || incoming.updatedAt >= data.settings.updatedAt) data.settings = { ...DEFAULT_SETTINGS, ...incoming };
      } else if (data[row.kind]) {
        const i = data[row.kind].findIndex((x) => x.id === row.id);
        if (i < 0) data[row.kind].push(incoming);
        else if (!data[row.kind][i].updatedAt || incoming.updatedAt >= data[row.kind][i].updatedAt) data[row.kind][i] = incoming;
      }
      if (!latest || row.updated_at > latest) latest = row.updated_at;
    }
    data.meta.lastPull = latest;
    persist();
    setSync('synced', `Sincronizado · ${new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (e) {
    console.error(e);
    setSync('error', `Error al sincronizar: ${e.message || e}`);
  } finally {
    syncing = false;
    if (Object.keys(data.meta.dirty).length) scheduleSync();
  }
}
