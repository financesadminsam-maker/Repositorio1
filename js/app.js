import * as store from './store.js';
import * as calc from './calc.js';
import * as charts from './charts.js';
import * as csv from './csv.js';
import { renderModal, closeModal, toast, esc, $, $$ } from './ui.js';
import * as sim from './simulator.js';

const { fmt, today, monthKey } = calc;

const state = {
  view: 'inicio',
  month: monthKey(today()),
  txFilter: { type: 'todos', categoryId: '', q: '' },
  plan: { name: 'Memoria RAM', price: 1600, currency: 'MXN', saved: 0, weeks: '' },
};

const NAV = [
  { view: 'inicio', ico: '🏠', label: 'Inicio' },
  { view: 'movimientos', ico: '📋', label: 'Movimientos' },
  { view: 'metas', ico: '🎯', label: 'Metas' },
  { view: 'simulador', ico: '🧪', label: 'Simulador' },
  { view: 'analisis', ico: '📊', label: 'Análisis' },
  { view: 'ajustes', ico: '⚙️', label: 'Ajustes' },
];

const ACCOUNT_TYPES = { efectivo: '💵 Efectivo', debito: '💳 Débito', credito: '💳 Crédito', ahorro: '🏦 Ahorro', otro: '👛 Otro' };
const FREQ = { dias: 'Cada cierto número de días', semanal: 'Cada semana', quincenal: 'Cada 2 semanas', mensual: 'Cada mes', anual: 'Cada año' };
const FREQ_ALL = { ...FREQ, fechas: 'En fechas que yo elija (deuda o pagos a plazos)' };
function freqLabel(r) {
  const base =
    r.frequency === 'fechas'
      ? 'Fechas elegidas'
      : r.frequency === 'dias'
        ? `Cada ${Number(r.everyDays) || 1} ${Number(r.everyDays) === 1 ? 'día' : 'días'}`
        : FREQ[r.frequency];
  const pr = calc.recurringProgress(r);
  if (!pr) return base;
  if (!pr.left) return `${base} · ✅ liquidado (${pr.total} pagos)`;
  return `${base} · faltan ${pr.left} de ${pr.total} pagos (${calc.money(pr.leftAmount, { currency: r.currency })}) · próximo ${calc.formatDate(pr.next.date)}`;
}
const COLORS = ['#f97316', '#facc15', '#a3e635', '#4ade80', '#34d399', '#22d3ee', '#38bdf8', '#60a5fa', '#818cf8', '#a78bfa', '#e879f9', '#f472b6', '#fb7185', '#94a3b8'];

const cat = (id) => store.get('categories', id) || { name: 'Sin categoría', icon: '❔', color: '#64748b' };
const acc = (id) => store.get('accounts', id);
const isCurrentMonth = () => state.month === monthKey(today());
const soft = (color) => `${color}26`;

// ---------- Navegación y estructura ----------

function renderNav() {
  const side = NAV.map(
    (n) => `<button class="nav-item ${state.view === n.view ? 'active' : ''}" data-action="go" data-view="${n.view}"><span class="ico">${n.ico}</span>${n.label}</button>`
  ).join('');
  $('#side-nav').innerHTML = side;
  // En el celular, Metas y Simulador comparten pestaña (se cambia arriba de la vista).
  const b = NAV.filter((n) => ['inicio', 'movimientos', 'metas', 'analisis'].includes(n.view));
  const isActive = (v) => state.view === v || (v === 'metas' && state.view === 'simulador');
  const item = (n) =>
    `<button class="nav-item ${isActive(n.view) ? 'active' : ''}" data-action="go" data-view="${n.view}"><span class="ico">${n.ico}</span>${n.label}</button>`;
  $('#bottom-nav').innerHTML = `${item(b[0])}${item(b[1])}<button class="fab" data-action="new-tx" aria-label="Nuevo movimiento">＋</button>${item(b[2])}${item(b[3])}`;

  $('#month-label').textContent = calc.monthName(state.month);
  const cur = store.getSettings().displayCurrency;
  $$('[data-action="currency"]').forEach((b) => b.classList.toggle('active', b.dataset.currency === cur));

  const sync = store.syncState;
  $('#sync-pill-side').innerHTML = `<span class="sync-dot ${sync.status}"></span><span>${esc(sync.message)}</span>`;
}

function render() {
  charts.destroyAll();
  renderNav();
  const views = { inicio: viewInicio, movimientos: viewMovimientos, metas: viewMetas, simulador: sim.viewSimulador, analisis: viewAnalisis, ajustes: viewAjustes };
  const fn = views[state.view] || viewInicio;
  $('#view').innerHTML = fn();
  afterRender[state.view]?.();
}

const afterRender = { simulador: () => sim.afterSimulador() };

// ---------- Componentes ----------

function txItem(t) {
  const c = t.type === 'transferencia' ? { name: 'Transferencia', icon: '🔁', color: '#818cf8' } : cat(t.categoryId);
  const a = acc(t.accountId);
  const to = t.toAccountId ? acc(t.toAccountId) : null;
  const cls = t.type === 'ingreso' ? 'income' : t.type === 'gasto' ? 'expense' : '';
  const sign = t.type === 'ingreso' ? 1 : t.type === 'gasto' ? -1 : 0;
  const mxn = calc.amountMXN(t);
  const showOriginal = (t.currency || 'MXN') !== store.getSettings().displayCurrency;
  const sub = [t.type === 'transferencia' ? `${a?.name || '?'} → ${to?.name || '?'}` : c.name, t.type !== 'transferencia' ? a?.name : null, t.recurringId ? '🔄' : null]
    .filter(Boolean)
    .join(' · ');
  return `<button class="list-item" data-action="edit-tx" data-id="${t.id}">
    <span class="cat-ico" style="background:${soft(c.color)}">${c.icon || '•'}</span>
    <span class="grow"><div class="li-title">${esc(t.note || c.name)}</div><div class="li-sub">${esc(sub)}</div></span>
    <span class="right"><div class="li-amount ${cls}">${fmt(sign * mxn || mxn, { sign: sign > 0 })}</div>${
      showOriginal ? `<div class="tiny muted">${calc.money(sign * Number(t.amount), { currency: t.currency })}</div>` : ''
    }</span>
  </button>`;
}

function emptyState(icon, text, action = '') {
  return `<div class="empty"><div class="big">${icon}</div><div>${text}</div>${action ? `<div style="margin-top:12px">${action}</div>` : ''}</div>`;
}

function alertsBlock() {
  const alerts = calc.categoryAlerts(state.month).filter((a) => a.level !== 'ok');
  if (!alerts.length) return '';
  return `<div class="stack">${alerts
    .map(
      (a) => `<div class="alert ${a.level}"><span>${a.level === 'danger' ? '⛔' : '⚠️'}</span><span><b>${esc(a.category.name)}</b>: llevas ${fmt(a.spent)} de ${fmt(a.limit)} (${Math.round(
        a.pct * 100
      )}%) este mes.${a.level === 'danger' ? ' Ya pasaste tu límite.' : ' Te estás acercando al límite.'}</span></div>`
    )
    .join('')}</div>`;
}

function catLegend(cats, total) {
  return cats
    .map(
      (c) => `<div class="legend-row"><span class="dot" style="background:${c.category.color}"></span><span>${c.category.icon || ''} ${esc(c.category.name)} <span class="muted tiny">${
        total ? Math.round((c.total / total) * 100) : 0
      }%</span></span><span class="num">${fmt(c.total)}</span></div>`
    )
    .join('');
}

function goalCard(g) {
  const saved = calc.goalSavedMXN(g);
  const target = calc.toMXN(Number(g.target) || 0, g.currency);
  const pct = target ? Math.min(1, saved / target) : 0;
  const st = calc.weeklyStats();
  const surplus = st.avgIncome - st.avgExpense;
  const left = Math.max(0, target - saved);
  const eta = left === 0 ? '¡Meta cumplida! 🎉' : surplus > 0 ? `Con tu ritmo promedio: ~${Math.ceil(left / surplus)} semanas` : 'Tus gastos promedio superan tus ingresos';
  return `<div class="card">
    <div class="row between"><div class="row"><span class="cat-ico" style="background:var(--accent-soft)">${esc(g.icon || '🎯')}</span><div><h3>${esc(g.name)}</h3><div class="tiny muted">${eta}${
      g.deadline ? ` · Fecha límite: ${calc.formatDate(g.deadline)}` : ''
    }</div></div></div>
    <button class="btn btn-ghost btn-sm" data-action="edit-goal" data-id="${g.id}">Editar</button></div>
    <div class="row between" style="margin:12px 0 6px"><span class="num"><b>${fmt(saved)}</b> <span class="muted">de ${fmt(target)}</span></span><span class="muted small">${Math.round(
      pct * 100
    )}%</span></div>
    <div class="bar ${pct >= 1 ? 'ok' : ''}"><span style="width:${pct * 100}%"></span></div>
    <div class="row" style="margin-top:12px">
      <button class="btn btn-sm" data-action="add-contribution" data-id="${g.id}">＋ Apartar dinero</button>
      ${pct >= 1 && !g.completed ? `<button class="btn btn-sm btn-primary" data-action="complete-goal" data-id="${g.id}">Ya lo compré</button>` : ''}
    </div>
  </div>`;
}

// ---------- Vista: Inicio ----------

