// Gráficas con Chart.js (cargado en vendor/chart.umd.js).

import { fromMXN, money, shortMonth, monthName } from './calc.js';
import * as store from './store.js';

const instances = new Map();

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const disp = (mxn) => fromMXN(mxn, store.getSettings().displayCurrency);
const tick = (v) => money(v, { decimals: 0 }).replace(' USD', '');

function base() {
  const Chart = window.Chart;
  Chart.defaults.color = css('--muted');
  Chart.defaults.font.family = css('--font') || 'system-ui';
  Chart.defaults.borderColor = css('--grid');
  return Chart;
}

function mount(id, config) {
  const el = document.getElementById(id);
  if (!el || !window.Chart) return;
  instances.get(id)?.destroy();
  instances.set(id, new (base())(el, config));
}

export function destroyAll() {
  instances.forEach((c) => c.destroy());
  instances.clear();
}

const tooltipMoney = {
  callbacks: { label: (ctx) => `${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${money(ctx.parsed.y ?? ctx.parsed)}` },
};

export function categoryDonut(id, cats) {
  mount(id, {
    type: 'doughnut',
    data: {
      labels: cats.map((c) => `${c.category.icon || ''} ${c.category.name}`),
      datasets: [{ data: cats.map((c) => disp(c.total)), backgroundColor: cats.map((c) => c.category.color), borderColor: css('--surface'), borderWidth: 2 }],
    },
    options: {
      cutout: '68%',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => ` ${money(ctx.parsed)}` } },
      },
    },
  });
}

export function incomeExpenseBars(id, history) {
  mount(id, {
    type: 'bar',
    data: {
      labels: history.map((h) => shortMonth(h.month)),
      datasets: [
        { label: 'Ingresos', data: history.map((h) => disp(h.income)), backgroundColor: css('--income'), borderRadius: 6, maxBarThickness: 28 },
        { label: 'Gastos', data: history.map((h) => disp(h.expense)), backgroundColor: css('--expense'), borderRadius: 6, maxBarThickness: 28 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } },
        tooltip: { ...tooltipMoney, callbacks: { ...tooltipMoney.callbacks, title: (items) => monthName(history[items[0].dataIndex].month) } },
      },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: tick, maxTicksLimit: 5 } } },
    },
  });
}

export function weeklyIncomeLine(id, weeks) {
  mount(id, {
    type: 'line',
    data: {
      labels: weeks.map((w) => w.start.slice(5).split('-').reverse().join('/')),
      datasets: [
        { label: 'Ingreso semanal', data: weeks.map((w) => disp(w.income)), borderColor: css('--income'), backgroundColor: css('--income-soft'), fill: true, tension: 0.3, pointRadius: 3 },
        { label: 'Gasto semanal', data: weeks.map((w) => disp(w.expense)), borderColor: css('--expense'), tension: 0.3, pointRadius: 3 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: tooltipMoney },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: tick, maxTicksLimit: 5 } } },
    },
  });
}

export function projectionLine(id, history, proj) {
  const labels = [...history.map((h) => shortMonth(h.month)), ...proj.rows.map((r) => shortMonth(r.month))];
  // Saldo real al cierre de cada mes, reconstruido hacia atrás desde el saldo actual.
  const real = [];
  let bal = proj.startBalance;
  for (let i = history.length - 1; i >= 0; i--) {
    real[i] = bal;
    bal -= history[i].net;
  }
  const projected = [...Array(history.length - 1).fill(null), proj.startBalance, ...proj.rows.map((r) => r.balance)];
  mount(id, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Saldo real', data: [...real.map(disp), ...proj.rows.map(() => null)], borderColor: css('--accent'), tension: 0.3, pointRadius: 3 },
        { label: 'Proyección', data: projected.map((v) => (v == null ? null : disp(v))), borderColor: css('--accent'), borderDash: [6, 5], tension: 0.3, pointRadius: 2 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      spanGaps: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: tooltipMoney },
      scales: { x: { grid: { display: false } }, y: { ticks: { callback: tick, maxTicksLimit: 5 } } },
    },
  });
}

export function savingsPlanLine(id, plan, saved) {
  const sc = plan.scenarios.filter((s) => Number.isFinite(s.weeks));
  const maxWeeks = Math.min(Math.max(...sc.map((s) => s.weeks), plan.target?.weeks || 0, 1), 104);
  const labels = Array.from({ length: maxWeeks + 1 }, (_, i) => `S${i}`);
  const colors = { malo: css('--expense'), promedio: css('--accent'), bueno: css('--income') };
  const goal = saved + plan.needed;
  mount(id, {
    type: 'line',
    data: {
      labels,
      datasets: [
        ...sc.map((s) => ({
          label: s.label,
          data: labels.map((_, i) => disp(Math.min(goal, saved + s.surplus * i))),
          borderColor: colors[s.key],
          tension: 0,
          pointRadius: 0,
        })),
        { label: 'Meta', data: labels.map(() => disp(goal)), borderColor: css('--muted'), borderDash: [4, 4], pointRadius: 0 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10 } }, tooltip: tooltipMoney },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 8 } }, y: { ticks: { callback: tick, maxTicksLimit: 5 } } },
    },
  });
}
