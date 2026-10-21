// Cálculos financieros: conversiones, totales, proyecciones y presupuestos.

import * as store from './store.js';

// ---------- Fechas ----------

export const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => toISODate(new Date());
export const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const monthKey = (s) => s.slice(0, 7);
export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
export const addMonths = (d, n) => {
  const x = new Date(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x;
};
// Lunes de la semana de la fecha dada.
export const weekStart = (d) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (x.getDay() + 6) % 7;
  return addDays(x, -dow);
};
export const shiftMonthKey = (key, n) => {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const monthName = (key) => {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
export const shortMonth = (key) => MONTHS[Number(key.slice(5, 7)) - 1].slice(0, 3);
export const formatDate = (s) => {
  const d = parseDate(s);
  return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
};

// ---------- Moneda ----------

export function toMXN(amount, currency) {
  return currency === 'USD' ? amount * store.getSettings().usdRate : amount;
}
export function fromMXN(amountMXN, currency) {
  return currency === 'USD' ? amountMXN / store.getSettings().usdRate : amountMXN;
}
// Convierte cualquier monto a la moneda de visualización.
export function toDisplay(amount, currency = 'MXN') {
  return fromMXN(toMXN(amount, currency), store.getSettings().displayCurrency);
}
export function money(amountInDisplay, { currency, sign = false, decimals } = {}) {
  const cur = currency || store.getSettings().displayCurrency;
  // En pesos se muestran centavos solo en montos chicos con decimales; promedios y totales grandes van redondeados.
  const abs = Math.abs(amountInDisplay);
  const d = decimals ?? (cur === 'USD' ? 2 : abs % 1 >= 0.005 && abs < 100 ? 2 : 0);
  const s = new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: cur,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  }).format(Math.abs(amountInDisplay));
  const prefix = amountInDisplay < 0 ? '−' : sign && amountInDisplay > 0 ? '+' : '';
  return `${prefix}${s}${cur === 'USD' ? ' USD' : ''}`;
}
// Formatea un monto guardado en MXN en la moneda de visualización.
export const fmt = (mxn, opts) => money(fromMXN(mxn, store.getSettings().displayCurrency), opts);

export async function refreshUsdRate() {
  const res = await fetch('https://open.er-api.com/v6/latest/USD');
  if (!res.ok) throw new Error('No se pudo obtener el tipo de cambio');
  const json = await res.json();
  const rate = json?.rates?.MXN;
  if (!rate) throw new Error('Respuesta de tipo de cambio inválida');
  store.updateSettings({ usdRate: Math.round(rate * 100) / 100, usdRateUpdated: new Date().toISOString() });
  return rate;
}

// ---------- Movimientos ----------

export const amountMXN = (t) => toMXN(Number(t.amount) || 0, t.currency || 'MXN');

export function txInRange(from, to) {
  return store.list('transactions').filter((t) => t.date >= from && t.date <= to);
}
export function txInMonth(key) {
  return store.list('transactions').filter((t) => monthKey(t.date) === key);
}

export function totals(txs) {
  let income = 0;
  let expense = 0;
  for (const t of txs) {
    if (t.type === 'ingreso') income += amountMXN(t);
    else if (t.type === 'gasto') expense += amountMXN(t);
  }
  return { income, expense, net: income - expense };
}

export function byCategory(txs, type = 'gasto') {
  const map = new Map();
  for (const t of txs) {
    if (t.type !== type) continue;
    map.set(t.categoryId, (map.get(t.categoryId) || 0) + amountMXN(t));
  }
  return [...map.entries()]
    .map(([categoryId, total]) => ({ category: store.get('categories', categoryId) || { name: 'Sin categoría', icon: '❔', color: '#64748b' }, categoryId, total }))
    .sort((a, b) => b.total - a.total);
}