function viewInicio() {
  const txs = calc.txInMonth(state.month);
  const tot = calc.totals(txs);
  const cats = calc.byCategory(txs);
  const net = calc.netWorthMXN();
  const reserved = calc.totalReservedMXN();
  const summary = calc.monthSummary(state.month);
  const recent = [...store.list('transactions')].filter((t) => t.date <= today()).sort((a, b) => (b.date + b.updatedAt > a.date + a.updatedAt ? 1 : -1)).slice(0, 6);
  const goals = store.list('goals').filter((g) => !g.completed).slice(0, 3);
  const upcoming = upcomingRecurring(14);
  const firstRun = !store.list('transactions').length;

  return `<div class="stack">
    ${
      firstRun
        ? `<div class="alert info"><span>👋</span><span>¡Bienvenido! Empieza registrando tu semana de citas o tu primer gasto. Puedes ajustar categorías, cuentas y tu pago por cita en <b>Ajustes</b>.</span></div>`
        : ''
    }
    ${alertsBlock()}
    <div class="grid grid-2">
      <div class="card hero">
        <div class="muted small">Dinero total en tus cuentas</div>
        <div class="value ${net < 0 ? 'expense' : ''}">${fmt(net)}</div>
        <div class="small muted" style="margin-top:4px">Apartado en metas: ${fmt(reserved)} · Libre: <b class="${net - reserved < 0 ? 'expense' : ''}">${fmt(net - reserved)}</b></div>
        <div class="row wrap" style="margin-top:14px">
          <button class="btn btn-primary" data-action="citas">🧠 Registrar semana de citas</button>
          <button class="btn" data-action="new-tx" data-type="gasto">− Gasto</button>
          <button class="btn" data-action="new-tx" data-type="ingreso">＋ Ingreso</button>
        </div>
      </div>
      <div class="kpis" style="grid-template-columns:repeat(2,1fr)">
        <div class="card kpi"><div class="label">Ingresos del mes</div><div class="value income">${fmt(tot.income)}</div><div class="sub">${deltaText(tot.income, summary.prev.income)}</div></div>
        <div class="card kpi"><div class="label">Gastos del mes</div><div class="value expense">${fmt(tot.expense)}</div><div class="sub">${deltaText(tot.expense, summary.prev.expense)}</div></div>
        <div class="card kpi"><div class="label">Balance del mes</div><div class="value ${tot.net < 0 ? 'expense' : ''}">${fmt(tot.net)}</div><div class="sub">${
          summary.savingsRate != null ? `Ahorras ${Math.round(summary.savingsRate * 100)}% de lo que ganas` : 'Sin ingresos aún'
        }</div></div>
        <div class="card kpi"><div class="label">Gasto por día</div><div class="value">${fmt(summary.dailyExpense)}</div><div class="sub">${isCurrentMonth() ? 'en lo que va del mes' : 'promedio del mes'}</div></div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>Gastos por categoría</h2><button class="btn btn-ghost btn-sm" data-action="go" data-view="analisis">Ver análisis</button></div>
        ${
          cats.length
            ? `<div class="donut-wrap"><div class="chart-box"><canvas id="ch-donut"></canvas></div><div>${catLegend(cats.slice(0, 7), tot.expense)}</div></div>`
            : emptyState('🍩', 'Aún no hay gastos este mes.')
        }
      </div>
      <div class="card">
        <div class="card-head"><h2>Últimos movimientos</h2><button class="btn btn-ghost btn-sm" data-action="go" data-view="movimientos">Ver todos</button></div>
        ${recent.length ? `<div class="list">${recent.map(txItem).join('')}</div>` : emptyState('🧾', 'Todavía no registras movimientos.')}
      </div>
    </div>

    <div class="grid grid-3">
      <div class="card">
        <div class="card-head"><h2>Cuentas</h2><button class="btn btn-ghost btn-sm" data-action="new-account">＋</button></div>
        <div class="list">${calc
          .accountBalances()
          .map(
            ({ account, balance }) => `<button class="list-item" data-action="edit-account" data-id="${account.id}"><span class="grow"><div class="li-title">${esc(account.name)}</div><div class="li-sub">${
              ACCOUNT_TYPES[account.type] || ''
            } · ${account.currency}</div></span><span class="li-amount ${balance < 0 ? 'expense' : ''}">${calc.money(balance, { currency: account.currency })}</span></button>`
          )
          .join('')}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Metas</h2><button class="btn btn-ghost btn-sm" data-action="go" data-view="metas">Ver metas</button></div>
        ${
          goals.length
            ? goals
                .map((g) => {
                  const saved = calc.goalSavedMXN(g);
                  const target = calc.toMXN(g.target, g.currency);
                  const pct = target ? Math.min(1, saved / target) : 0;
                  return `<div style="padding:8px 0"><div class="row between small"><span>${esc(g.icon || '🎯')} ${esc(g.name)}</span><span class="muted num">${fmt(saved)} / ${fmt(
                    target
                  )}</span></div><div class="bar" style="margin-top:6px"><span style="width:${pct * 100}%"></span></div></div>`;
                })
                .join('')
            : emptyState('🎯', '¿Quieres comprar algo? Calcula cuánto ahorrar.', `<button class="btn btn-sm" data-action="go" data-view="metas">Crear meta</button>`)
        }
      </div>
      <div class="card">
        <div class="card-head"><h2>Próximos 14 días</h2><button class="btn btn-ghost btn-sm" data-action="new-recurring">＋</button></div>
        ${
          upcoming.length
            ? `<div class="list">${upcoming
                .map(
                  (u) => `<div class="list-item"><span class="cat-ico" style="background:${soft(cat(u.rec.categoryId).color)}">${cat(u.rec.categoryId).icon}</span><span class="grow"><div class="li-title">${esc(
                    u.rec.name
                  )}</div><div class="li-sub">${calc.formatDate(u.date)}</div></span><span class="li-amount ${u.rec.type === 'ingreso' ? 'income' : 'expense'}">${fmt(
                    (u.rec.type === 'ingreso' ? 1 : -1) * calc.toMXN(u.amount, u.rec.currency),
                    { sign: u.rec.type === 'ingreso' }
                  )}</span></div>`
                )
                .join('')}</div>`
            : emptyState('🔄', 'Agrega tus pagos fijos (renta, Netflix, celular) para verlos aquí.')
        }
      </div>
    </div>
  </div>`;
}
afterRender.inicio = () => {
  const cats = calc.byCategory(calc.txInMonth(state.month));
  if (cats.length) charts.categoryDonut('ch-donut', cats);
};

function deltaText(cur, prev) {
  if (!prev) return 'vs. mes anterior: —';
  const d = (cur - prev) / prev;
  return `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}% vs. mes anterior`;
}

function upcomingRecurring(days) {
  const from = today();
  const until = calc.toISODate(calc.addDays(new Date(), days));
  const out = [];
  for (const rec of store.list('recurring')) {
    if (rec.active === false) continue;
    for (const o of calc.occurrences(rec, until)) if (o.date > from) out.push({ rec, date: o.date, amount: o.amount });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, 6);
}

// ---------- Vista: Movimientos ----------

