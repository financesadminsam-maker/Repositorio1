// Simulador: "¿qué pasaría si…?" con ingresos y gastos supuestos, sin tocar
// los movimientos reales. Cuenta cada gasto fijo o temporal en las fechas en
// que de verdad cae dentro del periodo elegido.

import * as store from './store.js';
import * as calc from './calc.js';
import * as charts from './charts.js';
import { esc, $ } from './ui.js';

const { fmt, toISODate, addDays, addMonths, parseDate, today } = calc;

export const PERIODS = {
  '1s': { label: 'Esta semana', weeks: 1 },
  '2s': { label: '2 semanas', weeks: 2 },
  '1m': { label: '1 mes', months: 1 },
  '2m': { label: '2 meses', months: 2 },
  '3m': { label: '3 meses', months: 3 },
  '5m': { label: '5 meses', months: 5 },
  '6m': { label: '6 meses', months: 6 },
  '1a': { label: '1 año', months: 12 },
  custom: { label: 'Personalizado' },
};

const DEFAULTS = { preset: '1m', start: '', customN: 5, customUnit: 'semanas', baseIncome: '', includeVariable: true, includeBalance: true, excluded: [], weekIncome: {} };

export function simConfig() {
  return { ...DEFAULTS, ...(store.getSettings().sim || {}) };
}
function setSim(patch) {
  store.updateSettings({ sim: { ...simConfig(), ...patch } });
}

// Rango del periodo: desde el lunes de la semana elegida.
export function simRange(cfg = simConfig()) {
  const start = calc.weekStart(cfg.start ? parseDate(cfg.start) : new Date());
  const p = PERIODS[cfg.preset] || PERIODS['1m'];
  let end;
  if (cfg.preset === 'custom') {
    const n = Math.max(1, Number(cfg.customN) || 1);
    end = cfg.customUnit === 'meses' ? addDays(addMonths(start, n), -1) : addDays(start, 7 * n - 1);
  } else if (p.weeks) end = addDays(start, 7 * p.weeks - 1);
  else end = addDays(addMonths(start, p.months), -1);
  return { start: toISODate(start), end: toISODate(end) };
}

// Todo lo que entra al simulador: gastos fijos/temporales reales + supuestos.
function simSources(cfg) {
  const real = store
    .list('recurring')
    .filter((r) => r.active !== false)
    .map((r) => ({
      rec: r,
      real: true,
      included: !cfg.excluded.includes(r.id),
      group: r.type === 'ingreso' ? 'Ingresos fijos' : calc.isTemporary(r) ? 'Pagos temporales' : 'Gastos fijos',
    }));
  const sim = store
    .list('simItems')
    .map((r) => ({ rec: r, real: false, included: r.active !== false, group: r.group || (r.type === 'ingreso' ? 'Ingresos supuestos' : 'Gastos supuestos') }));
  return [...real, ...sim];
}

