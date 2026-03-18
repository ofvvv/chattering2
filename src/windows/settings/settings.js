'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
   Chattering – Settings Renderer
   Handles: section navigation, reading/writing settings, live preview
   ═══════════════════════════════════════════════════════════════════════════ */

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

let currentSettings = {};
let saveTimeout = null;

// ─── Init ────────────────────────────────────────────────────────────────────
(async function init() {
  currentSettings = await window.chattering.settings.getAll();
  applySettingsToUI(currentSettings);
  setupNavigation();
  setupControls();
  setupWindowButtons();
})();

// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNavigation() {
  $$('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.dataset.section;
      $$('.nav-item').forEach(b => b.classList.remove('active'));
      $$('.settings-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      $(`#sec-${section}`)?.classList.add('active');
    });
  });
}

// ─── Apply settings → UI ──────────────────────────────────────────────────────
function applySettingsToUI(s) {
  // Theme
  document.body.classList.remove('theme-dark', 'theme-light');
  document.body.classList.add(s.theme === 'light' ? 'theme-light' : 'theme-dark');

  // Map each control to its setting key
  $$('[data-key]').forEach(el => {
    const key = el.dataset.key;
    const val = s[key];
    if (val === undefined) return;

    if (el.type === 'checkbox') {
      el.checked = !!val;
    } else if (el.tagName === 'SELECT') {
      el.value = val;
    } else if (el.type === 'range' || el.type === 'number') {
      el.value = val;
      updateRangeLabel(el);
    } else {
      el.value = val;
    }
  });
}

// ─── Control event bindings ────────────────────────────────────────────────────
function setupControls() {
  // All inputs → auto-save with debounce
  $$('[data-key]').forEach(el => {
    const eventType = el.type === 'checkbox' ? 'change' : 'input';
    el.addEventListener(eventType, () => onControlChange(el));
  });

  // Range labels live update
  $$('input[type="range"]').forEach(el => {
    el.addEventListener('input', () => updateRangeLabel(el));
  });

  // Reset button
  $('#btn-reset-settings').addEventListener('click', async () => {
    if (!confirm('¿Restablecer todos los ajustes por defecto?')) return;
    currentSettings = await window.chattering.settings.set({});
    applySettingsToUI(currentSettings);
    showSaved();
  });
}

function onControlChange(el) {
  const key = el.dataset.key;
  let val;

  if (el.type === 'checkbox') val = el.checked;
  else if (el.type === 'range' || el.type === 'number') val = parseFloat(el.value);
  else val = el.value;

  currentSettings[key] = val;

  // Apply theme changes immediately in settings window
  if (key === 'theme') {
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(val === 'light' ? 'theme-light' : 'theme-dark');
  }

  debouncedSave();
}

function debouncedSave() {
  clearTimeout(saveTimeout);
  saveTimeout = setTimeout(async () => {
    await window.chattering.settings.set(currentSettings);
    showSaved();
  }, 400);
}

// ─── Range label updater ──────────────────────────────────────────────────────
function updateRangeLabel(el) {
  const labelMap = {
    fontSize:     'lbl-fontsize',
    maxMessages:  'lbl-max-messages',
    ttsRate:      'lbl-tts-rate',
    ttsVolume:    'lbl-tts-volume',
    ttsPitch:     'lbl-tts-pitch'
  };
  const labelId = labelMap[el.dataset.key];
  if (labelId) {
    const lbl = $(`#${labelId}`);
    if (lbl) lbl.textContent = el.value;
  }
}

// ─── Saved indicator ──────────────────────────────────────────────────────────
function showSaved() {
  const indicator = $('#settings-saved-indicator');
  indicator.textContent = '✔ Guardado';
  indicator.classList.add('show');
  setTimeout(() => indicator.classList.remove('show'), 1800);
}

// ─── Window buttons ───────────────────────────────────────────────────────────
function setupWindowButtons() {
  $('#btn-close-settings').addEventListener('click', () => {
    window.chattering.window.close();
  });
}