function viewMovimientos() {
  const f = state.txFilter;
  let txs = calc.txInMonth(state.month);
  if (f.type !== 'todos') txs = txs.filter((t) => t.type === f.type);
  if (f.categoryId) txs = txs.filter((t) => t.categoryId === f.categoryId);
  if (f.q) {
    const q = f.q.toLowerCase();
    txs = txs.filter((t) => `${t.note || ''} ${cat(t.categoryId).name}`.toLowerCase().includes(q));
  }
  txs.sort((a, b) => (a.date === b.date ? (b.updatedAt > a.updatedAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  const tot = calc.totals(txs);
  const groups = new Map();
  txs.forEach((t) => {
    if (!groups.has(t.date)) groups.set(t.date, []);
    groups.get(t.date).push(t);
  });
  const types = [
    ['todos', 'Todos'],
    ['gasto', 'Gastos'],
    ['ingreso', 'Ingresos'],
    ['transferencia', 'Transferencias'],
  ];
  return `<div class="stack">
    <div class="card">
      <div class="row wrap between">
        <div class="chips">${types.map(([k, l]) => `<button class="chip btn-chip ${f.type === k ? 'active' : ''}" data-action="tx-filter-type" data-type="${k}">${l}</button>`).join('')}</div>
        <div class="row" style="flex:1;min-width:240px;max-width:460px">
          <input class="input" id="tx-search" placeholder="Buscar…" value="${esc(f.q)}" />
          <select class="input" id="tx-cat" style="max-width:180px"><option value="">Todas las categorías</option>${store
            .list('categories')
            .map((c) => `<option value="${c.id}" ${f.categoryId === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`)
            .join('')}</select>
        </div>
      </div>
      <div class="row wrap small" style="margin-top:12px;gap:16px">
        <span>Ingresos: <b class="income num">${fmt(tot.income)}</b></span>
        <span>Gastos: <b class="expense num">${fmt(tot.expense)}</b></span>
        <span>Balance: <b class="num">${fmt(tot.net)}</b></span>
        <span class="muted">${txs.length} movimientos</span>
      </div>
    </div>
    <div class="card">
      ${
        txs.length
          ? [...groups.entries()]
              .map(([date, items]) => {
                const t = calc.totals(items);
                return `<div class="day-head"><span>${calc.formatDate(date)}${date > today() ? ' · programado' : ''}</span><span class="num">${fmt(t.net, { sign: true })}</span></div><div class="list">${items
                  .map(txItem)
                  .join('')}</div>`;
              })
              .join('')
          : emptyState('🔍', `No hay movimientos en ${calc.monthName(state.month)}.`, `<button class="btn btn-primary btn-sm" data-action="new-tx">＋ Agregar movimiento</button>`)
      }
    </div>
  </div>`;
}
afterRender.movimientos = () => {
  const search = $('#tx-search');
  search.addEventListener('input', () => {
    state.txFilter.q = search.value;
    const pos = search.selectionStart;
    render();
    const s = $('#tx-search');
    s.focus();
    s.setSelectionRange(pos, pos);
  });
  $('#tx-cat').addEventListener('change', (e) => {
    state.txFilter.categoryId = e.target.value;
    render();
  });
};

// ---------- Vista: Metas y presupuesto de compra ----------

function viewMetas() {
  const p = state.plan;
  const goals = store.list('goals');
  const active = goals.filter((g) => !g.completed);
  const done = goals.filter((g) => g.completed);
  return `<div class="stack">
    ${sim.planTabs('metas')}
    <div class="card">
      <div class="card-head"><div><h2>🛒 ¿Cuánto me falta para comprarlo?</h2><div class="small muted">Calcula cuánto ahorrar y en cuánto tiempo, según lo que ganas y gastas.</div></div></div>
      <div class="form-grid">
        <label class="field full"><span>¿Qué quieres comprar?</span><input class="input" id="plan-name" value="${esc(p.name)}" /></label>
        <label class="field"><span>Precio</span><input class="input" id="plan-price" type="number" inputmode="decimal" min="0" value="${p.price}" /></label>
        <label class="field"><span>Moneda</span><select class="input" id="plan-currency"><option ${p.currency === 'MXN' ? 'selected' : ''}>MXN</option><option ${
          p.currency === 'USD' ? 'selected' : ''
        }>USD</option></select></label>
        <label class="field"><span>Ya tengo ahorrado para esto</span><input class="input" id="plan-saved" type="number" inputmode="decimal" min="0" value="${p.saved}" /></label>
        <label class="field"><span>Lo quiero en (semanas, opcional)</span><input class="input" id="plan-weeks" type="number" inputmode="numeric" min="1" placeholder="Ej. 4" value="${p.weeks}" /></label>
      </div>
      <div id="plan-result" style="margin-top:16px"></div>
    </div>

    ${fixedExpensesCard()}

    <div class="section-title"><h2>🎯 Mis metas</h2><button class="btn btn-sm btn-primary" data-action="new-goal">＋ Nueva meta</button></div>
    ${active.length ? `<div class="grid grid-2">${active.map(goalCard).join('')}</div>` : `<div class="card">${emptyState('🎯', 'Aún no tienes metas. Usa la calculadora de arriba y conviértela en meta.')}</div>`}
    ${
      done.length
        ? `<div class="card"><h3>Metas cumplidas</h3><div class="list" style="margin-top:8px">${done
            .map(
              (g) => `<button class="list-item" data-action="edit-goal" data-id="${g.id}"><span class="cat-ico" style="background:var(--income-soft)">${esc(g.icon || '✅')}</span><span class="grow"><div class="li-title">${esc(
                g.name
              )}</div><div class="li-sub">Cumplida</div></span><span class="li-amount">${fmt(calc.toMXN(g.target, g.currency))}</span></button>`
            )
            .join('')}</div></div>`
        : ''
    }
  </div>`;
}

// Gastos fijos (recurrentes) que se descuentan en los cálculos de metas y compras.
function fixedExpensesCard() {
  const recs = store.list('recurring').filter((r) => r.type === 'gasto');
  const weekly = (calc.recurringMonthlyMXN('gasto') * 12) / 52;
  const temps = recs.filter((r) => r.active !== false && calc.isTemporary(r));
  return `<div class="card">
    <div class="card-head"><div><h2>🔄 Gastos fijos y pagos temporales</h2><div class="small muted">Se descuentan solos en los cálculos de arriba${weekly ? `. Fijos: ${fmt(weekly)} por semana` : ''}${
      temps.length ? `. Temporales pendientes: ${fmt(temps.reduce((s, r) => s + calc.toMXN(calc.recurringProgress(r).leftAmount, r.currency), 0))}` : ''
    }.</div></div></div>
    <div class="row wrap" style="margin-bottom:8px"><button class="btn btn-sm" data-action="new-recurring">＋ Gasto fijo</button><button class="btn btn-sm" data-action="new-temporary">＋ Pago temporal o deuda</button></div>
    ${
      recs.length
        ? `<div class="list">${recs
            .map(
              (r) => `<button class="list-item" data-action="edit-recurring" data-id="${r.id}"><span class="cat-ico" style="background:${soft(cat(r.categoryId).color)}">${cat(r.categoryId).icon}</span><span class="grow"><div class="li-title">${esc(
                r.name
              )}${r.active === false ? ' <span class="chip">pausado</span>' : ''}</div><div class="li-sub">${freqLabel(r)}</div></span><span class="li-amount expense">${calc.money(Number(r.amount), { currency: r.currency })}</span></button>`
            )
            .join('')}</div>`
        : emptyState('🐱', 'Agrega lo que pagas seguido (comida de los gatos $80 cada 5 días) o pagos temporales (el aire acondicionado: 2 pagos de $600).')
    }
  </div>`;
}

function renderPlanResult() {
  const p = state.plan;
  const price = calc.toMXN(Number(p.price) || 0, p.currency);
  const saved = calc.toMXN(Number(p.saved) || 0, p.currency);
  const box = $('#plan-result');
  if (!box) return;
  if (!price) {
    box.innerHTML = `<div class="muted small">Escribe un precio para calcular.</div>`;
    return;
  }
  const plan = calc.purchasePlan({ price, alreadySaved: saved, targetWeeks: Number(p.weeks) || null });
  const st = plan.stats;
  const free = calc.netWorthMXN() - calc.totalReservedMXN();
  const weeksTxt = (w) => (w === 0 ? '¡Ya te alcanza!' : Number.isFinite(w) ? `${w} ${w === 1 ? 'semana' : 'semanas'}` : 'No alcanza');
  const t = plan.target;
  box.innerHTML = `
    <div class="grid grid-3">
      ${plan.scenarios
        .map(
          (s) => `<div class="scenario"><div class="small muted">${s.label} (ganas ${fmt(s.income)})</div><div class="big ${Number.isFinite(s.weeks) ? '' : 'expense'}">${weeksTxt(
            s.weeks
          )}</div><div class="small">${
            Number.isFinite(s.weeks) && s.weeks > 0
              ? `Ahorrando ${fmt(s.surplus)} por semana${s.temporary > 0 ? `, menos ${fmt(s.temporary)} de pagos temporales` : ''} · listo el ${calc.formatDate(s.date)}`
              : s.weeks === 0
                ? 'Ya tienes lo necesario.'
                : `Gastas más de lo que ganas (${fmt(s.surplus)}/sem)`
          }</div></div>`
        )
        .join('')}
    </div>
    ${
      t
        ? `<div class="alert ${t.feasible ? 'ok' : 'warn'}" style="margin-top:12px"><span>${t.feasible ? '✅' : '⚠️'}</span><span>Para tenerlo en <b>${t.weeks} semanas</b> (${calc.formatDate(
            t.date
          )}) necesitas apartar <b>${fmt(t.perWeek)} por semana</b> (${fmt(t.perDay)} al día${t.pctOfIncome != null ? `, ${Math.round(t.pctOfIncome * 100)}% de tu ingreso promedio` : ''}).${
            t.temporary > 0 ? ` En ese tiempo también te tocan ${fmt(t.temporary)} de pagos temporales.` : ''
          } ${
            t.feasible ? 'Te alcanza con tu ritmo actual.' : `Tendrías que recortar unos <b>${fmt(t.cutNeeded)} por semana</b> de tus gastos.`
          }</span></div>`
        : ''
    }
    ${
      free >= plan.needed && plan.needed > 0
        ? `<div class="alert info" style="margin-top:12px"><span>💡</span><span>Hoy tienes ${fmt(free)} libres en tus cuentas, así que podrías comprarlo ya, aunque te quedarías con ${fmt(
            free - plan.needed
          )}.</span></div>`
        : ''
    }
    <div class="chart-box" style="margin-top:14px"><canvas id="ch-plan"></canvas></div>
    <div class="tiny muted" style="margin-top:8px">Cálculo con ${
      st.weeksOfData ? `tus últimas ${st.weeksOfData} semanas registradas` : 'tu mínimo semanal (aún no hay historial)'
    }: ingreso promedio ${fmt(st.avgIncome)}/sem y gasto de ${fmt(st.avgExpense)}/sem (${fmt(st.avgVariableExpense)} de gastos del día a día + ${fmt(
      st.recurringExpenseWeekly
    )} de gastos fijos). Mientras más registres, más preciso será.</div>
    <div class="row" style="margin-top:12px"><button class="btn btn-primary" data-action="plan-to-goal">🎯 Convertir en meta</button></div>`;
  charts.savingsPlanLine('ch-plan', plan, saved);
}

afterRender.metas = () => {
  const bind = (id, key) =>
    $(id).addEventListener('input', (e) => {
      state.plan[key] = e.target.value;
      renderPlanResult();
    });
  bind('#plan-name', 'name');
  bind('#plan-price', 'price');
  bind('#plan-saved', 'saved');
  bind('#plan-weeks', 'weeks');
  $('#plan-currency').addEventListener('change', (e) => {
    state.plan.currency = e.target.value;
    renderPlanResult();
  });
  renderPlanResult();
};

// ---------- Vista: Análisis ----------

function viewAnalisis() {
  const s = calc.monthSummary(state.month);
  const proj = calc.projection(6);
  const limits = calc.categoryAlerts(state.month);
  const pct = (a, b) => (b ? `${a >= b ? '▲' : '▼'} ${Math.abs(Math.round(((a - b) / b) * 100))}%` : '—');
  const topChanges = s.changes.filter((c) => Math.abs(c.diff) >= 1).slice(0, 3);
  return `<div class="stack">
    <div class="card">
      <div class="card-head"><div><h2>Resumen de ${calc.monthName(state.month)}</h2><div class="small muted">${s.count} movimientos</div></div><button class="btn btn-sm" data-action="copy-summary">📋 Copiar resumen</button></div>
      <div class="kpis">
        <div class="kpi" style="padding:0"><div class="label">Ingresos</div><div class="value income">${fmt(s.income)}</div><div class="sub">${pct(s.income, s.prev.income)} vs. mes anterior</div></div>
        <div class="kpi" style="padding:0"><div class="label">Gastos</div><div class="value expense">${fmt(s.expense)}</div><div class="sub">${pct(s.expense, s.prev.expense)} vs. mes anterior</div></div>
        <div class="kpi" style="padding:0"><div class="label">Balance</div><div class="value">${fmt(s.net)}</div><div class="sub">${
          s.savingsRate != null ? `${Math.round(s.savingsRate * 100)}% de ahorro` : '—'
        }</div></div>
        <div class="kpi" style="padding:0"><div class="label">Gasto diario</div><div class="value">${fmt(s.dailyExpense)}</div><div class="sub">promedio</div></div>
      </div>
      <div class="stack" style="margin-top:14px">
        ${s.cats[0] ? `<div class="small">💸 Donde más gastaste: <b>${s.cats[0].category.icon} ${esc(s.cats[0].category.name)}</b> con ${fmt(s.cats[0].total)} (${Math.round((s.cats[0].total / (s.expense || 1)) * 100)}% del total).</div>` : ''}
        ${topChanges
          .map(
            (c) => `<div class="small">${c.diff > 0 ? '📈' : '📉'} ${c.category.icon} ${esc(c.category.name)}: ${c.diff > 0 ? 'gastaste' : 'ahorraste'} ${fmt(Math.abs(c.diff))} ${
              c.diff > 0 ? 'más' : 'menos'
            } que el mes pasado.</div>`
          )
          .join('')}
        ${s.biggest.length ? `<div class="small muted">Gastos más grandes: ${s.biggest.map((t) => `${esc(t.note || cat(t.categoryId).name)} (${fmt(calc.amountMXN(t))})`).join(', ')}</div>` : ''}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card"><div class="card-head"><h2>Ingresos vs. gastos (6 meses)</h2></div><div class="chart-box"><canvas id="ch-months"></canvas></div></div>
      <div class="card"><div class="card-head"><h2>Por semana (12 semanas)</h2></div><div class="chart-box"><canvas id="ch-weeks"></canvas></div></div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>🔮 Proyección a 6 meses</h2><div class="small muted">Si sigues como vas: ganarías ~${fmt(proj.monthlyIncome)} y gastarías ~${fmt(
        proj.monthlyExpense
      )} al mes.</div></div></div>
      <div class="chart-box tall"><canvas id="ch-proj"></canvas></div>
      <div class="table-scroll" style="margin-top:12px"><table class="table"><thead><tr><th>Mes</th><th class="right">Ingresos</th><th class="right">Gastos</th><th class="right">Saldo estimado</th></tr></thead><tbody>${proj.rows
        .map(
          (r) => `<tr><td style="text-transform:capitalize">${calc.monthName(r.month)}</td><td class="right num income">${fmt(r.income)}</td><td class="right num expense">${fmt(
            r.expense
          )}</td><td class="right num"><b>${fmt(r.balance)}</b></td></tr>`
        )
        .join('')}</tbody></table></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>Gastos por categoría</h2></div>
        ${s.cats.length ? `<div class="donut-wrap"><div class="chart-box"><canvas id="ch-donut2"></canvas></div><div>${catLegend(s.cats, s.expense)}</div></div>` : emptyState('🍩', 'Sin gastos este mes.')}
      </div>
      <div class="card">
        <div class="card-head"><h2>Límites por categoría</h2><button class="btn btn-ghost btn-sm" data-action="go" data-view="ajustes">Editar</button></div>
        ${
          limits.length
            ? limits
                .map(
                  (l) => `<div style="padding:7px 0"><div class="row between small"><span>${l.category.icon} ${esc(l.category.name)}</span><span class="num ${
                    l.level === 'danger' ? 'expense' : l.level === 'warn' ? 'warn-text' : 'muted'
                  }">${fmt(l.spent)} / ${fmt(l.limit)}</span></div><div class="bar ${l.level === 'ok' ? '' : l.level}" style="margin-top:6px"><span style="width:${Math.min(1, l.pct) * 100}%"></span></div></div>`
                )
                .join('')
            : emptyState('🚦', 'Ponle un límite mensual a tus categorías en Ajustes y te aviso cuando te acerques.')
        }
      </div>
    </div>
  </div>`;
}
afterRender.analisis = () => {
  const hist = calc.monthlyHistory(6, state.month);
  charts.incomeExpenseBars('ch-months', hist);
  charts.weeklyIncomeLine('ch-weeks', calc.weeklyHistory(12));
  charts.projectionLine('ch-proj', calc.monthlyHistory(4), calc.projection(6));
  const cats = calc.byCategory(calc.txInMonth(state.month));
  if (cats.length) charts.categoryDonut('ch-donut2', cats);
};

// ---------- Vista: Ajustes ----------

function viewAjustes() {
  const s = store.getSettings();
  const sync = store.syncState;
  const theme = document.documentElement.dataset.theme || 'dark';
  const catsOf = (type) =>
    store
      .list('categories')
      .filter((c) => c.type === type)
      .map(
        (c) => `<button class="list-item" data-action="edit-category" data-id="${c.id}"><span class="cat-ico" style="background:${soft(c.color)}">${c.icon}</span><span class="grow"><div class="li-title">${esc(
          c.name
        )}</div>${c.limit ? `<div class="li-sub">Límite: ${fmt(Number(c.limit))} al mes</div>` : ''}</span><span class="muted">›</span></button>`
      )
      .join('');

  return `<div class="stack">
    <div class="grid grid-2">
      <div class="card">
        <div class="card-head"><h2>☁️ Sincronización</h2></div>
        <div class="row small"><span class="sync-dot ${sync.status}"></span><span>${esc(sync.message)}</span></div>
        ${
          store.cloudConfigured()
            ? sync.email
              ? `<div class="small muted" style="margin-top:8px">Sesión: ${esc(sync.email)}</div><div class="row" style="margin-top:12px"><button class="btn btn-sm" data-action="sync-now">Sincronizar ahora</button><button class="btn btn-sm btn-danger" data-action="logout">Cerrar sesión</button></div>`
              : `<form id="login-form" class="stack" style="margin-top:12px"><input class="input" name="email" type="email" placeholder="Correo" required autocomplete="email" /><input class="input" name="password" type="password" placeholder="Contraseña" required minlength="6" autocomplete="current-password" /><div class="row"><button class="btn btn-primary grow" type="submit">Iniciar sesión</button><button class="btn grow" type="button" data-action="signup">Crear cuenta</button></div></form>`
            : `<div class="small muted" style="margin-top:8px">La nube aún no está conectada. Mientras tanto tus datos se guardan en este dispositivo. Usa "Respaldo" abajo para pasarlos a otro.</div>`
        }
      </div>
      <div class="card">
        <div class="card-head"><h2>🎨 Apariencia y moneda</h2></div>
        <div class="row between"><span>Tema</span><div class="seg"><button class="${theme === 'dark' ? 'active' : ''}" data-action="theme" data-theme="dark">Oscuro</button><button class="${
          theme === 'light' ? 'active' : ''
        }" data-action="theme" data-theme="light">Claro</button></div></div>
        <div class="row between" style="margin-top:14px"><span>Mostrar montos en</span><div class="seg"><button class="${s.displayCurrency === 'MXN' ? 'active' : ''}" data-action="currency" data-currency="MXN">MXN</button><button class="${
          s.displayCurrency === 'USD' ? 'active' : ''
        }" data-action="currency" data-currency="USD">USD</button></div></div>
        <label class="field" style="margin-top:14px"><span>Tipo de cambio (pesos por 1 dólar)</span><div class="row"><input class="input" id="usd-rate" type="number" step="0.01" min="0" value="${s.usdRate}" /><button class="btn" data-action="refresh-rate">Actualizar</button></div></label>
        <div class="tiny muted" style="margin-top:6px">${s.usdRateUpdated ? `Actualizado: ${new Date(s.usdRateUpdated).toLocaleString('es-MX')}` : 'Valor aproximado; toca Actualizar para el de hoy.'}</div>
      </div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>🧠 Mi pago por citas</h2><div class="small muted">Se usa en "Registrar semana de citas" y en los cálculos de presupuesto.</div></div></div>
      <div class="form-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <label class="field"><span>Pago por cita</span><input class="input" data-setting="ratePerAppointment" type="number" min="0" value="${s.ratePerAppointment}" /></label>
        <label class="field"><span>Mínimo semanal garantizado</span><input class="input" data-setting="weeklyMinimum" type="number" min="0" value="${s.weeklyMinimum}" /></label>
        <label class="field"><span>Citas en una semana buena</span><input class="input" data-setting="goodWeekAppointments" type="number" min="0" value="${s.goodWeekAppointments}" /></label>
        <label class="field"><span>Categoría del ingreso</span><select class="input" data-setting="appointmentsCategoryId">${store
          .list('categories')
          .filter((c) => c.type === 'ingreso')
          .map((c) => `<option value="${c.id}" ${s.appointmentsCategoryId === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`)
          .join('')}</select></label>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card"><div class="card-head"><h2>Categorías de gastos</h2><button class="btn btn-sm" data-action="new-category" data-type="gasto">＋ Agregar</button></div><div class="list">${catsOf('gasto')}</div></div>
      <div class="card"><div class="card-head"><h2>Categorías de ingresos</h2><button class="btn btn-sm" data-action="new-category" data-type="ingreso">＋ Agregar</button></div><div class="list">${catsOf('ingreso')}</div></div>
    </div>

    <div class="grid grid-2">
      <div class="card"><div class="card-head"><h2>Cuentas</h2><button class="btn btn-sm" data-action="new-account">＋ Agregar</button></div><div class="list">${store
        .list('accounts')
        .map(
          (a) => `<button class="list-item" data-action="edit-account" data-id="${a.id}"><span class="grow"><div class="li-title">${esc(a.name)}</div><div class="li-sub">${ACCOUNT_TYPES[a.type] || ''} · ${
            a.currency
          }</div></span><span class="muted">›</span></button>`
        )
        .join('')}</div></div>
      <div class="card"><div class="card-head"><h2>Gastos e ingresos recurrentes</h2><button class="btn btn-sm" data-action="new-recurring">＋ Agregar</button></div>${
        store.list('recurring').length
          ? `<div class="list">${store
              .list('recurring')
              .map(
                (r) => `<button class="list-item" data-action="edit-recurring" data-id="${r.id}"><span class="cat-ico" style="background:${soft(cat(r.categoryId).color)}">${cat(r.categoryId).icon}</span><span class="grow"><div class="li-title">${esc(
                  r.name
                )}${r.active === false ? ' <span class="chip">pausado</span>' : ''}</div><div class="li-sub">${freqLabel(r)} · desde ${calc.formatDate(r.startDate)}</div></span><span class="li-amount ${
                  r.type === 'ingreso' ? 'income' : 'expense'
                }">${calc.money(Number(r.amount), { currency: r.currency })}</span></button>`
              )
              .join('')}</div>`
          : emptyState('🔄', 'Ej. renta, Netflix, plan de celular. Se registran solos cuando llega la fecha.')
      }</div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>📁 Importar y exportar</h2><div class="small muted">Importa el estado de cuenta de tu banco o descarga tus datos.</div></div></div>
      <div class="row wrap">
        <button class="btn" data-action="import-csv">⬆️ Importar CSV del banco</button>
        <button class="btn" data-action="export-xlsx">📗 Descargar Excel</button>
        <button class="btn" data-action="export-csv">📄 Descargar CSV</button>
        <button class="btn" data-action="export-json">💾 Respaldo (JSON)</button>
        <button class="btn" data-action="import-json">♻️ Restaurar respaldo</button>
      </div>
    </div>
  </div>`;
}
afterRender.ajustes = () => {
  $('#usd-rate')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (v > 0) store.updateSettings({ usdRate: v, usdRateUpdated: new Date().toISOString() });
  });
  $$('[data-setting]').forEach((el) =>
    el.addEventListener('change', () => {
      const v = el.tagName === 'SELECT' ? el.value : Number(el.value) || 0;
      store.updateSettings({ [el.dataset.setting]: v });
      toast('Guardado');
    })
  );
  $('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await store.signIn(fd.get('email'), fd.get('password'));
      toast('Sesión iniciada. Sincronizando…');
    } catch (err) {
      toast(`No se pudo iniciar sesión: ${err.message}`, 'danger');
    }
  });
};

