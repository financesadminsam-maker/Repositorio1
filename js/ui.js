// Utilidades de interfaz: selectores, escape de texto, modales y avisos.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

let onKey = null;

export function renderModal(html, onMount, { wide = false } = {}) {
  closeModal();
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = $('.modal-backdrop', root);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) closeModal();
  });
  $$('[data-close]', root).forEach((b) => b.addEventListener('click', closeModal));
  onKey = (e) => {
    if (e.key === 'Escape') closeModal();
  };
  document.addEventListener('keydown', onKey);
  document.body.style.overflow = 'hidden';
  onMount?.($('.modal', root));
}

export function closeModal() {
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
  if (onKey) document.removeEventListener('keydown', onKey);
  onKey = null;
}

export function toast(message, level = '') {
  const el = document.createElement('div');
  el.className = `toast ${level}`;
  el.textContent = message;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), level ? 4500 : 2600);
}
