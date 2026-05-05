<script>
  import { getInventory, submitClaim } from './lib/api.js';

  // ── State ─────────────────────────────────────────────────────────────
  let inventory = $state([]);          // [{variety, available, photoUrl, description, type, color}]
  let loadError = $state(null);
  let lastFetched = $state(null);
  let booted = $state(false);

  let name = $state('');
  // claims: variety → quantity (only entries > 0 are submitted)
  let claims = $state({});
  let conflictHighlights = $state(new Set());

  let isSubmitting = $state(false);
  let submitMessage = $state(null);    // {kind: 'ok'|'err', text: string}
  let claimedSummary = $state(null);   // shown after a successful claim

  // ── Inventory polling ─────────────────────────────────────────────────
  // Refetch every 150s while the page is visible, plus immediately on
  // visibilitychange→visible. The atomic STOCK_CHANGED on submit covers
  // races between polls.
  const POLL_INTERVAL_MS = 150_000;

  async function refreshInventory() {
    try {
      const rows = await getInventory();
      // Stable order: alphabetical by variety so re-renders don't shuffle.
      const sorted = [...rows].sort((a, b) => a.variety.localeCompare(b.variety));
      inventory = sorted;
      loadError = null;
      lastFetched = new Date();
      // Drop claim entries for varieties that are now out of stock.
      const inStock = new Set(sorted.map(r => r.variety));
      const next = {};
      for (const [v, q] of Object.entries(claims)) {
        if (inStock.has(v)) next[v] = q;
      }
      claims = next;
    } catch (err) {
      loadError = err.message || String(err);
    }
  }

  $effect(() => {
    if (booted) return;
    booted = true;
    refreshInventory();
    const interval = setInterval(refreshInventory, POLL_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshInventory();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });

  // ── Quantity controls ────────────────────────────────────────────────
  function setQty(variety, qty, available) {
    const clamped = Math.max(0, Math.min(qty, available));
    if (clamped === 0) {
      const next = { ...claims };
      delete next[variety];
      claims = next;
    } else {
      claims = { ...claims, [variety]: clamped };
    }
    // Clear conflict highlight on this variety once user has reacted.
    if (conflictHighlights.has(variety)) {
      const next = new Set(conflictHighlights);
      next.delete(variety);
      conflictHighlights = next;
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────
  const totalCount = $derived(Object.values(claims).reduce((s, n) => s + Number(n || 0), 0));

  async function submit() {
    submitMessage = null;
    if (!name.trim()) {
      submitMessage = { kind: 'err', text: 'Please enter your name.' };
      return;
    }
    const entries = Object.entries(claims)
      .filter(([, q]) => Number(q) > 0)
      .map(([variety, q]) => ({ variety, quantity: Number(q) }));
    if (!entries.length) {
      submitMessage = { kind: 'err', text: 'Pick at least one tomato.' };
      return;
    }
    isSubmitting = true;
    try {
      const result = await submitClaim({ name: name.trim(), entries });
      claimedSummary = { name: name.trim(), entries, claimId: result.claimId };
      claims = {};
      name = '';
      submitMessage = null;
      // Refresh in the background so subsequent landings reflect the new
      // availability.
      refreshInventory();
    } catch (err) {
      if (err.code === 'STOCK_CHANGED') {
        // Server returned current counts in err message JSON. We don't have
        // structured access here, so just refresh and highlight the rows
        // the user picked that may have conflicted.
        const picked = new Set(entries.map(e => e.variety));
        conflictHighlights = picked;
        await refreshInventory();
        submitMessage = {
          kind: 'err',
          text: 'Some of your picks ran out while you were deciding. The list has been updated — please review and resubmit.'
        };
      } else {
        submitMessage = { kind: 'err', text: err.message || String(err) };
      }
    } finally {
      isSubmitting = false;
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────
  function relTime(d) {
    if (!d) return '';
    const s = Math.round((Date.now() - d.getTime()) / 1000);
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    return Math.round(m / 60) + 'h ago';
  }
  let nowTick = $state(Date.now());
  $effect(() => {
    const id = setInterval(() => { nowTick = Date.now(); }, 30_000);
    return () => clearInterval(id);
  });
  // Force relTime to recompute by referencing nowTick.
  const lastFetchedLabel = $derived(lastFetched ? (nowTick && relTime(lastFetched)) : '');
</script>

<main>
  <header class="hdr">
    <div class="badge">🍅</div>
    <h1>Tomato seedling pickup</h1>
    <p class="sub">Pick what you'd like — Jed will reach out about pickup.</p>
  </header>

  {#if claimedSummary}
    <div class="card success">
      <div class="success__hd">All set, {claimedSummary.name}!</div>
      <div class="success__body">
        <p>Reserved for you:</p>
        <ul>
          {#each claimedSummary.entries as e}
            <li><strong>{e.quantity}</strong> × {e.variety}</li>
          {/each}
        </ul>
        <p class="success__footer">Jed has your reservation and will text you about pickup. Thanks!</p>
        <button class="btn-secondary" type="button" onclick={() => { claimedSummary = null; }}>Reserve more</button>
      </div>
    </div>
  {:else}
    {#if loadError && inventory.length === 0}
      <div class="card error">
        <div class="error__hd">Couldn't load the list.</div>
        <div class="error__body">{loadError}</div>
      </div>
    {:else if !lastFetched}
      <div class="card">
        <div class="loading">Loading available varieties…</div>
      </div>
    {:else if inventory.length === 0}
      <div class="card">
        <div class="empty">No seedlings available right now. Check back later — Jed updates this list as transplants are ready.</div>
      </div>
    {:else}
      <div class="grid">
        {#each inventory as v (v.variety)}
          {@const qty = claims[v.variety] || 0}
          <div class="card variety" class:variety--conflict={conflictHighlights.has(v.variety)}>
            {#if v.photoUrl && v.photoUrl !== 'n/a'}
              <img class="variety__photo" src={v.photoUrl} alt={v.variety} loading="lazy" />
            {:else}
              <div class="variety__photo variety__photo--placeholder">🍅</div>
            {/if}
            <div class="variety__body">
              <h3 class="variety__name">{v.variety}</h3>
              {#if v.type || v.color}
                <p class="variety__meta">
                  {[v.type, v.color].filter(Boolean).join(' · ')}
                </p>
              {/if}
              {#if v.description}
                <p class="variety__desc">{v.description}</p>
              {/if}
              <div class="variety__stepper">
                <span class="variety__avail">{v.available} available</span>
                <div class="stepper">
                  <button type="button" class="stepper__btn" aria-label="Decrease"
                          onclick={() => setQty(v.variety, qty - 1, v.available)}
                          disabled={qty <= 0}>−</button>
                  <span class="stepper__qty" aria-live="polite">{qty}</span>
                  <button type="button" class="stepper__btn" aria-label="Increase"
                          onclick={() => setQty(v.variety, qty + 1, v.available)}
                          disabled={qty >= v.available}>+</button>
                </div>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}

  {#if lastFetchedLabel && !claimedSummary}
    <p class="footer-meta">Inventory refreshed {lastFetchedLabel}.</p>
  {/if}
</main>

{#if !claimedSummary && totalCount > 0}
  <div class="bar">
    <input class="input bar__name" type="text" placeholder="Your name" bind:value={name} />
    <button class="btn-primary" type="button" onclick={submit} disabled={isSubmitting}>
      {isSubmitting ? 'Reserving…' : `Reserve ${totalCount} ${totalCount === 1 ? 'tomato' : 'tomatoes'}`}
    </button>
  </div>
{/if}

{#if submitMessage}
  <div class="toast" class:toast--ok={submitMessage.kind === 'ok'} class:toast--err={submitMessage.kind === 'err'}>
    {submitMessage.text}
  </div>
{/if}

<style>
  main {
    max-width: 860px;
    margin: 0 auto;
    padding: 24px 16px 140px;
  }
  .hdr {
    text-align: center;
    margin-bottom: 20px;
  }
  .badge {
    width: 56px; height: 56px; margin: 0 auto 12px;
    background: linear-gradient(135deg, var(--primary-from), var(--primary-to));
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px;
  }
  h1 { margin: 0; font-size: 22px; font-weight: 600; letter-spacing: -0.01em; }
  .sub { margin: 4px 0 0; color: var(--text-subtle); font-size: 14px; }

  .card {
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    overflow: hidden;
  }
  .card.success { padding: 24px; text-align: center; }
  .success__hd { font-size: 20px; font-weight: 600; margin-bottom: 12px; }
  .success__body p { margin: 8px 0; color: var(--text-muted); }
  .success__body ul { list-style: none; padding: 0; margin: 12px 0 16px; }
  .success__body li { padding: 6px 0; }
  .success__footer { font-size: 14px; color: var(--text-subtle); }
  .btn-secondary {
    margin-top: 8px;
    padding: 10px 18px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text-muted);
    font-family: inherit;
    font-weight: 500;
    cursor: pointer;
  }

  .card.error { padding: 24px; }
  .error__hd { font-weight: 600; color: #b3261e; margin-bottom: 6px; }
  .error__body { color: var(--text-muted); font-size: 14px; word-break: break-word; }
  .loading { padding: 32px; text-align: center; color: var(--text-subtle); }
  .empty {
    padding: 32px 24px;
    text-align: center;
    color: var(--text-muted);
    font-size: 15px;
    line-height: 1.5;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 16px;
  }
  .variety {
    display: flex;
    flex-direction: column;
    transition: box-shadow 0.2s, transform 0.2s, outline 0.15s;
  }
  .variety:hover {
    transform: translateY(-2px);
    box-shadow: 0 25px 30px -8px rgba(0, 0, 0, 0.12);
  }
  .variety--conflict {
    outline: 3px solid #f6ad55;
    outline-offset: -3px;
  }

  .variety__photo {
    aspect-ratio: 4 / 3;
    width: 100%;
    object-fit: cover;
    display: block;
    background: #f7fafc;
  }
  .variety__photo--placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 64px;
    color: var(--text-subtle);
  }

  .variety__body {
    padding: 14px 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }
  .variety__name {
    margin: 0;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .variety__meta {
    margin: 0;
    font-size: 12.5px;
    color: var(--text-subtle);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .variety__desc {
    margin: 0;
    font-size: 13.5px;
    color: var(--text-muted);
    line-height: 1.5;
    /* Clamp to 4 lines so cards stay roughly even. */
    display: -webkit-box;
    -webkit-line-clamp: 4;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .variety__stepper {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: auto;
    padding-top: 8px;
    border-top: 1px solid var(--border);
    gap: 8px;
  }
  .variety__avail {
    font-size: 13px;
    color: var(--text-muted);
  }
  .stepper {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--primary-tint);
    border-radius: 999px;
    padding: 4px;
  }
  .stepper__btn {
    width: 32px; height: 32px;
    border-radius: 50%;
    border: none;
    background: var(--surface);
    color: var(--primary-from);
    font-size: 18px;
    font-weight: 600;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  .stepper__btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .stepper__qty {
    min-width: 24px;
    text-align: center;
    font-weight: 600;
    color: var(--primary-from);
    font-size: 15px;
  }

  .footer-meta {
    margin-top: 20px;
    text-align: center;
    color: var(--text-subtle);
    font-size: 12px;
  }

  /* ── Sticky reservation bar ───────────────────────────────────────── */
  .bar {
    position: fixed;
    left: 0; right: 0; bottom: 0;
    padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
    background: rgba(255, 255, 255, 0.96);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border-top: 1px solid var(--border);
    display: flex;
    gap: 10px;
    align-items: center;
  }
  .bar__name {
    flex: 1;
    min-width: 0;
  }
  .input {
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
  .btn-primary {
    flex: 0 0 auto;
    padding: 14px 22px;
    font-size: 16px;
    font-weight: 600;
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    background: linear-gradient(135deg, var(--primary-from), var(--primary-to));
    box-shadow: 0 4px 6px -1px rgba(255, 94, 98, 0.2), 0 2px 4px -1px rgba(255, 153, 102, 0.1);
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
  }
  .btn-primary:disabled { opacity: 0.7; cursor: progress; }

  .toast {
    position: fixed;
    /* Sit just above the sticky reserve bar so it doesn't get hidden. */
    bottom: calc(76px + env(safe-area-inset-bottom));
    left: 16px; right: 16px;
    padding: 14px 18px;
    border-radius: 12px;
    font-size: 14px; font-weight: 500;
    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
    text-align: center;
    margin: 0 auto;
    max-width: 600px;
  }
  .toast--ok { background: #f0fff4; color: #1f7a1f; border-left: 4px solid #48bb78; }
  .toast--err { background: #fff5f5; color: #9b2c2c; border-left: 4px solid #f56565; }
</style>