// ---------- Modales: movimientos ----------

function txModal(tx = null, preset = {}) {
  const s = store.getSettings();
  const t = tx
    ? { ...tx }
    : { type: preset.type || 'gasto', amount: '', currency: 'MXN', categoryId: null, accountId: store.list('accounts')[0]?.id, date: today(), note: '' };
  const accounts = store.list('accounts');

  renderModal(
    `<div class="modal-head"><h2>${tx ? 'Editar movimiento' : 'Nuevo movimiento'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <div class="type-switch">${['gasto', 'ingreso', 'transferencia']
        .map((k) => `<button type="button" data-type="${k}" class="${t.type === k ? 'active' : ''}">${{ gasto: 'Gasto', ingreso: 'Ingreso', transferencia: 'Transferir' }[k]}</button>`)
        .join('')}</div>
      <div class="row"><input class="input amount-input grow" id="f-amount" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0" value="${t.amount}" />
        <select class="input" id="f-currency" style="width:92px"><option ${t.currency === 'MXN' ? 'selected' : ''}>MXN</option><option ${t.currency === 'USD' ? 'selected' : ''}>USD</option></select></div>
      <div id="f-cats"></div>
      <div class="form-grid">
        <label class="field"><span id="f-acc-label">Cuenta</span><select class="input" id="f-account">${accounts.map((a) => `<option value="${a.id}" ${t.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
        <label class="field" id="f-to-wrap"><span>Hacia la cuenta</span><select class="input" id="f-to">${accounts
          .map((a) => `<option value="${a.id}" ${t.toAccountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`)
          .join('')}</select></label>
        <label class="field"><span>Fecha</span><input class="input" id="f-date" type="date" value="${t.date}" /></label>
        <label class="field full"><span>Nota</span><input class="input" id="f-note" placeholder="Ej. Tacos con amigos" value="${esc(t.note || '')}" /></label>
        ${
          tx
            ? ''
            : `<label class="field full"><span>¿Se repite?</span><select class="input" id="f-repeat"><option value="">No, solo esta vez</option>${Object.entries(FREQ)
                .map(([k, v]) => `<option value="${k}">${v}</option>`)
                .join('')}</select></label>
              <label class="field full hidden" id="f-days-wrap"><span>¿Cada cuántos días?</span><input class="input" id="f-days" type="number" inputmode="numeric" min="1" value="5" /></label>`
        }
      </div>
    </div>
    <div class="modal-actions">${tx ? `<button class="btn btn-danger" id="f-delete">Eliminar</button>` : ''}<button class="btn btn-primary" id="f-save">Guardar</button></div>`,
    (root) => {
      const renderCats = () => {
        const wrap = $('#f-cats', root);
        $('#f-to-wrap', root).classList.toggle('hidden', t.type !== 'transferencia');
        $('#f-acc-label', root).textContent = t.type === 'transferencia' ? 'Desde la cuenta' : 'Cuenta';
        if (t.type === 'transferencia') {
          wrap.innerHTML = '';
          return;
        }
        const cats = store.list('categories').filter((c) => c.type === t.type);
        if (!cats.some((c) => c.id === t.categoryId)) t.categoryId = t.type === 'ingreso' && cats.some((c) => c.id === s.appointmentsCategoryId) ? s.appointmentsCategoryId : cats[0]?.id;
        wrap.innerHTML = `<div class="cat-picker">${cats
          .map((c) => `<button type="button" class="cat-option ${c.id === t.categoryId ? 'active' : ''}" data-cat="${c.id}"><span class="e">${c.icon}</span>${esc(c.name)}</button>`)
          .join('')}<button type="button" class="cat-option" data-newcat><span class="e">＋</span>Nueva</button></div>`;
      };
      renderCats();
      $('#f-repeat', root)?.addEventListener('change', (e) => $('#f-days-wrap', root).classList.toggle('hidden', e.target.value !== 'dias'));
      $$('.type-switch button', root).forEach((b) =>
        b.addEventListener('click', () => {
          t.type = b.dataset.type;
          $$('.type-switch button', root).forEach((x) => x.classList.toggle('active', x === b));
          renderCats();
        })
      );
      $('#f-cats', root).addEventListener('click', (e) => {
        const b = e.target.closest('[data-cat]');
        if (b) {
          t.categoryId = b.dataset.cat;
          $$('[data-cat]', root).forEach((x) => x.classList.toggle('active', x === b));
        }
        if (e.target.closest('[data-newcat]')) {
          const name = prompt('Nombre de la nueva categoría');
          if (name?.trim()) {
            const c = store.save('categories', { name: name.trim(), icon: '🏷️', color: COLORS[store.list('categories').length % COLORS.length], type: t.type, limit: 0 });
            t.categoryId = c.id;
            renderCats();
          }
        }
      });
      setTimeout(() => !tx && $('#f-amount', root).focus(), 50);
      $('#f-delete', root)?.addEventListener('click', () => {
        if (confirm('¿Eliminar este movimiento?')) {
          store.remove('transactions', tx.id);
          closeModal();
          toast('Movimiento eliminado');
        }
      });
      $('#f-save', root).addEventListener('click', () => {
        const amount = Number($('#f-amount', root).value);
        if (!(amount > 0)) return toast('Escribe un monto mayor a 0', 'warn');
        const item = {
          ...t,
          amount,
          currency: $('#f-currency', root).value,
          accountId: $('#f-account', root).value,
          toAccountId: t.type === 'transferencia' ? $('#f-to', root).value : null,
          categoryId: t.type === 'transferencia' ? null : t.categoryId,
          date: $('#f-date', root).value || today(),
          note: $('#f-note', root).value.trim(),
        };
        if (item.type === 'transferencia' && item.accountId === item.toAccountId) return toast('Elige dos cuentas distintas', 'warn');
        const repeat = $('#f-repeat', root)?.value;
        if (repeat) {
          const rec = store.save('recurring', {
            name: item.note || cat(item.categoryId).name,
            type: item.type === 'transferencia' ? 'gasto' : item.type,
            amount,
            currency: item.currency,
            categoryId: item.categoryId,
            accountId: item.accountId,
            frequency: repeat,
            everyDays: repeat === 'dias' ? Math.max(1, Number($('#f-days', root).value) || 1) : undefined,
            startDate: item.date,
            active: true,
          });
          calc.generateRecurring();
          if (item.date > today()) toast(`Programado: se registrará solo ${freqLabel(rec).toLowerCase()}`);
          else afterSaveTx(item);
        } else {
          store.save('transactions', item);
          afterSaveTx(item);
        }
        closeModal();
      });
    }
  );
}

function afterSaveTx(item) {
  if (item.type !== 'gasto') return toast(item.type === 'ingreso' ? '¡Ingreso registrado! 💰' : 'Transferencia registrada');
  const alert = calc.categoryAlerts(monthKey(item.date)).find((a) => a.category.id === item.categoryId);
  if (alert && alert.level !== 'ok') toast(`${alert.category.name}: llevas ${Math.round(alert.pct * 100)}% de tu límite del mes`, alert.level);
  else toast('Gasto registrado');
}

function citasModal() {
  const s = store.getSettings();
  let n = 15;
  const accounts = store.list('accounts');
  renderModal(
    `<div class="modal-head"><h2>🧠 Semana de citas</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <div class="muted small" style="text-align:center">¿Cuántas citas tuviste esta semana?</div>
      <div class="stepper"><button type="button" id="c-minus">−</button><span class="val" id="c-n">${n}</span><button type="button" id="c-plus">＋</button></div>
      <div class="chips" style="justify-content:center">${[13, 15, 18, 20, 22, 25].map((x) => `<button type="button" class="chip btn-chip" data-n="${x}">${x}</button>`).join('')}</div>
      <div class="card" style="text-align:center;background:var(--income-soft);border-color:transparent"><div class="small muted">Te pagan</div><div class="hero"><div class="value income" id="c-pay"></div></div><div class="tiny muted" id="c-explain"></div></div>
      <div class="form-grid">
        <label class="field"><span>Fecha de pago</span><input class="input" id="c-date" type="date" value="${today()}" /></label>
        <label class="field"><span>Cuenta</span><select class="input" id="c-account">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
        <label class="field full"><span>Extra (propinas, bonos, opcional)</span><input class="input" id="c-extra" type="number" inputmode="decimal" min="0" placeholder="0" /></label>
      </div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" id="c-save">Registrar ingreso</button></div>`,
    (root) => {
      const update = () => {
        $('#c-n', root).textContent = n;
        const pay = calc.appointmentPay(n) + (Number($('#c-extra', root).value) || 0);
        $('#c-pay', root).textContent = calc.money(pay, { currency: 'MXN' });
        const raw = n * s.ratePerAppointment;
        $('#c-explain', root).textContent =
          raw < s.weeklyMinimum ? `${n} × $${s.ratePerAppointment} = $${raw}, pero tu mínimo es $${s.weeklyMinimum}` : `${n} citas × $${s.ratePerAppointment}`;
      };
      update();
      $('#c-minus', root).onclick = () => ((n = Math.max(0, n - 1)), update());
      $('#c-plus', root).onclick = () => ((n += 1), update());
      $('#c-extra', root).oninput = update;
      $$('[data-n]', root).forEach((b) => (b.onclick = () => ((n = Number(b.dataset.n)), update())));
      $('#c-save', root).onclick = () => {
        const extra = Number($('#c-extra', root).value) || 0;
        const item = {
          type: 'ingreso',
          amount: calc.appointmentPay(n) + extra,
          currency: 'MXN',
          categoryId: s.appointmentsCategoryId,
          accountId: $('#c-account', root).value,
          date: $('#c-date', root).value || today(),
          note: `Semana de citas (${n} citas${extra ? ` + $${extra} extra` : ''})`,
          appointments: n,
        };
        store.save('transactions', item);
        closeModal();
        toast(`¡Registrado! ${calc.money(item.amount, { currency: 'MXN' })} 💰`);
      };
    }
  );
}

// ---------- Modales: categorías, cuentas, recurrentes ----------

function categoryModal(c = null, type = 'gasto') {
  const item = c ? { ...c } : { name: '', icon: '🏷️', color: COLORS[store.list('categories').length % COLORS.length], type, limit: 0 };
  const inUse = c ? store.list('transactions').filter((t) => t.categoryId === c.id).length : 0;
  const ICONS = ['🍔', '☕', '🛒', '🚌', '⛽', '🏠', '💡', '📱', '📺', '🎮', '🎬', '💊', '🏋️', '📚', '🎓', '💻', '👕', '✂️', '🐶', '🎁', '✈️', '🍺', '💳', '🧾', '💼', '🧠', '💰', '📦', '🏷️'];
  renderModal(
    `<div class="modal-head"><h2>${c ? 'Editar categoría' : 'Nueva categoría'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <label class="field"><span>Nombre</span><input class="input" id="k-name" value="${esc(item.name)}" placeholder="Ej. Gimnasio" /></label>
      <div class="field"><span>Ícono</span><div class="row wrap" style="gap:6px">${ICONS.map(
        (i) => `<button type="button" class="chip btn-chip ${i === item.icon ? 'active' : ''}" data-icon="${i}" style="font-size:1.1rem">${i}</button>`
      ).join('')}<input class="input" id="k-icon" value="${esc(item.icon)}" style="width:70px;text-align:center" maxlength="4" /></div></div>
      <div class="field"><span>Color</span><div class="color-row">${COLORS.map((col) => `<button type="button" class="color-swatch ${col === item.color ? 'active' : ''}" data-color="${col}" style="background:${col}"></button>`).join('')}</div></div>
      <label class="field"><span>Tipo</span><select class="input" id="k-type"><option value="gasto" ${item.type === 'gasto' ? 'selected' : ''}>Gasto</option><option value="ingreso" ${
        item.type === 'ingreso' ? 'selected' : ''
      }>Ingreso</option></select></label>
      <label class="field" id="k-limit-wrap"><span>Límite mensual en MXN (0 = sin límite)</span><input class="input" id="k-limit" type="number" min="0" value="${Number(item.limit) || 0}" /></label>
      ${c && inUse ? `<div class="tiny muted">Tiene ${inUse} movimientos. Si la eliminas, quedarán como "Sin categoría".</div>` : ''}
    </div>
    <div class="modal-actions">${c ? `<button class="btn btn-danger" id="k-delete">Eliminar</button>` : ''}<button class="btn btn-primary" id="k-save">Guardar</button></div>`,
    (root) => {
      const syncLimit = () => $('#k-limit-wrap', root).classList.toggle('hidden', $('#k-type', root).value !== 'gasto');
      syncLimit();
      $('#k-type', root).onchange = syncLimit;
      $$('[data-icon]', root).forEach(
        (b) =>
          (b.onclick = () => {
            $('#k-icon', root).value = b.dataset.icon;
            $$('[data-icon]', root).forEach((x) => x.classList.toggle('active', x === b));
          })
      );
      $$('[data-color]', root).forEach(
        (b) =>
          (b.onclick = () => {
            item.color = b.dataset.color;
            $$('[data-color]', root).forEach((x) => x.classList.toggle('active', x === b));
          })
      );
      $('#k-delete', root)?.addEventListener('click', () => {
        if (store.list('categories').filter((x) => x.type === c.type).length <= 1) return toast('Debe quedar al menos una categoría de este tipo', 'warn');
        if (confirm(`¿Eliminar la categoría "${c.name}"?`)) {
          store.remove('categories', c.id);
          closeModal();
          toast('Categoría eliminada');
        }
      });
      $('#k-save', root).onclick = () => {
        const name = $('#k-name', root).value.trim();
        if (!name) return toast('Ponle un nombre', 'warn');
        store.save('categories', { ...item, name, icon: $('#k-icon', root).value.trim() || '🏷️', type: $('#k-type', root).value, limit: Number($('#k-limit', root).value) || 0 });
        closeModal();
        toast('Categoría guardada');
      };
    }
  );
}

function accountModal(a = null) {
  const item = a ? { ...a } : { name: '', type: 'debito', currency: 'MXN', initialBalance: 0 };
  renderModal(
    `<div class="modal-head"><h2>${a ? 'Editar cuenta' : 'Nueva cuenta'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="form-grid">
      <label class="field full"><span>Nombre</span><input class="input" id="a-name" value="${esc(item.name)}" placeholder="Ej. BBVA, Nu, Efectivo" /></label>
      <label class="field"><span>Tipo</span><select class="input" id="a-type">${Object.entries(ACCOUNT_TYPES).map(([k, v]) => `<option value="${k}" ${item.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="field"><span>Moneda</span><select class="input" id="a-currency"><option ${item.currency === 'MXN' ? 'selected' : ''}>MXN</option><option ${item.currency === 'USD' ? 'selected' : ''}>USD</option></select></label>
      <label class="field full"><span>Saldo inicial (en tarjeta de crédito, lo que debes en negativo)</span><input class="input" id="a-balance" type="number" step="0.01" value="${Number(item.initialBalance) || 0}" /></label>
    </div>
    <div class="modal-actions">${a ? `<button class="btn btn-danger" id="a-delete">Eliminar</button>` : ''}<button class="btn btn-primary" id="a-save">Guardar</button></div>`,
    (root) => {
      $('#a-delete', root)?.addEventListener('click', () => {
        if (store.list('accounts').length <= 1) return toast('Debe quedar al menos una cuenta', 'warn');
        if (confirm(`¿Eliminar la cuenta "${a.name}"? Sus movimientos se conservan.`)) {
          store.remove('accounts', a.id);
          closeModal();
        }
      });
      $('#a-save', root).onclick = () => {
        const name = $('#a-name', root).value.trim();
        if (!name) return toast('Ponle un nombre', 'warn');
        store.save('accounts', { ...item, name, type: $('#a-type', root).value, currency: $('#a-currency', root).value, initialBalance: Number($('#a-balance', root).value) || 0 });
        closeModal();
        toast('Cuenta guardada');
      };
    }
  );
}

function recurringModal(r = null, preset = {}, opts = {}) {
  const kind = opts.kind || 'recurring';
  const sim = kind === 'simItems';
  const freqs = sim ? { una: 'Una sola vez, en una fecha', ...FREQ_ALL } : FREQ_ALL;
  const groups = [...new Set(store.list('simItems').map((x) => x.group).filter(Boolean))];
  const accounts = store.list('accounts');
  const item = r
    ? { ...r, schedule: [...(r.schedule || [])] }
    : {
        name: '',
        type: preset.type || 'gasto',
        amount: '',
        currency: 'MXN',
        categoryId: null,
        accountId: accounts[0]?.id,
        frequency: preset.frequency || 'mensual',
        startDate: preset.startDate || today(),
        group: preset.group || '',
        active: true,
        schedule: [],
      };
  if (item.frequency === 'fechas' && !item.schedule.length) item.schedule = [{ date: today(), amount: '' }];
  const catOptions = (type) =>
    store
      .list('categories')
      .filter((c) => c.type === type)
      .map((c) => `<option value="${c.id}" ${item.categoryId === c.id ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`)
      .join('');
  const t = today();
  renderModal(
    `<div class="modal-head"><h2>${
      sim ? (r ? 'Editar movimiento simulado' : item.type === 'ingreso' ? 'Ingreso supuesto' : 'Gasto supuesto') : r ? 'Editar gasto fijo o temporal' : item.frequency === 'fechas' ? 'Nuevo pago temporal' : 'Nuevo gasto fijo'
    }</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="form-grid">
      <label class="field full"><span>Nombre</span><input class="input" id="r-name" value="${esc(item.name)}" placeholder="Ej. Comida de los gatos, aire acondicionado, deuda con Juan" /></label>
      ${
        sim
          ? `<label class="field full"><span>Grupo (opcional, para sumar varios juntos)</span><input class="input" id="r-group" list="r-groups" value="${esc(item.group || '')}" placeholder="Ej. Gastos de la semana, Mascotas" /><datalist id="r-groups">${groups
              .map((g) => `<option value="${esc(g)}"></option>`)
              .join('')}</datalist></label>`
          : ''
      }
      <label class="field"><span>Tipo</span><select class="input" id="r-type"><option value="gasto" ${item.type === 'gasto' ? 'selected' : ''}>Gasto</option><option value="ingreso" ${item.type === 'ingreso' ? 'selected' : ''}>Ingreso</option></select></label>
      <label class="field"><span>Categoría</span><select class="input" id="r-cat">${catOptions(item.type)}</select></label>
      <label class="field full"><span>¿Cuándo se paga?</span><select class="input" id="r-freq">${Object.entries(freqs).map(([k, v]) => `<option value="${k}" ${item.frequency === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>

      <div class="full form-grid" id="r-regular" style="grid-template-columns:inherit">
        <label class="field"><span>Monto de cada pago</span><input class="input" id="r-amount" type="number" step="0.01" min="0" value="${item.frequency === 'fechas' ? '' : item.amount}" /></label>
        <label class="field ${item.frequency === 'dias' ? '' : 'hidden'}" id="r-days-wrap"><span>¿Cada cuántos días?</span><input class="input" id="r-days" type="number" inputmode="numeric" min="1" value="${Number(item.everyDays) || 5}" /></label>
        <label class="field"><span id="r-start-label">Primera fecha</span><input class="input" id="r-start" type="date" value="${item.startDate}" ${r?.lastGenerated && r.frequency !== 'fechas' ? 'disabled' : ''} /></label>
        <label class="field" id="r-count-wrap"><span>Número de pagos (vacío = sin fin)</span><input class="input" id="r-count" type="number" inputmode="numeric" min="1" placeholder="Sin fin" value="${Number(item.count) || ''}" /></label>
        <div class="full small" id="r-regular-total"></div>
      </div>

      <div class="full stack" id="r-fechas">
        <div class="card" style="background:var(--surface-2)">
          <div class="small muted" style="margin-bottom:8px">Atajo: reparte una deuda en pagos iguales</div>
          <div class="form-grid" style="grid-template-columns:repeat(3,1fr)">
            <label class="field"><span>Total</span><input class="input" id="q-total" type="number" min="0" placeholder="1800" /></label>
            <label class="field"><span>Pagos</span><input class="input" id="q-n" type="number" min="1" placeholder="3" /></label>
            <label class="field"><span>Cada (semanas)</span><input class="input" id="q-every" type="number" min="1" placeholder="1" /></label>
          </div>
          <button type="button" class="btn btn-sm" id="q-fill" style="margin-top:10px">Generar fechas</button>
        </div>
        <div class="small muted">Pagos (puedes cambiar cada fecha y monto):</div>
        <div id="r-schedule" class="stack" style="gap:8px"></div>
        <div class="row between"><button type="button" class="btn btn-sm" id="r-add-pay">＋ Agregar pago</button><b class="num" id="r-sched-total"></b></div>
      </div>

      <label class="field"><span>Moneda</span><select class="input" id="r-currency"><option ${item.currency === 'MXN' ? 'selected' : ''}>MXN</option><option ${item.currency === 'USD' ? 'selected' : ''}>USD</option></select></label>
      <label class="field ${sim ? 'hidden' : ''}"><span>Cuenta</span><select class="input" id="r-account">${accounts.map((a) => `<option value="${a.id}" ${item.accountId === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>
      <label class="field full"><span>Estado</span><select class="input" id="r-active"><option value="1" ${item.active !== false ? 'selected' : ''}>Activo</option><option value="0" ${item.active === false ? 'selected' : ''}>Pausado</option></select></label>
      <div class="tiny muted full">${
        sim
          ? 'Esto es solo para el simulador: no se registra en tus movimientos ni cambia tus metas.'
          : 'Cada pago se registra solo cuando llega su fecha, y los que faltan se descuentan en tus metas y presupuestos en la semana en que caen.'
      }</div>
    </div>
    <div class="modal-actions">${r ? `<button class="btn btn-danger" id="r-delete">Eliminar</button>` : ''}<button class="btn btn-primary" id="r-save">Guardar</button></div>`,
    (root) => {
      const cur = () => $('#r-currency', root).value;
      const renderSchedule = () => {
        item.schedule.sort((a, b) => (a.date < b.date ? -1 : 1));
        $('#r-schedule', root).innerHTML = item.schedule
          .map(
            (p, i) => `<div class="row"><span class="tiny muted" style="width:18px">${i + 1}</span><input class="input" type="date" data-sd="${i}" value="${p.date}" ${p.date <= t && r?.lastGenerated ? 'title="Ya registrado"' : ''} /><input class="input" type="number" min="0" step="0.01" inputmode="decimal" data-sa="${i}" value="${p.amount}" placeholder="Monto" style="max-width:120px" /><button type="button" class="btn btn-ghost btn-sm" data-sx="${i}">✕</button></div>`
          )
          .join('');
        updateTotals();
      };
      const updateTotals = () => {
        const total = item.schedule.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        $('#r-sched-total', root).textContent = `Total: ${calc.money(total, { currency: cur() })}`;
        const amt = Number($('#r-amount', root).value) || 0;
        const n = Number($('#r-count', root).value) || 0;
        $('#r-regular-total', root).innerHTML = n && amt ? `Total a pagar: <b>${calc.money(amt * n, { currency: cur() })}</b> en ${n} pagos` : '';
      };
      const syncFreq = () => {
        const f = $('#r-freq', root).value;
        $('#r-regular', root).classList.toggle('hidden', f === 'fechas');
        $('#r-fechas', root).classList.toggle('hidden', f !== 'fechas');
        $('#r-days-wrap', root).classList.toggle('hidden', f !== 'dias');
        $('#r-count-wrap', root).classList.toggle('hidden', f === 'una');
        $('#r-start-label', root).textContent = f === 'una' ? 'Fecha' : 'Primera fecha';
        if (f === 'fechas' && !item.schedule.length) {
          item.schedule = [{ date: t, amount: '' }];
          renderSchedule();
        }
      };
      renderSchedule();
      syncFreq();
      $('#r-freq', root).onchange = syncFreq;
      $('#r-type', root).onchange = (e) => ($('#r-cat', root).innerHTML = catOptions(e.target.value));
      $('#r-amount', root).oninput = updateTotals;
      $('#r-count', root).oninput = updateTotals;
      $('#r-currency', root).onchange = updateTotals;
      $('#r-schedule', root).addEventListener('input', (e) => {
        if (e.target.dataset.sa != null) item.schedule[Number(e.target.dataset.sa)].amount = e.target.value;
        updateTotals();
      });
      $('#r-schedule', root).addEventListener('change', (e) => {
        if (e.target.dataset.sd != null) {
          item.schedule[Number(e.target.dataset.sd)].date = e.target.value;
          renderSchedule();
        }
      });
      $('#r-schedule', root).addEventListener('click', (e) => {
        const x = e.target.closest('[data-sx]');
        if (!x) return;
        item.schedule.splice(Number(x.dataset.sx), 1);
        renderSchedule();
      });
      $('#r-add-pay', root).onclick = () => {
        const last = item.schedule[item.schedule.length - 1];
        const date = last?.date ? calc.toISODate(calc.addDays(calc.parseDate(last.date), 7)) : t;
        item.schedule.push({ date, amount: last?.amount || '' });
        renderSchedule();
      };
      $('#q-fill', root).onclick = () => {
        const total = Number($('#q-total', root).value);
        const n = Math.max(1, Number($('#q-n', root).value) || 1);
        const every = Math.max(1, Number($('#q-every', root).value) || 1);
        if (!(total > 0)) return toast('Escribe el total de la deuda', 'warn');
        const each = Math.round((total / n) * 100) / 100;
        const start = item.schedule[0]?.date || t;
        item.schedule = Array.from({ length: n }, (_, i) => ({
          date: calc.toISODate(calc.addDays(calc.parseDate(start), 7 * every * i)),
          // El último pago absorbe los centavos que sobren del redondeo.
          amount: i === n - 1 ? Math.round((total - each * (n - 1)) * 100) / 100 : each,
        }));
        renderSchedule();
      };
      $('#r-delete', root)?.addEventListener('click', () => {
        if (confirm('¿Eliminar? Los movimientos ya registrados se conservan.')) {
          store.remove(kind, r.id);
          closeModal();
        }
      });
      $('#r-save', root).onclick = () => {
        const name = $('#r-name', root).value.trim();
        const frequency = $('#r-freq', root).value;
        if (!name) return toast('Ponle un nombre', 'warn');
        const common = {
          ...item,
          name,
          frequency,
          type: $('#r-type', root).value,
          categoryId: $('#r-cat', root).value,
          currency: cur(),
          accountId: $('#r-account', root).value,
          active: $('#r-active', root).value === '1',
          group: sim ? $('#r-group', root).value.trim() : item.group,
        };
        let saved;
        if (frequency === 'fechas') {
          const schedule = item.schedule.filter((p) => p.date && Number(p.amount) > 0).map((p) => ({ date: p.date, amount: Number(p.amount) }));
          if (!schedule.length) return toast('Agrega al menos un pago con fecha y monto', 'warn');
          saved = { ...common, schedule, amount: schedule.reduce((s, p) => s + p.amount, 0), startDate: schedule[0].date, count: undefined, everyDays: undefined };
        } else {
          const amount = Number($('#r-amount', root).value);
          if (!(amount > 0)) return toast('Pon el monto de cada pago', 'warn');
          saved = {
            ...common,
            amount,
            schedule: undefined,
            everyDays: frequency === 'dias' ? Math.max(1, Number($('#r-days', root).value) || 1) : undefined,
            startDate: $('#r-start', root).value || t,
            count: frequency !== 'una' && Number($('#r-count', root).value) > 0 ? Math.round(Number($('#r-count', root).value)) : undefined,
          };
        }
        store.save(kind, saved);
        if (sim) {
          closeModal();
          return toast('Agregado al simulador 🧪');
        }
        const n = calc.generateRecurring();
        closeModal();
        toast(n ? `Guardado. Se registraron ${n} pagos que ya tocaban.` : 'Guardado ✅');
      };
    }
  );
}

// ---------- Modales: metas ----------

function goalModal(g = null, preset = {}) {
  const item = g ? { ...g } : { name: preset.name || '', target: preset.target || '', currency: preset.currency || 'MXN', icon: '🎯', deadline: preset.deadline || '', contributions: [] };
  const saved = g ? calc.goalSavedMXN(g) : 0;
  renderModal(
    `<div class="modal-head"><h2>${g ? 'Editar meta' : 'Nueva meta'}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="form-grid">
      <label class="field full"><span>¿Para qué ahorras?</span><input class="input" id="g-name" value="${esc(item.name)}" placeholder="Ej. Memoria RAM" /></label>
      <label class="field"><span>Precio</span><input class="input" id="g-target" type="number" min="0" step="0.01" value="${item.target}" /></label>
      <label class="field"><span>Moneda</span><select class="input" id="g-currency"><option ${item.currency === 'MXN' ? 'selected' : ''}>MXN</option><option ${item.currency === 'USD' ? 'selected' : ''}>USD</option></select></label>
      <label class="field"><span>Ícono</span><input class="input" id="g-icon" value="${esc(item.icon)}" maxlength="4" /></label>
      <label class="field"><span>Fecha límite (opcional)</span><input class="input" id="g-deadline" type="date" value="${item.deadline || ''}" /></label>
      ${
        !g && preset.saved
          ? `<label class="field full"><span>Ya tengo ahorrado</span><input class="input" id="g-initial" type="number" min="0" value="${preset.saved}" /></label>`
          : ''
      }
      ${
        g && item.contributions?.length
          ? `<div class="full"><div class="small muted">Aportes (${fmt(saved)})</div><div class="list">${item.contributions
              .map((c, i) => `<div class="list-item"><span class="grow small">${calc.formatDate(c.date)}</span><span class="li-amount">${calc.money(Number(c.amount), { currency: item.currency })}</span><button class="btn btn-ghost btn-sm" data-remove-contrib="${i}">✕</button></div>`)
              .join('')}</div></div>`
          : ''
      }
    </div>
    <div class="modal-actions">${g ? `<button class="btn btn-danger" id="g-delete">Eliminar</button>` : ''}${
      g?.completed ? `<button class="btn" id="g-reopen">Reabrir</button>` : ''
    }<button class="btn btn-primary" id="g-save">Guardar</button></div>`,
    (root) => {
      $$('[data-remove-contrib]', root).forEach(
        (b) =>
          (b.onclick = () => {
            item.contributions.splice(Number(b.dataset.removeContrib), 1);
            b.closest('.list-item').remove();
          })
      );
      $('#g-delete', root)?.addEventListener('click', () => {
        if (confirm(`¿Eliminar la meta "${g.name}"?`)) {
          store.remove('goals', g.id);
          closeModal();
        }
      });
      $('#g-reopen', root)?.addEventListener('click', () => {
        store.save('goals', { ...g, completed: false });
        closeModal();
      });
      $('#g-save', root).onclick = () => {
        const name = $('#g-name', root).value.trim();
        const target = Number($('#g-target', root).value);
        if (!name || !(target > 0)) return toast('Pon nombre y precio', 'warn');
        const initial = Number($('#g-initial', root)?.value) || 0;
        const contributions = [...(item.contributions || [])];
        if (initial > 0) contributions.push({ date: today(), amount: initial });
        store.save('goals', { ...item, name, target, currency: $('#g-currency', root).value, icon: $('#g-icon', root).value || '🎯', deadline: $('#g-deadline', root).value, contributions });
        closeModal();
        toast('Meta guardada 🎯');
      };
    }
  );
}

function contributionModal(g) {
  const st = calc.weeklyStats();
  const suggestion = Math.max(0, Math.round(st.avgIncome - st.avgExpense));
  renderModal(
    `<div class="modal-head"><h2>Apartar para ${esc(g.name)}</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <input class="input amount-input" id="p-amount" type="number" inputmode="decimal" min="0" placeholder="0" />
      ${suggestion ? `<button class="chip btn-chip" id="p-suggest" style="justify-self:center">Sugerido: ${calc.money(calc.fromMXN(suggestion, g.currency), { currency: g.currency })} (tu sobrante semanal)</button>` : ''}
      <div class="tiny muted" style="text-align:center">El dinero sigue en tus cuentas, pero se marca como apartado para esta meta. Usa un monto negativo para sacar dinero de la meta.</div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" id="p-save">Apartar</button></div>`,
    (root) => {
      setTimeout(() => $('#p-amount', root).focus(), 50);
      $('#p-suggest', root)?.addEventListener('click', () => ($('#p-amount', root).value = Math.round(calc.fromMXN(suggestion, g.currency) * 100) / 100));
      $('#p-save', root).onclick = () => {
        const amount = Number($('#p-amount', root).value);
        if (!amount) return toast('Escribe un monto', 'warn');
        store.save('goals', { ...g, contributions: [...(g.contributions || []), { date: today(), amount }] });
        closeModal();
        const updated = store.get('goals', g.id);
        toast(calc.goalSavedMXN(updated) >= calc.toMXN(updated.target, updated.currency) ? '¡Meta cumplida! 🎉' : 'Dinero apartado 💪');
      };
    }
  );
}

// ---------- Importar CSV ----------

function importCsvModal() {
  const accounts = store.list('accounts');
  let rows = [];
  let header = [];
  let mapping = null;
  let preview = [];
  renderModal(
    `<div class="modal-head"><h2>Importar CSV del banco</h2><button class="icon-btn" data-close>✕</button></div>
    <div class="stack">
      <div class="small muted">Descarga tu estado de cuenta en CSV desde la app o web de tu banco (BBVA, Santander, Nu, Banorte, etc.) y súbelo aquí. Detecto duplicados para que no se registren dos veces.</div>
      <input class="input" type="file" id="i-file" accept=".csv,text/csv,.txt" />
      <div id="i-map"></div>
      <div id="i-preview"></div>
    </div>
    <div class="modal-actions"><button class="btn btn-primary" id="i-save" disabled>Importar</button></div>`,
    (root) => {
      const refresh = () => {
        const opts = { accountId: $('#i-account', root).value, currency: $('#i-currency', root).value, invert: $('#i-invert', root).checked };
        ['date', 'description', 'amount', 'debit', 'credit'].forEach((k) => (mapping[k] = Number($(`#i-${k}`, root).value)));
        preview = csv.rowsToTransactions(rows, mapping, opts);
        const fresh = preview.filter((p) => !p.duplicate);
        const cats = store.list('categories');
        $('#i-preview', root).innerHTML = preview.length
          ? `<div class="small" style="margin-bottom:6px">${fresh.length} nuevos${preview.length - fresh.length ? `, ${preview.length - fresh.length} ya existían (se omiten)` : ''}. Puedes cambiar la categoría antes de importar.</div>
            <div class="table-scroll"><table class="table"><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th class="right">Monto</th></tr></thead><tbody>${preview
              .map(
                (p, i) => `<tr style="${p.duplicate ? 'opacity:.4' : ''}"><td class="num">${p.date}</td><td>${esc(p.note).slice(0, 40)}</td><td><select class="input" data-row="${i}" style="padding:4px 6px;font-size:13px">${cats
                  .filter((c) => c.type === p.type)
                  .map((c) => `<option value="${c.id}" ${c.id === p.categoryId ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`)
                  .join('')}</select></td><td class="right num ${p.type === 'ingreso' ? 'income' : 'expense'}">${p.type === 'ingreso' ? '+' : '−'}${p.amount.toFixed(2)}</td></tr>`
              )
              .join('')}</tbody></table></div>`
          : `<div class="alert warn"><span>⚠️</span><span>No encontré movimientos con estas columnas. Revisa que la fecha y el monto estén bien elegidos.</span></div>`;
        $$('[data-row]', root).forEach((s) => (s.onchange = () => (preview[Number(s.dataset.row)].categoryId = s.value)));
        $('#i-save', root).disabled = !fresh.length;
        $('#i-save', root).textContent = fresh.length ? `Importar ${fresh.length} movimientos` : 'Importar';
      };
      $('#i-file', root).onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        let text = await file.text();
        if (text.includes('�')) text = new TextDecoder('windows-1252').decode(await file.arrayBuffer());
        const all = csv.parseCSV(text);
        // El encabezado es la primera fila con una columna de fecha reconocible.
        let hi = all.findIndex((r) => r.some((c) => /fecha|date/i.test(c)));
        if (hi < 0) hi = 0;
        header = all[hi];
        rows = all.slice(hi + 1);
        mapping = csv.guessMapping(header);
        const sel = (id, label, val, allowNone) =>
          `<label class="field"><span>${label}</span><select class="input" id="i-${id}">${allowNone ? `<option value="-1">— Ninguna —</option>` : ''}${header
            .map((h, i) => `<option value="${i}" ${val === i ? 'selected' : ''}>${esc(h || `Columna ${i + 1}`)}</option>`)
            .join('')}</select></label>`;
        $('#i-map', root).innerHTML = `<div class="form-grid">
          ${sel('date', 'Columna de fecha', mapping.date, false)}
          ${sel('description', 'Descripción', mapping.description, true)}
          ${sel('amount', 'Monto (con signo)', mapping.amount, true)}
          ${sel('debit', 'o Cargos (gastos)', mapping.debit, true)}
          ${sel('credit', 'y Abonos (ingresos)', mapping.credit, true)}
          <label class="field"><span>Cuenta</span><select class="input" id="i-account">${accounts.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Moneda</span><select class="input" id="i-currency"><option>MXN</option><option>USD</option></select></label>
          <label class="field" style="align-content:end"><span><input type="checkbox" id="i-invert" /> Invertir signos (si los gastos salen como ingresos)</span></label>
        </div>`;
        $$('#i-map select, #i-map input', root).forEach((el) => (el.onchange = refresh));
        refresh();
      };
      $('#i-save', root).onclick = () => {
        const fresh = preview.filter((p) => !p.duplicate).map(({ duplicate, ...t }) => t);
        store.saveMany('transactions', fresh);
        closeModal();
        toast(`Se importaron ${fresh.length} movimientos ✅`);
      };
    },
    { wide: true }
  );
}

// ---------- Acciones globales ----------

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src.endsWith(src))) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
    document.head.appendChild(s);
  });
}

