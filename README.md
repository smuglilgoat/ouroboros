# ouroboros

Chrome extension + local companion that captures YouTube transcripts / page text
into a GitHub-hosted Obsidian wiki, ingested by `opencode` per the wiki's
AGENTS.md rules. See [PLAN.md](PLAN.md).

## Usage

**Extension** — `chrome://extensions` → Developer mode → "Load unpacked" →
select `extension/`. Open the popup → Settings: fill repo (`owner/repo`), PAT
(fine-grained, Contents read/write on that repo only), optional branch. Then:
popup button, or right-click → "Send to wiki".

**Companion** — runs the `opencode` ingest + git commit/push from a local wiki
clone:

```sh
cp companion/companion.config.example.json companion/companion.config.json
# edit: wikiDir (local clone), model (e.g. "google/gemini-2.5-pro"), port, branch
node companion/companion.mjs
```

**Tests** — `node test/parse.test.mjs && node test/companion.test.mjs`