// Saldo de cada cuenta en su propia moneda.
export function accountBalances() {
  const accounts = store.list('accounts');
  const bal = Object.fromEntries(accounts.map((a) => [a.id, Number(a.initialBalance) || 0]));
  const conv = (t, accId) => {
    const acc = accounts.find((a) => a.id === accId);
    if (!acc) return 0;
    return fromMXN(amountMXN(t), acc.currency);
  };
  for (const t of store.list('transactions')) {
    if (t.date > today()) continue;
    if (t.type === 'ingreso' && t.accountId in bal) bal[t.accountId] += conv(t, t.accountId);
    if (t.type === 'gasto' && t.accountId in bal) bal[t.accountId] -= conv(t, t.accountId);
    if (t.type === 'transferencia') {
      if (t.accountId in bal) bal[t.accountId] -= conv(t, t.accountId);
      if (t.toAccountId in bal) bal[t.toAccountId] += conv(t, t.toAccountId);
    }
  }
  return accounts.map((a) => ({ account: a, balance: bal[a.id], balanceMXN: toMXN(bal[a.id], a.currency) }));
}

export function netWorthMXN() {
  return accountBalances().reduce((s, b) => s + b.balanceMXN, 0);
}

export function goalSavedMXN(goal) {
  return (goal.contributions || []).reduce((s, c) => s + toMXN(Number(c.amount) || 0, goal.currency || 'MXN'), 0);
}
export function totalReservedMXN() {
  return store.list('goals').filter((g) => !g.completed).reduce((s, g) => s + goalSavedMXN(g), 0);
}

// ---------- Límites por categoría (alertas) ----------

export function categoryAlerts(key = monthKey(today())) {
  const spent = new Map(byCategory(txInMonth(key)).map((x) => [x.categoryId, x.total]));
  return store
    .list('categories')
    .filter((c) => c.type === 'gasto' && Number(c.limit) > 0)
    .map((c) => {
      const s = spent.get(c.id) || 0;
      const pct = s / Number(c.limit);
      return { category: c, spent: s, limit: Number(c.limit), pct, level: pct >= 1 ? 'danger' : pct >= 0.8 ? 'warn' : 'ok' };
    })
    .sort((a, b) => b.pct - a.pct);
}

// ---------- Recurrentes ----------

function nextDate(date, frequency) {
  if (frequency === 'semanal') return addDays(date, 7);
  if (frequency === 'quincenal') return addDays(date, 14);
  if (frequency === 'anual') return addMonths(date, 12);
  return addMonths(date, 1);
}

export function occurrences(rec, until) {
  const out = [];
  let d = parseDate(rec.startDate);
  const end = parseDate(until);
  const stop = rec.endDate ? parseDate(rec.endDate) : null;
  let guard = 0;
  while (d <= end && guard++ < 1000) {
    if (stop && d > stop) break;
    out.push(toISODate(d));
    d = nextDate(d, rec.frequency);
  }
  return out;
}

// Crea los movimientos de los recurrentes que ya tocaban hasta hoy.
export function generateRecurring() {
  const t = today();
  const created = [];
  for (const rec of store.list('recurring')) {
    if (rec.active === false) continue;
    const dates = occurrences(rec, t).filter((d) => !rec.lastGenerated || d > rec.lastGenerated);
    if (!dates.length) continue;
    for (const date of dates) {
      created.push({
        id: `rec-${rec.id}-${date}`,
        type: rec.type,
        amount: rec.amount,
        currency: rec.currency,
        categoryId: rec.categoryId,
        accountId: rec.accountId,
        note: rec.note || rec.name,
        date,
        recurringId: rec.id,
      });
    }
    store.save('recurring', { ...rec, lastGenerated: dates[dates.length - 1] }, { silent: true });
  }
  if (created.length) store.saveMany('transactions', created);
  return created.length;
}