export function runSimulation(cfg = simConfig()) {
  const { start, end } = simRange(cfg);
  const st = calc.weeklyStats();
  const baseIncome = cfg.baseIncome === '' || cfg.baseIncome == null ? Math.round(st.avgIncome) : Number(cfg.baseIncome) || 0;
  const sources = simSources(cfg);

  // Cuántas veces cae cada movimiento en el periodo y en qué fechas.
  const hits = sources.map((s) => {
    const occ = calc.occurrences(s.rec, end).filter((o) => o.date >= start);
    const mxn = occ.map((o) => ({ date: o.date, amount: calc.toMXN(o.amount, s.rec.currency) }));
    return { ...s, occ: mxn, count: mxn.length, total: mxn.reduce((a, o) => a + o.amount, 0) };
  });

  const weeks = [];
  // Dinero libre al inicio del periodo: si el periodo ya empezó, se quitan los
  // movimientos reales de esos días para no contarlos dos veces.
  let balance = 0;
  if (cfg.includeBalance) {
    balance = calc.netWorthMXN() - calc.totalReservedMXN();
    if (start <= today()) balance -= calc.totals(calc.txInRange(start, today())).net;
  }
  const startBalance = balance;
  for (let d = parseDate(start); toISODate(d) <= end; d = addDays(d, 7)) {
    const ws = toISODate(d);
    const we = toISODate(addDays(d, 6)) > end ? end : toISODate(addDays(d, 6));
    const days = (parseDate(we) - parseDate(ws)) / 86400000 + 1;
    const override = cfg.weekIncome?.[ws];
    const custom = override !== undefined && override !== '';
    const income = custom ? Number(override) || 0 : (baseIncome * days) / 7;
    const variable = cfg.includeVariable ? (st.avgVariableExpense * days) / 7 : 0;
    let extraIncome = 0;
    let fixed = 0;
    const items = [];
    for (const h of hits) {
      if (!h.included) continue;
      for (const o of h.occ) {
        if (o.date < ws || o.date > we) continue;
        if (h.rec.type === 'ingreso') extraIncome += o.amount;
        else fixed += o.amount;
        items.push({ name: h.rec.name, type: h.rec.type, amount: o.amount, date: o.date });
      }
    }
    const net = income + extraIncome - variable - fixed;
    balance += net;
    weeks.push({ start: ws, end: we, days, income, custom, extraIncome, variable, fixed, net, balance, items });
  }

  const sum = (k) => weeks.reduce((a, w) => a + w[k], 0);
  const groups = new Map();
  for (const h of hits) {
    const key = `${h.rec.type}|${h.group}`;
    if (!groups.has(key)) groups.set(key, { name: h.group, type: h.rec.type, items: [], total: 0, perRound: 0 });
    const g = groups.get(key);
    g.items.push(h);
    if (h.included) {
      g.total += h.total;
      g.perRound += h.rec.frequency === 'fechas' ? 0 : calc.toMXN(Number(h.rec.amount) || 0, h.rec.currency);
    }
  }

  const income = sum('income') + sum('extraIncome');
  const expense = sum('variable') + sum('fixed');
  return {
    start,
    end,
    baseIncome,
    stats: st,
    weeks,
    groups: [...groups.values()].sort((a, b) => (a.type === b.type ? 0 : a.type === 'ingreso' ? -1 : 1)),
    income,
    expense,
    variable: sum('variable'),
    fixed: sum('fixed'),
    net: income - expense,
    startBalance,
    endBalance: balance,
    lowest: weeks.reduce((m, w) => Math.min(m, w.balance), startBalance),
  };
}

// ---------- Vista ----------

export function planTabs(active) {
  return `<div class="seg" style="align-self:start"><button class="${active === 'metas' ? 'active' : ''}" data-action="go" data-view="metas">🎯 Metas y compras</button><button class="${
    active === 'simulador' ? 'active' : ''
  }" data-action="go" data-view="simulador">🧪 Simulador</button></div>`;
}

export function viewSimulador() {
  const cfg = simConfig();
  const st = calc.weeklyStats();
  return `<div class="stack" id="sim-root">
    ${planTabs('simulador')}
    <div class="card">
      <div class="card-head"><div><h2>🧪 Simulador</h2><div class="small muted">Prueba "¿qué pasaría si…?" sin tocar tus movimientos reales.</div></div></div>
      <div class="form-grid">
        <label class="field"><span>Periodo</span><select class="input" id="sim-preset">${Object.entries(PERIODS)
          .map(([k, v]) => `<option value="${k}" ${cfg.preset === k ? 'selected' : ''}>${v.label}</option>`)
          .join('')}</select></label>
        <label class="field"><span>Empieza la semana del</span><input class="input" id="sim-start" type="date" value="${cfg.start || today()}" /></label>
        <div class="full row ${cfg.preset === 'custom' ? '' : 'hidden'}" id="sim-custom">
          <input class="input" id="sim-n" type="number" min="1" inputmode="numeric" value="${cfg.customN}" style="max-width:110px" />
          <select class="input" id="sim-unit"><option value="semanas" ${cfg.customUnit === 'semanas' ? 'selected' : ''}>semanas</option><option value="meses" ${cfg.customUnit === 'meses' ? 'selected' : ''}>meses</option></select>
        </div>
        <label class="field"><span>Ingreso normal por semana</span><input class="input" id="sim-base" type="number" min="0" inputmode="decimal" placeholder="${Math.round(st.avgIncome)} (tu promedio)" value="${cfg.baseIncome}" /></label>
        <div class="field"><span>Incluir</span>
          <label class="small row"><input type="checkbox" id="sim-var" ${cfg.includeVariable ? 'checked' : ''} /> Gastos del día a día (${fmt(st.avgVariableExpense)}/sem promedio)</label>
          <label class="small row"><input type="checkbox" id="sim-bal" ${cfg.includeBalance ? 'checked' : ''} /> Empezar con mi dinero libre (lo que tenía al inicio del periodo)</label>
        </div>
      </div>
      <div class="tiny muted" style="margin-top:10px">💡 Para semanas distintas (ej. 2300, 1800, 2000, 1600) cambia el ingreso de cada semana en la tabla de abajo.</div>
    </div>

    <div class="card">
      <div class="card-head"><div><h2>Gastos e ingresos en la simulación</h2><div class="small muted">Tus gastos fijos y temporales ya están incluidos. Desmarca los que no quieras contar.</div></div></div>
      <div class="row wrap" style="margin-bottom:10px">
        <button class="btn btn-sm" data-action="sim-new" data-type="gasto" data-freq="una">＋ Gasto individual</button>
        <button class="btn btn-sm" data-action="sim-new" data-type="gasto" data-freq="semanal">＋ Gasto que se repite</button>
        <button class="btn btn-sm" data-action="sim-new" data-type="gasto" data-freq="fechas">＋ Gasto temporal</button>
        <button class="btn btn-sm" data-action="sim-new" data-type="ingreso" data-freq="una">＋ Ingreso extra</button>
      </div>
      <div id="sim-groups"></div>
    </div>

    <div id="sim-results"></div>
  </div>`;
}

