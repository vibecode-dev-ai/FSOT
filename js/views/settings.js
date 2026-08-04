// Settings: session sizes, question generation, data export/import.

import { SECTIONS, SECTION_ORDER } from '../config.js';
import { bankCounts, invalidate, loadBank } from '../bank.js';
import {
  addGenerated,
  clearGenerated,
  exportAll,
  getApiKey,
  getSettings,
  importAll,
  saveApiKey,
  saveSettings,
} from '../storage.js';
import { generateQuestions, GENERATOR_MODELS } from '../generator.js';
import { confirmModal, esc, flash, on, setView } from '../ui.js';

export async function renderSettings(navigate) {
  await loadBank();
  const settings = getSettings();
  const counts = bankCounts();
  const apiKey = getApiKey();

  const bankRows = SECTION_ORDER.map((id) => {
    const c = counts[id];
    return `<tr>
      <td>${esc(SECTIONS[id].name)}</td>
      <td class="num">${c.bundled}</td>
      <td class="num">${c.generated}</td>
      <td class="num"><strong>${c.total}</strong></td>
      <td class="num ${c.total < c.needed ? '' : 'dim'}">${c.needed}</td>
    </tr>`;
  }).join('');

  setView(`
    <h1>Settings</h1>

    <div class="card">
      <h3>Session length</h3>
      <p class="tiny dim">Full timed exams always use the official counts (60 / 65 / 30). These control the practice modes.</p>
      <label class="field">
        <span>Practice — All Sections</span>
        <input type="number" min="3" max="155" id="practiceAllCount" value="${settings.practiceAllCount}">
      </label>
      <label class="field">
        <span>Practice — Single Section</span>
        <input type="number" min="3" max="65" id="practiceSectionCount" value="${settings.practiceSectionCount}">
      </label>
      <label class="field">
        <span>Weak-Area Drill</span>
        <input type="number" min="3" max="65" id="drillCount" value="${settings.drillCount}">
      </label>
      <label class="row" style="gap:.5rem">
        <input type="checkbox" id="shuffleChoices" ${settings.shuffleChoices ? 'checked' : ''} style="width:auto">
        <span class="small">Shuffle answer choices (prevents memorizing answer positions)</span>
      </label>
      <label class="row" style="gap:.5rem;margin-top:.5rem">
        <input type="checkbox" id="keyboardShortcuts" ${settings.keyboardShortcuts ? 'checked' : ''} style="width:auto">
        <span class="small">Keyboard shortcuts during a test</span>
      </label>
      <button class="btn btn-primary mt" data-act="save-settings">Save</button>
    </div>

    <div class="card mt">
      <h3>Question bank</h3>
      <table class="history">
        <thead><tr>
          <th>Section</th>
          <th style="text-align:right">Bundled</th>
          <th style="text-align:right">Generated</th>
          <th style="text-align:right">Total</th>
          <th style="text-align:right">Full length</th>
        </tr></thead>
        <tbody>${bankRows}</tbody>
      </table>
      ${counts && Object.values(counts).some((c) => c.generated > 0)
        ? `<button class="btn btn-sm btn-danger mt" data-act="clear-generated">Delete generated questions</button>`
        : ''}
    </div>

    <div class="card mt">
      <h3>Generate more questions</h3>
      <p class="small muted">
        Optional. With an Anthropic API key the app can write new questions in the same
        format and add them to your bank. Everything already in the app works offline
        without this.
      </p>
      <div class="notice" style="margin-bottom:1rem">
        Your key is stored in this browser's localStorage on this machine and is sent only to
        <span class="mono">api.anthropic.com</span>. Anyone with access to this computer's browser
        profile can read it. Use a key you are willing to rotate.
      </div>

      <label class="field">
        <span>Anthropic API key</span>
        <input type="password" id="apiKey" placeholder="sk-ant-..." value="${esc(apiKey)}" autocomplete="off">
      </label>
      <label class="field">
        <span>Model</span>
        <select id="generatorModel">
          ${GENERATOR_MODELS.map((m) => `<option value="${esc(m.id)}" ${m.id === settings.generatorModel ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}
        </select>
      </label>
      <button class="btn btn-sm" data-act="save-key">Save key</button>

      <hr class="divider">

      <label class="field">
        <span>Section</span>
        <select id="genSection">
          ${SECTION_ORDER.map((id) => `<option value="${id}">${esc(SECTIONS[id].name)}</option>`).join('')}
        </select>
      </label>
      <label class="field">
        <span>How many questions</span>
        <select id="genCount">
          <option value="5">5</option>
          <option value="10" selected>10</option>
          <option value="20">20</option>
          <option value="30">30</option>
        </select>
      </label>
      <button class="btn btn-primary" data-act="generate" ${apiKey ? '' : 'disabled'}>
        Generate
      </button>
      ${apiKey ? '' : '<p class="tiny dim mt">Save an API key to enable generation.</p>'}
      <div id="gen-status" class="mt"></div>
    </div>

    <div class="card mt">
      <h3>Your data</h3>
      <p class="small muted">Everything is stored locally in this browser. Nothing is uploaded.</p>
      <div class="row">
        <button class="btn btn-sm" data-act="export">Export backup</button>
        <button class="btn btn-sm" data-act="import">Import backup</button>
        <input type="file" id="import-file" accept="application/json" hidden>
      </div>
      <p class="tiny dim mt">Backups include your history, settings, and generated questions. Your API key is never exported.</p>
    </div>
  `);

  const view = document.getElementById('view');

  on(view, '[data-act="save-settings"]', 'click', () => {
    const num = (id, min, max, fallback) => {
      const v = Number(document.getElementById(id).value);
      return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : fallback;
    };
    saveSettings({
      practiceAllCount: num('practiceAllCount', 3, 155, settings.practiceAllCount),
      practiceSectionCount: num('practiceSectionCount', 3, 65, settings.practiceSectionCount),
      drillCount: num('drillCount', 3, 65, settings.drillCount),
      shuffleChoices: document.getElementById('shuffleChoices').checked,
      keyboardShortcuts: document.getElementById('keyboardShortcuts').checked,
    });
    flash('Settings saved.', 'info');
  });

  on(view, '[data-act="save-key"]', 'click', () => {
    saveApiKey(document.getElementById('apiKey').value.trim());
    saveSettings({ generatorModel: document.getElementById('generatorModel').value });
    flash('API key saved.', 'info');
    renderSettings(navigate);
  });

  on(view, '[data-act="generate"]', 'click', async (e, btn) => {
    const sectionId = document.getElementById('genSection').value;
    const count = Number(document.getElementById('genCount').value);
    const status = document.getElementById('gen-status');

    btn.disabled = true;
    status.innerHTML = `<div class="row small muted"><span class="spinner"></span>
      Generating ${count} ${esc(SECTIONS[sectionId].name)} questions… this usually takes 20–60 seconds.</div>`;

    try {
      const questions = await generateQuestions({
        sectionId,
        count,
        onProgress: ({ done, total }) => {
          status.innerHTML = `<div class="row small muted"><span class="spinner"></span>
            Generated ${done} of ${total} ${esc(SECTIONS[sectionId].name)} questions…</div>`;
        },
      });
      const added = addGenerated(questions);
      invalidate();
      await loadBank({ force: true });
      status.innerHTML = `<div class="notice info">Added ${added.length} new question${added.length === 1 ? '' : 's'}${
        added.length < questions.length ? ` (${questions.length - added.length} were duplicates and skipped)` : ''
      }.</div>`;
      setTimeout(() => renderSettings(navigate), 1500);
    } catch (err) {
      status.innerHTML = `<div class="notice error">${esc(err.message)}</div>`;
      btn.disabled = false;
    }
  });

  on(view, '[data-act="clear-generated"]', 'click', async () => {
    const ok = await confirmModal({
      title: 'Delete generated questions?',
      body: '<p>This removes every AI-generated question from your bank. The bundled questions are not affected.</p>',
      confirmText: 'Delete',
      danger: true,
    });
    if (!ok) return;
    clearGenerated();
    invalidate();
    await loadBank({ force: true });
    renderSettings(navigate);
  });

  on(view, '[data-act="export"]', 'click', () => {
    const blob = new Blob([JSON.stringify(exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `fsot-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  on(view, '[data-act="import"]', 'click', () => {
    document.getElementById('import-file').click();
  });

  document.getElementById('import-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      importAll(JSON.parse(await file.text()));
      invalidate();
      await loadBank({ force: true });
      flash('Backup imported.', 'info');
      renderSettings(navigate);
    } catch (err) {
      flash(`Import failed: ${err.message}`, 'error');
    }
  });
}