// Monto mensual equivalente de los recurrentes de un tipo.
export function recurringMonthlyMXN(type) {
  const factor = { semanal: 52 / 12, quincenal: 26 / 12, mensual: 1, anual: 1 / 12 };
  return store
    .list('recurring')
    .filter((r) => r.active !== false && r.type === type)
    .reduce((s, r) => s + toMXN(Number(r.amount) || 0, r.currency) * (factor[r.frequency] || 1), 0);
}

// ---------- Citas ----------

export function appointmentPay(n) {
  const s = store.getSettings();
  return Math.max(Number(s.weeklyMinimum) || 0, (Number(n) || 0) * (Number(s.ratePerAppointment) || 0));
}

// ---------- Estadísticas semanales ----------

// Totales por semana (lunes a domingo) de las últimas `weeks` semanas completas.
export function weeklyHistory(weeks = 12) {
  const currentWeek = weekStart(new Date());
  const out = [];
  for (let i = weeks; i >= 1; i--) {
    const start = addDays(currentWeek, -7 * i);
    const end = addDays(start, 6);
    const tot = totals(txInRange(toISODate(start), toISODate(end)));
    out.push({ start: toISODate(start), ...tot });
  }
  return out;
}

export function firstTxDate() {
  const txs = store.list('transactions');
  return txs.length ? txs.reduce((m, t) => (t.date < m ? t.date : m), txs[0].date) : null;
}

// Promedios semanales usando solo semanas desde que empezaste a registrar.
export function weeklyStats() {
  const s = store.getSettings();
  const first = firstTxDate();
  const hist = weeklyHistory(12).filter((w) => first && addDays(parseDate(w.start), 6) >= parseDate(first));
  const incomeWeeks = hist.filter((w) => w.income > 0);
  const avg = (arr, k) => (arr.length ? arr.reduce((a, w) => a + w[k], 0) / arr.length : 0);
  const fallbackIncome = Number(s.weeklyMinimum) || 0;
  const recurringExpenseWeekly = (recurringMonthlyMXN('gasto') * 12) / 52;

  const avgIncome = incomeWeeks.length ? avg(incomeWeeks, 'income') : fallbackIncome;
  const avgExpense = hist.length ? Math.max(avg(hist, 'expense'), recurringExpenseWeekly) : recurringExpenseWeekly;
  return {
    weeksOfData: hist.length,
    avgIncome,
    minIncome: incomeWeeks.length ? Math.min(...incomeWeeks.map((w) => w.income)) : fallbackIncome,
    maxIncome: incomeWeeks.length ? Math.max(...incomeWeeks.map((w) => w.income)) : appointmentPay(s.goodWeekAppointments),
    avgExpense,
  };
}

// ---------- Presupuesto de compra ----------

// Calcula cuánto ahorrar y en cuánto tiempo para comprar algo.
// price y alreadySaved en MXN.
export function purchasePlan({ price, alreadySaved = 0, targetWeeks = null, extraWeeklyExpense = 0 }) {
  const s = store.getSettings();
  const st = weeklyStats();
  const needed = Math.max(0, price - alreadySaved);
  const expense = st.avgExpense + extraWeeklyExpense;
  const scenarios = [
    { key: 'malo', label: 'Semana floja', income: Number(s.weeklyMinimum) || st.minIncome },
    { key: 'promedio', label: 'Semana promedio', income: st.avgIncome },
    { key: 'bueno', label: 'Semana buena', income: Math.max(appointmentPay(s.goodWeekAppointments), st.maxIncome) },
  ].map((sc) => {
    const surplus = sc.income - expense;
    const weeks = needed === 0 ? 0 : surplus > 0 ? Math.ceil(needed / surplus) : Infinity;
    return { ...sc, expense, surplus, weeks, date: Number.isFinite(weeks) ? toISODate(addDays(new Date(), weeks * 7)) : null };
  });

  let target = null;
  if (targetWeeks && targetWeeks > 0) {
    const perWeek = needed / targetWeeks;
    const avgSurplus = st.avgIncome - expense;
    target = {
      weeks: targetWeeks,
      perWeek,
      perDay: perWeek / 7,
      pctOfIncome: st.avgIncome > 0 ? perWeek / st.avgIncome : null,
      feasible: perWeek <= avgSurplus,
      cutNeeded: Math.max(0, perWeek - avgSurplus),
      date: toISODate(addDays(new Date(), targetWeeks * 7)),
    };
  }
  return { needed, stats: st, scenarios, target };
}