function groupsHtml(res) {
  if (!res.groups.length) return `<div class="empty">Agrega gastos o ingresos para simular.</div>`;
  return res.groups
    .map(
      (g) => `<div style="margin-bottom:14px">
      <div class="row between" style="padding:4px 0"><h3>${esc(g.name)}</h3><span class="small num ${g.type === 'ingreso' ? 'income' : 'expense'}">${g.perRound && g.items.filter((h) => h.included).length > 1 ? `Suma ${fmt(g.perRound)} · ` : ''}<b>${fmt(g.total)}</b> en el periodo</span></div>
      <div class="list">${g.items
        .map((h) => {
          const c = store.get('categories', h.rec.categoryId) || { icon: h.rec.type === 'ingreso' ? '💰' : '🧾', color: '#64748b' };
          const freq =
            h.rec.frequency === 'una'
              ? `Una vez, ${calc.formatDate(h.rec.startDate)}`
              : h.rec.frequency === 'fechas'
                ? `${(h.rec.schedule || []).length} pagos en fechas elegidas`
                : h.rec.frequency === 'dias'
                  ? `Cada ${h.rec.everyDays} días`
                  : { semanal: 'Cada semana', quincenal: 'Cada 2 semanas', mensual: 'Cada mes', anual: 'Cada año' }[h.rec.frequency];
          return `<div class="list-item" style="${h.included ? '' : 'opacity:.45'}">
            ${
              h.real
                ? `<input type="checkbox" data-sim-toggle="${h.rec.id}" ${h.included ? 'checked' : ''} aria-label="Incluir ${esc(h.rec.name)}" />`
                : `<input type="checkbox" data-sim-active="${h.rec.id}" ${h.included ? 'checked' : ''} aria-label="Incluir ${esc(h.rec.name)}" />`
            }
            <span class="cat-ico" style="background:${c.color}26">${c.icon}</span>
            <button class="grow" style="background:none;border:0;text-align:left;padding:0" data-action="${h.real ? 'edit-recurring' : 'sim-edit'}" data-id="${h.rec.id}"><div class="li-title">${esc(h.rec.name)}${
              h.real ? '' : ' <span class="chip">supuesto</span>'
            }</div><div class="li-sub">${freq}</div></button>
            <span class="right"><div class="li-amount ${h.rec.type === 'ingreso' ? 'income' : 'expense'}">${fmt(h.total)}</div><div class="tiny muted">${h.count} ${h.count === 1 ? 'vez' : 'veces'}</div></span>
          </div>`;
        })
        .join('')}</div></div>`
    )
    .join('');
}

