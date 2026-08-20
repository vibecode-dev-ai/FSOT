// Small DOM helpers shared by every view. No framework, no build step.

import { CHOICE_LETTERS } from './config.js';

/**
 * Resolve `{{N}}` choice references to the letter that choice is displayed as.
 *
 * Bank text refers to choices by their ORIGINAL stored index, but choices are
 * shuffled per session, so "option {{0}}" has to render as whatever letter the
 * first stored choice landed on.
 *
 * `choiceOrder[displayIndex] = originalIndex`, so the display position of an
 * original index is its position in that array. When there is no order —
 * shuffling turned off in Settings, or an attempt saved before the order was
 * recorded — fall back to identity, which is exactly the stored order.
 *
 * `{{0,2}}` names a SET of choices and renders them as sorted, correctly joined
 * letters ("B and D", "A, B, and D"). Sorting matters because the stored order
 * carries no meaning once shuffled: writing the two tokens separately would
 * produce "Both C and B", which is right but reads as though it were wrong.
 */
export function resolveChoiceRefs(text, choiceOrder) {
  const letterFor = (original) => {
    const display = Array.isArray(choiceOrder) ? choiceOrder.indexOf(original) : original;
    return CHOICE_LETTERS[display] ?? CHOICE_LETTERS[original];
  };

  return String(text ?? '').replace(/\{\{([0-3](?:\s*,\s*[0-3])*)\}\}/g, (_, list) => {
    const letters = list
      .split(',')
      .map((n) => letterFor(Number(n.trim())))
      .sort();
    if (letters.length === 1) return letters[0];
    if (letters.length === 2) return `${letters[0]} and ${letters[1]}`;
    return `${letters.slice(0, -1).join(', ')}, and ${letters[letters.length - 1]}`;
  });
}

/** Escape text for safe interpolation into HTML. */
export function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a multi-paragraph string (blank-line separated) as escaped <p> tags. */
export function paragraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $$(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

/** Delegated click handler: on(root, '.btn', fn). */
export function on(root, selector, event, handler) {
  root.addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target && root.contains(target)) handler(e, target);
  });
}

export function setView(html) {
  const view = $('#view');
  view.innerHTML = html;
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  return view;
}

export function formatDate(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Accuracy bar row used on results and progress screens. */
export function barRow(label, correct, total, accuracy, bandClass) {
  return `<div class="bar-row">
    <span>${esc(label)}</span>
    <span class="bar-track"><span class="bar-fill ${bandClass}" style="width:${total ? accuracy : 0}%"></span></span>
    <span class="bar-val">${total ? `${accuracy}% <span class="dim">(${correct}/${total})</span>` : '<span class="dim">—</span>'}</span>
  </div>`;
}

/**
 * Modal dialog. Resolves to true (confirm) or false (cancel/backdrop/Escape).
 */
export function confirmModal({ title, body, confirmText = 'Confirm', cancelText = 'Cancel', danger = false }) {
  return new Promise((resolve) => {
    const root = $('#modal-root');
    const node = el(`<div class="modal-backdrop">
      <div class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <h2>${esc(title)}</h2>
        <div class="muted">${body}</div>
        <div class="modal-actions">
          <button class="btn" data-act="cancel">${esc(cancelText)}</button>
          <button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-act="ok">${esc(confirmText)}</button>
        </div>
      </div>
    </div>`);

    const close = (result) => {
      document.removeEventListener('keydown', onKey);
      node.remove();
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };

    node.addEventListener('click', (e) => {
      if (e.target === node) return close(false);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'ok') close(true);
      if (act === 'cancel') close(false);
    });

    document.addEventListener('keydown', onKey);
    root.appendChild(node);
    node.querySelector('[data-act="ok"]').focus();
  });
}

/** Non-blocking notice injected at the top of the current view. */
export function flash(message, type = 'info') {
  const view = $('#view');
  const existing = $('.flash-notice', view);
  existing?.remove();
  const node = el(`<div class="notice ${type} flash-notice" style="margin-bottom:1rem">${esc(message)}</div>`);
  view.prepend(node);
  setTimeout(() => node.remove(), 6000);
}
