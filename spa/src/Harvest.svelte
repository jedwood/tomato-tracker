<script>
  import { listVarieties, submitHarvest } from './lib/api.js';

  // ── Form state ────────────────────────────────────────────────────────
  // The last row is always a "fresh" empty row; as soon as the user types
  // a variety + quantity into it, we append a new fresh row underneath.
  let harvester = $state('');
  let entries = $state([blankEntry()]);
  let openSuggestionsFor = $state(-1);

  let varieties = $state([]);
  let varietiesError = $state(null);
  let isSubmitting = $state(false);
  let toast = $state(null);

  function blankEntry() { return { variety: '', quantity: '' }; }

  // Fetch the variety list once on boot. If listVarieties returns [] (sheet
  // not yet seeded), the autocomplete is just a free-text field — that's fine.
  $effect(() => {
    listVarieties()
      .then((rows) => {
        varieties = rows
          .map((r) => r.Variety)
          .filter(Boolean)
          .sort((a, b) => a.localeCompare(b));
      })
      .catch((err) => { varietiesError = err.message || String(err); });
  });

  function suggestionsFor(text) {
    const q = String(text || '').trim().toLowerCase();
    if (!q) return varieties.slice(0, 12);
    return varieties.filter((v) => v.toLowerCase().includes(q)).slice(0, 12);
  }

  function maybeAppendRow() {
    const last = entries[entries.length - 1];
    if (last && last.variety.trim() && Number(last.quantity) > 0) {
      entries = [...entries, blankEntry()];
    }
  }

  function selectVariety(idx, value) {
    entries[idx].variety = value;
    openSuggestionsFor = -1;
    maybeAppendRow();
    // Move focus to the matching quantity input.
    queueMicrotask(() => {
      const inputs = document.querySelectorAll(`input[data-qty="${idx}"]`);
      if (inputs[0]) inputs[0].focus();
    });
  }

  function removeRow(idx) {
    entries = entries.filter((_, i) => i !== idx);
    if (entries.length === 0) entries = [blankEntry()];
  }

  async function submit() {
    const validEntries = entries.filter(
      (e) => e.variety.trim() !== '' && Number(e.quantity) > 0
    );
    if (!harvester || !validEntries.length) {
      toast = { kind: 'err', text: 'Pick a harvester and enter at least one variety + quantity.' };
      return;
    }
    isSubmitting = true;
    toast = null;
    try {
      const payload = {
        harvester,
        entries: validEntries.map((e) => ({ variety: e.variety.trim(), quantity: Number(e.quantity) }))
      };
      const result = await submitHarvest(payload);
      toast = { kind: 'ok', text: `Saved — ${result.rowsAdded} ${result.rowsAdded === 1 ? 'row' : 'rows'} added.` };
      harvester = '';
      entries = [blankEntry()];
      openSuggestionsFor = -1;
    } catch (err) {
      toast = { kind: 'err', text: err.message || String(err) };
    } finally {
      isSubmitting = false;
    }
  }

  $effect(() => {
    if (!toast) return;
    const t = setTimeout(() => { toast = null; }, toast.kind === 'ok' ? 4000 : 6000);
    return () => clearTimeout(t);
  });
</script>

