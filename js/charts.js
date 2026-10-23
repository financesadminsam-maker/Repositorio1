// Gráficas con Chart.js (cargado en vendor/chart.umd.js), con estilo de
// plataforma de trading: cruz al pasar el cursor, etiqueta del último valor,
// rellenos en degradado, velas y promedios móviles.

import { fromMXN, money, shortMonth, monthName, parseDate } from './calc.js';
import * as store from './store.js';

const instances = new Map();

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const disp = (mxn) => fromMXN(mxn, store.getSettings().displayCurrency);
const tick = (v) => compact(v);
const shortDate = (iso) => parseDate(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }).replace('.', '');

// $12.3k, $1.2M: etiquetas cortas para los ejes.
function compact(v) {
  const cur = store.getSettings().displayCurrency;
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : '';
  const sym = cur === 'USD' ? 'US$' : '$';
  if (a >= 1e6) return `${sign}${sym}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${sym}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${sign}${sym}${Math.round(a)}`;
}

// Mezcla un color hex con transparencia.
function alpha(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function gradient(color, top = 0.35) {
  return (ctx) => {
    const { chart } = ctx;
    const area = chart.chartArea;
    if (!area) return alpha(color, top / 2);
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, alpha(color, top));
    g.addColorStop(1, alpha(color, 0));
    return g;
  };
}

function movingAverage(values, n) {
  return values.map((_, i) => {
    if (i < n - 1) return null;
    const slice = values.slice(i - n + 1, i + 1);
    return slice.reduce((a, b) => a + b, 0) / n;
  });
}

// ---------- Plugins ----------

// Línea vertical (y horizontal) que sigue al cursor o al dedo.
const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(chart, _args, opts) {
    if (opts === false || opts?.enabled === false) return;
    const active = chart.tooltip?.getActiveElements?.() || [];
    if (!active.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    const y = active[0].element.y;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.strokeStyle = css('--crosshair');
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    if (opts?.horizontal !== false && y) {
      ctx.moveTo(chartArea.left, y);
      ctx.lineTo(chartArea.right, y);
    }
    ctx.stroke();
    ctx.restore();
  },
};

// Etiqueta con el último valor pegada al eje derecho, como el precio actual.
const lastValue = {
  id: 'lastValue',
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts?.enabled) return;
    const ds = chart.data.datasets[opts.dataset || 0];
    const meta = chart.getDatasetMeta(opts.dataset || 0);
    if (!ds || !meta?.data?.length) return;
    let i = ds.data.length - 1;
    while (i >= 0 && ds.data[i] == null) i--;
    if (i < 0) return;
    const pt = meta.data[i];
    const { ctx, chartArea } = chart;
    const text = compact(ds.data[i]);
    ctx.save();
    ctx.font = `600 11px ${css('--mono')}`;
    const w = ctx.measureText(text).width + 12;
    const color = opts.color || ds.borderColor;
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = alpha(color, 0.6);
    ctx.beginPath();
    ctx.moveTo(chartArea.left, pt.y);
    ctx.lineTo(chartArea.right, pt.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    const x = chartArea.right - w;
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, pt.y - 9, w, 18, 3) : ctx.rect(x, pt.y - 9, w, 18);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 6, pt.y);
    ctx.restore();
  },
};

// Total en el centro de la dona.
const centerText = {
  id: 'centerText',
  afterDraw(chart, _args, opts) {
    if (!opts?.text) return;
    const { ctx, chartArea } = chart;
    const cx = (chartArea.left + chartArea.right) / 2;
    const cy = (chartArea.top + chartArea.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = css('--muted');
    ctx.font = `500 10px ${css('--font')}`;
    ctx.fillText(opts.label || '', cx, cy - 11);
    ctx.fillStyle = css('--text');
    ctx.font = `700 15px ${css('--mono')}`;
    ctx.fillText(opts.text, cx, cy + 7);
    ctx.restore();
  },
};

let registered = false;
function base() {
  const Chart = window.Chart;
  if (!registered) {
    Chart.register(crosshair, lastValue, centerText);
    registered = true;
  }
  Chart.defaults.color = css('--muted');
  Chart.defaults.font.family = css('--font') || 'system-ui';
  Chart.defaults.font.size = 11;
  Chart.defaults.borderColor = css('--grid');
  Chart.defaults.animation.duration = 450;
  const tt = Chart.defaults.plugins.tooltip;
  tt.backgroundColor = css('--tooltip');
  tt.borderColor = css('--border');
  tt.borderWidth = 1;
  tt.titleColor = css('--text');
  tt.bodyColor = css('--text');
  tt.titleFont = { family: css('--font'), weight: '600', size: 12 };
  tt.bodyFont = { family: css('--mono'), size: 12 };
  tt.padding = 10;
  tt.cornerRadius = 6;
  tt.boxPadding = 4;
  tt.usePointStyle = true;
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
  callbacks: { label: (ctx) => ` ${ctx.dataset.label ? ctx.dataset.label + ': ' : ''}${money(ctx.parsed.y ?? ctx.parsed)}` },
};
const legendBottom = { position: 'bottom', align: 'start', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'rectRounded', padding: 14 } };
const yRight = (extra = {}) => ({ position: 'right', grid: { color: css('--grid') }, border: { display: false }, ticks: { callback: tick, maxTicksLimit: 6, font: { family: css('--mono'), size: 10 } }, ...extra });
const xAxis = (extra = {}) => ({ grid: { display: false }, border: { color: css('--border') }, ticks: { maxRotation: 0, autoSkipPadding: 12, font: { size: 10 } }, ...extra });

