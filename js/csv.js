// Importar estados de cuenta en CSV y exportar a CSV / Excel.

import * as store from './store.js';
import { amountMXN, monthSummary, monthName, txInMonth, byCategory } from './calc.js';

// ---------- Lectura de CSV ----------

export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = [';', ',', '\t', '|'].map((d) => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(field.trim());
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim());
      if (row.some((c) => c !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field.trim());
  if (row.some((c) => c !== '')) rows.push(row);
  return rows;
}

// Convierte "1,234.56", "$1.234,56", "(500.00)" o "-500" a número.
export function parseAmount(s) {
  if (s == null) return NaN;
  let str = String(s).trim();
  if (!str) return NaN;
  let neg = /^\(.*\)$/.test(str) || /-/.test(str);
  str = str.replace(/[^\d.,]/g, '');
  const lastComma = str.lastIndexOf(',');
  const lastDot = str.lastIndexOf('.');
  if (lastComma > lastDot) {
    // Coma decimal si hay 1-2 dígitos después de ella.
    if (str.length - lastComma - 1 <= 2) str = str.replace(/\./g, '').replace(',', '.');
    else str = str.replace(/,/g, '');
  } else str = str.replace(/,/g, '');
  const n = parseFloat(str);
  return neg ? -n : n;
}