function resultsHtml(res) {
  const weekLabel = (w) => `${parseDate(w.start).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} – ${parseDate(w.end).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}`;
  return `<div class="card">
    <div class="card-head"><div><h2>Resultado</h2><div class="small muted">${calc.formatDate(res.start)} al ${calc.formatDate(res.end)} · ${res.weeks.length} semanas</div></div></div>
    <div class="kpis">
      <div class="kpi" style="padding:0"><div class="label">Ingresos</div><div class="value income">${fmt(res.income)}</div></div>
      <div class="kpi" style="padding:0"><div class="label">Gastos</div><div class="value expense">${fmt(res.expense)}</div><div class="sub">${fmt(res.fixed)} fijos/temporales · ${fmt(res.variable)} día a día</div></div>
      <div class="kpi" style="padding:0"><div class="label">Te sobra</div><div class="value ${res.net < 0 ? 'expense' : ''}">${fmt(res.net)}</div><div class="sub">${fmt(res.net / Math.max(1, res.weeks.length))} por semana</div></div>
      <div class="kpi" style="padding:0"><div class="label">Tendrías al final</div><div class="value ${res.endBalance < 0 ? 'expense' : ''}">${fmt(res.endBalance)}</div><div class="sub">${
        res.lowest < 0 ? `⚠️ Llegarías a ${fmt(res.lowest)} en algún momento` : 'Nunca quedas en negativo'
      }</div></div>
    </div>
    <div class="chart-box" style="margin-top:14px"><canvas id="ch-sim"></canvas></div>
    <div class="table-scroll" style="margin-top:12px;max-height:none"><table class="table"><thead><tr><th>Semana</th><th class="right">Ingreso</th><th class="right">Fijos y temporales</th><th class="right">Día a día</th><th class="right">Saldo</th></tr></thead><tbody>${res.weeks
      .map(
        (w) => `<tr>
          <td class="num" style="white-space:nowrap">${weekLabel(w)}${w.items.length ? `<div class="tiny muted" style="white-space:normal">${w.items.map((i) => `${esc(i.name)} ${fmt(i.amount)}`).join(', ')}</div>` : ''}</td>
          <td class="right"><input class="input num" data-week="${w.start}" type="number" min="0" inputmode="decimal" value="${w.custom ? Math.round(w.income * 100) / 100 : ''}" placeholder="${Math.round(
            w.income
          )}" style="width:96px;padding:6px 8px;font-size:14px;text-align:right;${w.custom ? 'border-color:var(--accent)' : ''}" />${w.extraIncome ? `<div class="tiny income">+${fmt(w.extraIncome)}</div>` : ''}</td>
          <td class="right num expense">${w.fixed ? fmt(w.fixed) : '—'}</td>
          <td class="right num muted">${w.variable ? fmt(w.variable) : '—'}</td>
          <td class="right num"><b class="${w.balance < 0 ? 'expense' : ''}">${fmt(w.balance)}</b></td>
        </tr>`
      )
      .join('')}</tbody></table></div>
    <div class="row" style="margin-top:10px"><button class="btn btn-sm btn-ghost" data-action="sim-reset-weeks">Quitar ingresos personalizados</button></div>
  </div>`;
}

// Se agenda para el siguiente cuadro: así un "change" disparado al perder el foco
// mientras redibujamos no provoca un redibujo dentro de otro.
let simQueued = false;
export function renderSimResults() {
  if (simQueued) return;
  simQueued = true;
  requestAnimationFrame(() => {
    simQueued = false;
    drawSimResults();
  });
}

function drawSimResults() {
  const box = $('#sim-results');
  if (!box) return;
  const focused = document.activeElement?.dataset?.week;
  const res = runSimulation();
  $('#sim-groups').innerHTML = groupsHtml(res);
  box.innerHTML = resultsHtml(res);
  charts.simulationChart('ch-sim', res);
  if (focused) $(`[data-week="${focused}"]`)?.focus();
}

export function afterSimulador() {
  const change = (id, fn) => $(id).addEventListener('change', (e) => {
    fn(e.target);
    renderSimResults();
  });
  change('#sim-preset', (el) => {
    setSim({ preset: el.value });
    $('#sim-custom').classList.toggle('hidden', el.value !== 'custom');
  });
  change('#sim-start', (el) => setSim({ start: el.value }));
  change('#sim-n', (el) => setSim({ customN: Number(el.value) || 1 }));
  change('#sim-unit', (el) => setSim({ customUnit: el.value }));
  change('#sim-base', (el) => setSim({ baseIncome: el.value }));
  change('#sim-var', (el) => setSim({ includeVariable: el.checked }));
  change('#sim-bal', (el) => setSim({ includeBalance: el.checked }));
  $('#sim-root').addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.week) {
      const weekIncome = { ...simConfig().weekIncome };
      if (t.value === '') delete weekIncome[t.dataset.week];
      else weekIncome[t.dataset.week] = Number(t.value);
      setSim({ weekIncome });
    } else if (t.dataset.simToggle) {
      const excluded = new Set(simConfig().excluded);
      t.checked ? excluded.delete(t.dataset.simToggle) : excluded.add(t.dataset.simToggle);
      setSim({ excluded: [...excluded] });
    } else if (t.dataset.simActive) {
      const it = store.get('simItems', t.dataset.simActive);
      store.save('simItems', { ...it, active: t.checked });
    } else return;
    renderSimResults();
  });
  renderSimResults();
}

export const simActions = (recurringModal) => ({
  'sim-new': (el) => {
    const { start } = simRange();
    const startDate = start > today() ? start : today();
    recurringModal(null, { type: el.dataset.type, frequency: el.dataset.freq, startDate }, { kind: 'simItems' });
  },
  'sim-edit': (el) => recurringModal(store.get('simItems', el.dataset.id), {}, { kind: 'simItems' }),
  'sim-reset-weeks': () => {
    setSim({ weekIncome: {} });
    renderSimResults();
  },
});