// ---------- Proyecciones ----------

// Proyección de los próximos `months` meses a partir del promedio reciente.
export function projection(months = 6) {
  const st = weeklyStats();
  const weeksPerMonth = 52 / 12;
  const monthlyIncome = Math.max(st.avgIncome * weeksPerMonth, recurringMonthlyMXN('ingreso'));
  const monthlyExpense = st.avgExpense * weeksPerMonth;
  const start = monthKey(today());
  let balance = netWorthMXN();
  const out = [];
  for (let i = 1; i <= months; i++) {
    balance += monthlyIncome - monthlyExpense;
    out.push({ month: shiftMonthKey(start, i), income: monthlyIncome, expense: monthlyExpense, balance });
  }
  return { monthlyIncome, monthlyExpense, rows: out, startBalance: netWorthMXN() };
}

// Ingresos y gastos de los últimos `n` meses (incluye el actual).
export function monthlyHistory(n = 6, endKey = monthKey(today())) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const key = shiftMonthKey(endKey, -i);
    out.push({ month: key, ...totals(txInMonth(key)) });
  }
  return out;
}

// ---------- Resumen mensual ----------

export function monthSummary(key) {
  const txs = txInMonth(key);
  const cur = totals(txs);
  const prevKey = shiftMonthKey(key, -1);
  const prev = totals(txInMonth(prevKey));
  const cats = byCategory(txs);
  const prevCats = new Map(byCategory(txInMonth(prevKey)).map((c) => [c.categoryId, c.total]));
  const changes = cats
    .map((c) => ({ ...c, prev: prevCats.get(c.categoryId) || 0, diff: c.total - (prevCats.get(c.categoryId) || 0) }))
    .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  const days = key === monthKey(today()) ? new Date().getDate() : new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)), 0).getDate();
  const biggest = txs.filter((t) => t.type === 'gasto').sort((a, b) => amountMXN(b) - amountMXN(a)).slice(0, 5);
  return {
    key,
    ...cur,
    prev,
    savingsRate: cur.income > 0 ? cur.net / cur.income : null,
    dailyExpense: days ? cur.expense / days : 0,
    cats,
    changes,
    biggest,
    count: txs.length,
  };
}

// Texto plano con el resumen, útil para pegárselo a Claude.
export function summaryText(key) {
  const s = monthSummary(key);
  const st = weeklyStats();
  const lines = [
    `Resumen de ${monthName(key)} (montos en MXN)`,
    `Ingresos: ${Math.round(s.income)} | Gastos: ${Math.round(s.expense)} | Balance: ${Math.round(s.net)}`,
    `Mes anterior: ingresos ${Math.round(s.prev.income)}, gastos ${Math.round(s.prev.expense)}`,
    `Promedio semanal (últimas semanas): ingreso ${Math.round(st.avgIncome)}, gasto ${Math.round(st.avgExpense)}`,
    `Saldo total en cuentas: ${Math.round(netWorthMXN())}; apartado en metas: ${Math.round(totalReservedMXN())}`,
    'Gastos por categoría:',
    ...s.cats.map((c) => `- ${c.category.name}: ${Math.round(c.total)}`),
    'Metas:',
    ...store.list('goals').map((g) => `- ${g.name}: ${Math.round(goalSavedMXN(g))} de ${Math.round(toMXN(g.target, g.currency))}`),
  ];
  return lines.join('\n');
}