<main>
  <div class="card">
    <div class="hdr">
      <div class="badge">🍅</div>
      <h1>Harvest tracker</h1>
      <p class="sub">2026 season</p>
    </div>

    <div class="harvester">
      <span class="lbl">Who's harvesting?</span>
      <div class="harvester__opts">
        {#each ['Jed', 'Ryan'] as name}
          <label class="opt" class:opt--on={harvester === name}>
            <input type="radio" name="harvester" value={name} bind:group={harvester} />
            <span class="opt__name">{name}</span>
          </label>
        {/each}
      </div>
    </div>

    <div class="divider"></div>

    <div class="entries">
      {#each entries as entry, idx (idx)}
        <div class="row" class:row--filled={idx < entries.length - 1}>
          <div class="row__variety">
            <label class="lbl" for="v{idx}">Variety</label>
            <input
              id="v{idx}"
              class="input"
              type="text"
              autocomplete="off"
              placeholder="Start typing…"
              bind:value={entry.variety}
              oninput={() => { openSuggestionsFor = idx; }}
              onfocus={() => { openSuggestionsFor = idx; }}
              onblur={() => setTimeout(() => { if (openSuggestionsFor === idx) openSuggestionsFor = -1; }, 200)}
            />
            {#if openSuggestionsFor === idx && suggestionsFor(entry.variety).length > 0}
              <div class="suggestions">
                {#each suggestionsFor(entry.variety) as sug}
                  <button type="button" class="suggestions__item" onmousedown={() => selectVariety(idx, sug)}>{sug}</button>
                {/each}
              </div>
            {/if}
          </div>
          <div class="row__qty">
            <label class="lbl" for="q{idx}">Qty</label>
            <input
              id="q{idx}"
              class="input"
              type="number"
              inputmode="numeric"
              min="1"
              data-qty={idx}
              placeholder="#"
              bind:value={entry.quantity}
              oninput={maybeAppendRow}
            />
          </div>
          {#if idx < entries.length - 1}
            <button type="button" class="row__remove" aria-label="Remove row" onclick={() => removeRow(idx)}>×</button>
          {/if}
        </div>
      {/each}
    </div>

    <button class="submit" type="button" onclick={submit} disabled={isSubmitting}>
      {#if isSubmitting}
        Saving…
      {:else}
        Save harvest
      {/if}
    </button>

    {#if varietiesError}
      <div class="hint hint--err">Couldn't load variety list: {varietiesError}</div>
    {/if}
  </div>

  <p class="footer">For the 2026 tomato growing season 🍅</p>

  {#if toast}
    <div class="toast" class:toast--ok={toast.kind === 'ok'} class:toast--err={toast.kind === 'err'}>
      {toast.text}
    </div>
  {/if}
</main>

<style>
  main {
    max-width: 640px;
    margin: 0 auto;
    padding: 32px 16px 96px;
  }
  .card {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    padding: 28px 24px;
  }
  .hdr { text-align: center; margin-bottom: 20px; }
  .badge {
    width: 56px; height: 56px; margin: 0 auto 12px;
    background: linear-gradient(135deg, var(--primary-from), var(--primary-to));
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px;
  }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { margin: 4px 0 0; color: var(--text-subtle); font-size: 14px; }

  .lbl {
    display: block;
    font-size: 12.5px;
    color: var(--text-muted);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: 6px;
  }

  .harvester { margin-top: 20px; }
  .harvester__opts {
    display: flex;
    justify-content: center;
    gap: 12px;
    margin-top: 8px;
  }
  .opt {
    flex: 1; max-width: 160px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px 12px;
    text-align: center;
    cursor: pointer;
    transition: border-color 0.15s, background 0.15s;
    background: var(--surface);
  }
  .opt input { display: none; }
  .opt__name { font-weight: 500; color: var(--text-muted); }
  .opt--on {
    border-color: var(--primary-from);
    background: var(--primary-tint);
  }
  .opt--on .opt__name {
    color: var(--primary-from);
    font-weight: 600;
  }

  .divider {
    height: 1px;
    background: var(--border);
    margin: 24px 0 20px;
  }

  .entries { display: flex; flex-direction: column; gap: 14px; }
  .row {
    display: grid;
    grid-template-columns: 1fr 96px auto;
    gap: 10px;
    align-items: end;
    padding: 4px;
    border-radius: var(--radius-sm);
    position: relative;
  }
  .row--filled { background: rgba(255, 153, 102, 0.07); padding: 10px; }
  .row__variety { position: relative; min-width: 0; }
  .input {
    width: 100%;
    padding: 12px 14px;
    font-size: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: inherit;
  }
  .input:focus {
    outline: none;
    border-color: var(--primary-to);
    box-shadow: 0 0 0 3px rgba(255, 153, 102, 0.2);
  }
  .row__remove {
    width: 36px; height: 36px;
    border: none;
    background: rgba(255, 94, 98, 0.1);
    color: var(--primary-from);
    border-radius: 50%;
    font-size: 22px; line-height: 1;
    cursor: pointer;
    margin-bottom: 4px;
  }
  .row__remove:hover { background: rgba(255, 94, 98, 0.2); }

  .suggestions {
    position: absolute;
    top: 100%; left: 0; right: 0;
    margin-top: 4px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    max-height: 220px;
    overflow-y: auto;
    z-index: 10;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  }
  .suggestions__item {
    display: block;
    width: 100%;
    text-align: left;
    padding: 10px 14px;
    cursor: pointer;
    font-size: 15px;
    background: transparent;
    color: var(--text);
    border: none;
    border-bottom: 1px solid var(--border);
    font-family: inherit;
  }
  .suggestions__item:last-child { border-bottom: none; }
  .suggestions__item:hover { background: var(--primary-tint); }

  .submit {
    margin-top: 20px;
    width: 100%;
    padding: 14px 18px;
    font-size: 16px;
    font-weight: 600;
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    background: linear-gradient(135deg, var(--primary-from), var(--primary-to));
    box-shadow: 0 4px 6px -1px rgba(255, 94, 98, 0.2), 0 2px 4px -1px rgba(255, 153, 102, 0.1);
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s;
    font-family: inherit;
  }
  .submit:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 10px 15px -3px rgba(255, 94, 98, 0.3), 0 4px 6px -2px rgba(255, 153, 102, 0.2);
  }
  .submit:disabled { opacity: 0.7; cursor: progress; }

  .hint { font-size: 13px; margin-top: 12px; color: var(--text-subtle); }
  .hint--err { color: #b3261e; }

  .footer {
    text-align: center;
    color: var(--text-subtle);
    font-size: 13px;
    margin-top: 18px;
  }

  .toast {
    position: fixed;
    bottom: 16px; right: 16px;
    padding: 14px 18px;
    border-radius: 12px;
    font-size: 14px; font-weight: 500;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
    max-width: 360px;
  }
  .toast--ok { background: #f0fff4; color: #1f7a1f; border-left: 4px solid #48bb78; }
  .toast--err { background: #fff5f5; color: #9b2c2c; border-left: 4px solid #f56565; }
</style>