// Acepta DD/MM/YYYY, DD-MM-YY, YYYY-MM-DD, "05 ene 2026", etc.
const MES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12, jan: 1, apr: 4, aug: 8, dec: 12 };
export function parseDateFlexible(s) {
  if (!s) return null;
  const str = String(s).trim().toLowerCase();
  let m = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return iso(y, +m[2], +m[1]);
  }
  m = str.match(/^(\d{1,2})[\s/-]+([a-zé]{3})[a-zé]*[\s/-]+(\d{2,4})/);
  if (m && MES[m[2]]) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return iso(y, MES[m[2]], +m[1]);
  }
  return null;
}
function iso(y, m, d) {
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Adivina qué columna es cada cosa a partir de los encabezados.
export function guessMapping(header) {
  const h = header.map((x) => x.toLowerCase());
  const find = (...words) => h.findIndex((c) => words.some((w) => c.includes(w)));
  return {
    date: find('fecha', 'date'),
    description: find('descrip', 'concepto', 'detalle', 'movimiento', 'description', 'referencia'),
    amount: find('importe', 'monto', 'amount', 'cantidad'),
    debit: find('cargo', 'retiro', 'débito', 'debito', 'debit'),
    credit: find('abono', 'depósito', 'deposito', 'crédito', 'credito', 'credit'),
  };
}

// Sugiere una categoría según palabras clave de la descripción.
const KEYWORDS = {
  'cat-comida': ['oxxo', 'walmart', 'soriana', 'chedraui', 'restaurant', 'rest ', 'tacos', 'pizza', 'uber eats', 'rappi', 'didi food', 'starbucks', 'seven', '7-eleven', 'super', 'comida'],
  'cat-transporte': ['uber', 'didi', 'gasolin', 'pemex', 'metro', 'caseta', 'estacionamiento', 'bp ', 'shell'],
  'cat-suscripciones': ['netflix', 'spotify', 'disney', 'hbo', 'max ', 'prime', 'youtube', 'apple.com', 'google', 'icloud', 'xbox', 'playstation'],
  'cat-casa': ['cfe', 'telmex', 'izzi', 'totalplay', 'megacable', 'agua', 'renta', 'gas ', 'telcel', 'at&t'],
  'cat-salud': ['farmacia', 'similares', 'benavides', 'del ahorro', 'doctor', 'hospital', 'laboratorio'],
  'cat-tecnologia': ['amazon', 'mercado libre', 'mercadolibre', 'cyberpuerta', 'ddtech', 'steren', 'best buy', 'liverpool'],
  'cat-ocio': ['cine', 'cinepolis', 'cinemex', 'bar ', 'steam', 'ticketmaster'],
  'cat-ropa': ['zara', 'h&m', 'c&a', 'shein', 'coppel', 'suburbia'],
};
export function guessCategory(description, type) {
  const d = ` ${String(description).toLowerCase()} `;
  const cats = store.list('categories').filter((c) => c.type === type);
  for (const [catId, words] of Object.entries(KEYWORDS)) {
    if (cats.some((c) => c.id === catId) && words.some((w) => d.includes(w))) return catId;
  }
  const byName = cats.find((c) => d.includes(c.name.toLowerCase()));
  if (byName) return byName.id;
  const fallback = type === 'ingreso' ? 'cat-otros-ing' : 'cat-otros';
  return cats.find((c) => c.id === fallback)?.id || cats[0]?.id || null;
}

// Convierte filas de CSV en movimientos según el mapeo elegido.
export function rowsToTransactions(rows, mapping, { accountId, currency, invert = false }) {
  const existing = new Set(store.list('transactions').map((t) => `${t.date}|${Math.round(amountMXN(t) * 100)}|${(t.note || '').toLowerCase()}`));
  const out = [];
  for (const r of rows) {
    const date = parseDateFlexible(r[mapping.date]);
    if (!date) continue;
    let value;
    if (mapping.amount >= 0) value = parseAmount(r[mapping.amount]);
    else {
      const debit = parseAmount(r[mapping.debit]);
      const credit = parseAmount(r[mapping.credit]);
      value = (Number.isFinite(credit) ? Math.abs(credit) : 0) - (Number.isFinite(debit) ? Math.abs(debit) : 0);
    }
    if (!Number.isFinite(value) || value === 0) continue;
    if (invert) value = -value;
    const type = value > 0 ? 'ingreso' : 'gasto';
    const note = mapping.description >= 0 ? r[mapping.description] : '';
    const tx = { type, amount: Math.abs(value), currency, accountId, date, note, categoryId: guessCategory(note, type), imported: true };
    const key = `${date}|${Math.round(amountMXN(tx) * 100)}|${note.toLowerCase()}`;
    out.push({ ...tx, duplicate: existing.has(key) });
  }
  return out;
}

// ---------- Exportar ----------

function txRows() {
  const cats = Object.fromEntries(store.list('categories').map((c) => [c.id, c.name]));
  const accs = Object.fromEntries(store.list('accounts').map((a) => [a.id, a.name]));
  return store
    .list('transactions')
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((t) => ({
      Fecha: t.date,
      Tipo: t.type,
      Categoría: t.type === 'transferencia' ? 'Transferencia' : cats[t.categoryId] || '',
      Cuenta: accs[t.accountId] || '',
      'Cuenta destino': t.toAccountId ? accs[t.toAccountId] || '' : '',
      Monto: Number(t.amount),
      Moneda: t.currency || 'MXN',
      'Monto MXN': Math.round(amountMXN(t) * 100) / 100,
      Nota: t.note || '',
    }));
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCSV() {
  const rows = txRows();
  const header = Object.keys(rows[0] || { Fecha: '', Tipo: '', Categoría: '', Cuenta: '', 'Cuenta destino': '', Monto: '', Moneda: '', 'Monto MXN': '', Nota: '' });
  const esc = (v) => {
    const s = String(v ?? '');
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [header.join(','), ...rows.map((r) => header.map((h) => esc(r[h])).join(','))].join('\r\n');
  download(`movimientos-${new Date().toISOString().slice(0, 10)}.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
}

export function exportXLSX(monthKeys) {
  const XLSX = window.XLSX;
  if (!XLSX) throw new Error('No se cargó la librería de Excel');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(txRows()), 'Movimientos');
  const summary = monthKeys.map((k) => {
    const s = monthSummary(k);
    return { Mes: monthName(k), Ingresos: Math.round(s.income), Gastos: Math.round(s.expense), Balance: Math.round(s.net), 'Movimientos': s.count };
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Resumen mensual');
  const catRows = [];
  for (const k of monthKeys) for (const c of byCategory(txInMonth(k))) catRows.push({ Mes: monthName(k), Categoría: c.category.name, Total: Math.round(c.total) });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(catRows.length ? catRows : [{ Mes: '', Categoría: '', Total: '' }]), 'Gastos por categoría');
  XLSX.writeFile(wb, `finanzas-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportJSON() {
  const blob = new Blob([JSON.stringify(store.exportBackup(), null, 2)], { type: 'application/json' });
  download(`respaldo-finanzas-${new Date().toISOString().slice(0, 10)}.json`, blob);
}