// ---------- Mini gráfica (sparkline) ----------

export function sparkline(id, values, color) {
  const c = color || (values[values.length - 1] >= values[0] ? css('--income') : css('--expense'));
  mount(id, {
    type: 'line',
    data: { labels: values.map((_, i) => i), datasets: [{ data: values.map(disp), borderColor: c, backgroundColor: gradient(c, 0.3), fill: true, borderWidth: 1.5, tension: 0.35, pointRadius: 0 }] },
    options: {
      maintainAspectRatio: false,
      animation: false,
      events: [],
      plugins: { legend: { display: false }, tooltip: { enabled: false }, crosshair: false },
      scales: { x: { display: false }, y: { display: false } },
      layout: { padding: 1 },
    },
  });
}

// ---------- Curva de saldo ----------

export function equityChart(id, series) {
  const up = series.length < 2 || series[series.length - 1].balance >= series[0].balance;
  const c = up ? css('--income') : css('--expense');
  mount(id, {
    type: 'line',
    data: {
      labels: series.map((d) => d.date),
      datasets: [
        { label: 'Saldo', data: series.map((d) => disp(d.balance)), borderColor: c, backgroundColor: gradient(c, 0.28), fill: true, borderWidth: 2, tension: 0.25, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: c },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        lastValue: { enabled: true, color: c },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: (items) => parseDate(series[items[0].dataIndex].date).toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }),
            label: (ctx) => {
              const d = series[ctx.dataIndex];
              return [`Saldo: ${money(ctx.parsed.y)}`, d.net ? `Movimiento del día: ${money(disp(d.net), { sign: true })}` : 'Sin movimientos'];
            },
          },
        },
      },
      scales: {
        x: xAxis({ ticks: { maxRotation: 0, autoSkipPadding: 18, font: { size: 10 }, callback: (_v, i) => shortDate(series[i].date) } }),
        y: yRight({ grace: '8%' }),
      },
    },
  });
}

// ---------- Velas semanales del saldo + volumen ----------

