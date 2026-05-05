# tomato-tracker

Tracks tomato harvests, seedling inventory, and seedling claims for Jed's garden. Backs the Tomato Tracker Google Sheet with an Apps Script web app and two web forms (harvest log + seedling claim).

For full architecture, deploy steps, and the GAS API contract, read **`CLAUDE.md`**. That file is the load-bearing context for any Claude Code session opened here.

## Quick links

- Sheet: <https://docs.google.com/spreadsheets/d/1Fukctm2sh8TekisGromdCbFpKYeGzOVq1aIyG8NbdZE/edit>
- Sister agent (knowledge / curation): `/Volumes/OLAF EXT/jedwoodx/repos/jedOS/.claude/agents/craig/`
- Pattern reference (GAS): `.claude/agents/sam-bot/scripts/ward-sheets/` in jedOS

## Layout

```
gas/        Apps Script project (clasp; ward-sheets pattern)
spa/        Vite + Svelte forms — /harvest and /claim
scripts/    CLI helpers (Python via .venv/bin/python3)
archive/    Original 2024 single-page form, preserved for reference
demos/      Showboat verification demos
```

## Status

Modernization in progress (May 2026). Replacing the 2024 standalone form with:
- ward-sheets-style GAS web app (token-scoped identities, atomic claim submission)
- Vite + Svelte SPA on Firebase Hosting
- Real-time inventory polling on the claim form
- Public Drive folder for seedling photos