const actions = {
  go: (el) => {
    state.view = el.dataset.view;
    render();
    window.scrollTo({ top: 0 });
  },
  'month-prev': () => ((state.month = calc.shiftMonthKey(state.month, -1)), render()),
  'month-next': () => ((state.month = calc.shiftMonthKey(state.month, 1)), render()),
  'month-today': () => ((state.month = monthKey(today())), render()),
  currency: (el) => store.updateSettings({ displayCurrency: el.dataset.currency }),
  theme: (el) => {
    document.documentElement.dataset.theme = el.dataset.theme;
    try {
      localStorage.setItem('finanzas.theme', el.dataset.theme);
    } catch (e) {}
    document.querySelector('meta[name="theme-color"]').content = el.dataset.theme === 'light' ? '#f4f5f8' : '#0f1115';
    render();
  },
  'new-tx': (el) => txModal(null, { type: el.dataset.type }),
  'edit-tx': (el) => txModal(store.get('transactions', el.dataset.id)),
  'tx-filter-type': (el) => ((state.txFilter.type = el.dataset.type), render()),
  citas: () => citasModal(),
  'new-category': (el) => categoryModal(null, el.dataset.type),
  'edit-category': (el) => categoryModal(store.get('categories', el.dataset.id)),
  'new-account': () => accountModal(),
  'edit-account': (el) => accountModal(store.get('accounts', el.dataset.id)),
  'new-recurring': () => recurringModal(),
  'new-temporary': () => recurringModal(null, { frequency: 'fechas' }),
  ...sim.simActions((...args) => recurringModal(...args)),
  'edit-recurring': (el) => recurringModal(store.get('recurring', el.dataset.id)),
  'new-goal': () => goalModal(),
  'edit-goal': (el) => goalModal(store.get('goals', el.dataset.id)),
  'add-contribution': (el) => contributionModal(store.get('goals', el.dataset.id)),
  'complete-goal': (el) => {
    const g = store.get('goals', el.dataset.id);
    if (!confirm(`¿Registrar la compra de "${g.name}" como gasto y cerrar la meta?`)) return;
    const tech = store.list('categories').find((c) => c.id === 'cat-tecnologia') || store.list('categories').find((c) => c.type === 'gasto');
    store.save('goals', { ...g, completed: true });
    txModal(null, { type: 'gasto' });
    // Prellenar el formulario con la compra.
    setTimeout(() => {
      $('#f-amount').value = g.target;
      $('#f-currency').value = g.currency;
      $('#f-note').value = g.name;
      $(`[data-cat="${tech.id}"]`)?.click();
    }, 0);
  },
  'plan-to-goal': () => {
    const p = state.plan;
    const deadline = Number(p.weeks) > 0 ? calc.toISODate(calc.addDays(new Date(), Number(p.weeks) * 7)) : '';
    goalModal(null, { name: p.name, target: p.price, currency: p.currency, saved: Number(p.saved) || 0, deadline });
  },
  'copy-summary': async () => {
    const text = calc.summaryText(state.month);
    try {
      await navigator.clipboard.writeText(text);
      toast('Resumen copiado. Pégamelo en el chat si quieres que lo analice.');
    } catch {
      renderModal(`<div class="modal-head"><h2>Resumen</h2><button class="icon-btn" data-close>✕</button></div><pre class="summary">${esc(text)}</pre>`);
    }
  },
  'refresh-rate': async () => {
    try {
      const r = await calc.refreshUsdRate();
      toast(`Tipo de cambio: $${r.toFixed(2)} por dólar`);
    } catch (e) {
      toast(e.message, 'danger');
    }
  },
  'import-csv': () => importCsvModal(),
  'export-csv': () => csv.exportCSV(),
  'export-json': () => csv.exportJSON(),
  'export-xlsx': async () => {
    try {
      await loadScript('vendor/xlsx.full.min.js');
      csv.exportXLSX(calc.monthlyHistory(12).map((h) => h.month));
    } catch (e) {
      toast(e.message, 'danger');
    }
  },
  'import-json': () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      try {
        const backup = JSON.parse(await input.files[0].text());
        if (!confirm('Esto reemplaza los datos de este dispositivo con los del respaldo. ¿Continuar?')) return;
        store.importBackup(backup);
        toast('Respaldo restaurado ✅');
      } catch (e) {
        toast(`No se pudo restaurar: ${e.message}`, 'danger');
      }
    };
    input.click();
  },
  'sync-now': () => store.sync(),
  logout: () => store.signOut(),
  signup: async () => {
    const form = $('#login-form');
    const fd = new FormData(form);
    if (!form.reportValidity()) return;
    try {
      await store.signUp(fd.get('email'), fd.get('password'));
      toast('Cuenta creada. Revisa tu correo si te pide confirmarla y luego inicia sesión.');
    } catch (e) {
      toast(`No se pudo crear la cuenta: ${e.message}`, 'danger');
    }
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el || el.closest('.modal')) return;
  const fn = actions[el.dataset.action];
  if (fn) {
    e.preventDefault();
    fn(el);
  }
});

// Atajo de teclado en la laptop: "n" para nuevo movimiento.
document.addEventListener('keydown', (e) => {
  if (e.key === 'n' && !e.metaKey && !e.ctrlKey && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && !$('.modal')) {
    e.preventDefault();
    txModal();
  }
});

// ---------- Inicio ----------

let renderQueued = false;
store.subscribe(() => {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    // No redibujar la vista mientras se escribe en la calculadora o el buscador.
    const active = document.activeElement;
    if (active && /INPUT|SELECT|TEXTAREA/.test(active.tagName) && $('#view').contains(active) && state.view !== 'ajustes') {
      renderNav();
      return;
    }
    render();
  });
});

calc.generateRecurring();
render();
store.initCloud().then(() => calc.generateRecurring());

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