export function candleChart(id, candles) {
  const upC = css('--income');
  const dnC = css('--expense');
  const isUp = (c) => c.close >= c.open;
  const maxVol = Math.max(1, ...candles.map((c) => c.income + c.expense));
  const lows = candles.map((c) => disp(c.low));
  const highs = candles.map((c) => disp(c.high));
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const pad = (max - min) * 0.1 || Math.abs(max) * 0.1 || 100;
  // El volumen ocupa el 22% inferior del gráfico.
  const volScale = ((max - min + 2 * pad) * 0.22) / maxVol;
  const volBase = min - pad;
  mount(id, {
    type: 'bar',
    data: {
      labels: candles.map((c) => shortDate(c.start)),
      datasets: [
        {
          label: 'Mecha',
          data: candles.map((c) => [disp(c.low), disp(c.high)]),
          backgroundColor: candles.map((c) => (isUp(c) ? upC : dnC)),
          barThickness: 1.5,
          grouped: false,
          order: 2,
        },
        {
          label: 'Cuerpo',
          data: candles.map((c) => {
            const o = disp(c.open);
            const cl = disp(c.close);
            return o === cl ? [o - pad * 0.02, cl + pad * 0.02] : [o, cl];
          }),
          backgroundColor: candles.map((c) => (isUp(c) ? alpha(upC, 0.85) : alpha(dnC, 0.85))),
          borderColor: candles.map((c) => (isUp(c) ? upC : dnC)),
          borderWidth: 1,
          borderSkipped: false,
          barPercentage: 0.65,
          categoryPercentage: 0.9,
          grouped: false,
          order: 1,
        },
        {
          label: 'Volumen',
          data: candles.map((c) => [volBase, volBase + (c.income + c.expense) * volScale]),
          backgroundColor: candles.map((c) => alpha(isUp(c) ? upC : dnC, 0.18)),
          barPercentage: 0.65,
          categoryPercentage: 0.9,
          grouped: false,
          order: 3,
        },
        {
          type: 'line',
          label: 'Promedio 4 semanas',
          data: movingAverage(candles.map((c) => disp(c.close)), 4),
          borderColor: css('--gold'),
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.3,
          order: 0,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          filter: (item) => item.datasetIndex === 1,
          callbacks: {
            title: (items) => `Semana del ${shortDate(candles[items[0].dataIndex].start)}`,
            label: (ctx) => {
              const c = candles[ctx.dataIndex];
              const ch = c.close - c.open;
              const pct = c.open ? (ch / Math.abs(c.open)) * 100 : 0;
              return [
                `Apertura  ${money(disp(c.open))}`,
                `Máximo    ${money(disp(c.high))}`,
                `Mínimo    ${money(disp(c.low))}`,
                `Cierre    ${money(disp(c.close))}`,
                `Cambio    ${money(disp(ch), { sign: true })}${c.open ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)` : ''}`,
                `Entró ${money(disp(c.income))} · Salió ${money(disp(c.expense))}`,
              ];
            },
          },
        },
      },
      scales: { x: xAxis(), y: yRight({ min: volBase, max: max + pad }) },
    },
  });
}

// ---------- Distribución por categoría ----------

export function categoryDonut(id, cats) {
  const total = cats.reduce((s, c) => s + c.total, 0);
  mount(id, {
    type: 'doughnut',
    data: {
      labels: cats.map((c) => `${c.category.icon || ''} ${c.category.name}`),
      datasets: [{ data: cats.map((c) => disp(c.total)), backgroundColor: cats.map((c) => c.category.color), borderColor: css('--surface'), borderWidth: 2, hoverOffset: 6, spacing: 1 }],
    },
    options: {
      cutout: '72%',
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        crosshair: false,
        centerText: { label: 'TOTAL', text: compact(disp(total)) },
        tooltip: { callbacks: { label: (ctx) => ` ${money(ctx.parsed)} · ${total ? Math.round((cats[ctx.dataIndex].total / total) * 100) : 0}%` } },
      },
    },
  });
}

// ---------- Ingresos vs gastos por mes + balance ----------

export function incomeExpenseBars(id, history) {
  mount(id, {
    type: 'bar',
    data: {
      labels: history.map((h) => shortMonth(h.month)),
      datasets: [
        { label: 'Ingresos', data: history.map((h) => disp(h.income)), backgroundColor: alpha(css('--income'), 0.85), borderRadius: 3, maxBarThickness: 22, order: 2 },
        { label: 'Gastos', data: history.map((h) => disp(h.expense)), backgroundColor: alpha(css('--expense'), 0.85), borderRadius: 3, maxBarThickness: 22, order: 2 },
        { type: 'line', label: 'Balance', data: history.map((h) => disp(h.net)), borderColor: css('--gold'), backgroundColor: css('--gold'), borderWidth: 2, pointRadius: 3, pointHoverRadius: 5, tension: 0.3, order: 1 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: legendBottom,
        crosshair: { horizontal: false },
        tooltip: {
          ...tooltipMoney,
          callbacks: {
            ...tooltipMoney.callbacks,
            title: (items) => monthName(history[items[0].dataIndex].month),
            footer: (items) => {
              const h = history[items[0].dataIndex];
              return h.income ? `Ahorro: ${Math.round((h.net / h.income) * 100)}% de lo que entró` : '';
            },
          },
        },
      },
      scales: { x: xAxis(), y: yRight() },
    },
  });
}

// ---------- Semanas: ingreso, gasto y promedio móvil ----------

export function weeklyIncomeLine(id, weeks) {
  const inc = weeks.map((w) => disp(w.income));
  const exp = weeks.map((w) => disp(w.expense));
  mount(id, {
    type: 'line',
    data: {
      labels: weeks.map((w) => shortDate(w.start)),
      datasets: [
        { label: 'Ingreso', data: inc, borderColor: css('--income'), backgroundColor: gradient(css('--income'), 0.25), fill: true, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
        { label: 'Gasto', data: exp, borderColor: css('--expense'), backgroundColor: gradient(css('--expense'), 0.18), fill: true, borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4 },
        { label: 'Promedio ingreso (4 sem)', data: movingAverage(inc, 4), borderColor: css('--gold'), borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0.3, fill: false },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendBottom, tooltip: { ...tooltipMoney, callbacks: { ...tooltipMoney.callbacks, title: (items) => `Semana del ${items[0].label}` } } },
      scales: { x: xAxis(), y: yRight({ beginAtZero: true }) },
    },
  });
}

// ---------- Proyección con banda de escenarios ----------

export function projectionLine(id, history, proj) {
  const labels = [...history.map((h) => shortMonth(h.month)), ...proj.rows.map((r) => shortMonth(r.month))];
  // Saldo real al cierre de cada mes, reconstruido hacia atrás desde el saldo actual.
  const real = [];
  let bal = proj.startBalance;
  for (let i = history.length - 1; i >= 0; i--) {
    real[i] = bal;
    bal -= history[i].net;
  }
  const pre = Array(history.length - 1).fill(null);
  const sb = proj.startBalance;
  const acc = css('--accent');
  mount(id, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'Escenario bueno', data: [...pre, sb, ...proj.rows.map((r) => r.high)].map((v) => (v == null ? null : disp(v))), borderColor: alpha(css('--income'), 0.5), borderWidth: 1, borderDash: [2, 3], pointRadius: 0, fill: '+1', backgroundColor: alpha(acc, 0.12), tension: 0.3 },
        { label: 'Escenario flojo', data: [...pre, sb, ...proj.rows.map((r) => r.low)].map((v) => (v == null ? null : disp(v))), borderColor: alpha(css('--expense'), 0.5), borderWidth: 1, borderDash: [2, 3], pointRadius: 0, fill: false, tension: 0.3 },
        { label: 'Saldo real', data: [...real.map(disp), ...proj.rows.map(() => null)], borderColor: acc, backgroundColor: gradient(acc, 0.25), fill: 'origin', borderWidth: 2, tension: 0.3, pointRadius: 3, pointBackgroundColor: acc },
        { label: 'Proyección', data: [...pre, sb, ...proj.rows.map((r) => r.balance)].map((v) => (v == null ? null : disp(v))), borderColor: acc, borderDash: [6, 5], borderWidth: 2, tension: 0.3, pointRadius: 2, fill: false },
      ],
    },
    options: {
      maintainAspectRatio: false,
      spanGaps: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendBottom, lastValue: { enabled: true, dataset: 3, color: acc }, tooltip: { ...tooltipMoney, filter: (i) => i.parsed.y != null } },
      scales: { x: xAxis(), y: yRight() },
    },
  });
}

// ---------- Plan de ahorro para una compra ----------

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
          data: labels.map((_, i) => disp(Math.min(goal, saved + s.path[i]))),
          borderColor: colors[s.key],
          backgroundColor: s.key === 'promedio' ? gradient(colors[s.key], 0.18) : 'transparent',
          fill: s.key === 'promedio' ? 'origin' : false,
          borderWidth: s.key === 'promedio' ? 2.5 : 1.5,
          tension: 0,
          pointRadius: 0,
          pointHoverRadius: 4,
        })),
        { label: 'Meta', data: labels.map(() => disp(goal)), borderColor: css('--gold'), borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendBottom, tooltip: { ...tooltipMoney, callbacks: { ...tooltipMoney.callbacks, title: (items) => `Semana ${items[0].dataIndex}` } } },
      scales: { x: xAxis({ ticks: { maxTicksLimit: 10, maxRotation: 0 } }), y: yRight({ beginAtZero: true }) },
    },
  });
}

// ---------- Simulador ----------

export function simulationChart(id, res) {
  const labels = res.weeks.map((w) => shortDate(w.start));
  const acc = css('--accent');
  mount(id, {
    data: {
      labels,
      datasets: [
        { type: 'bar', label: 'Ingresos', data: res.weeks.map((w) => disp(w.income + w.extraIncome)), backgroundColor: alpha(css('--income'), 0.8), borderRadius: 3, maxBarThickness: 18, order: 2, yAxisID: 'y' },
        { type: 'bar', label: 'Gastos', data: res.weeks.map((w) => disp(w.fixed + w.variable)), backgroundColor: alpha(css('--expense'), 0.8), borderRadius: 3, maxBarThickness: 18, order: 2, yAxisID: 'y' },
        { type: 'line', label: 'Saldo', data: res.weeks.map((w) => disp(w.balance)), borderColor: acc, backgroundColor: gradient(acc, 0.2), fill: 'origin', borderWidth: 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4, order: 1, yAxisID: 'y' },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { legend: legendBottom, lastValue: { enabled: true, dataset: 2, color: acc }, tooltip: { ...tooltipMoney, callbacks: { ...tooltipMoney.callbacks, title: (items) => `Semana del ${items[0].label}` } } },
      scales: { x: xAxis({ ticks: { maxTicksLimit: 12, maxRotation: 0 } }), y: yRight() },
    },
  });
}
