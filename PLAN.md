# Wiki Ingest — Chrome Extension + Local Companion

Capture transcripts (YouTube videos / web page selection) from Chrome, push to a
GitHub-hosted Obsidian wiki, and have `opencode` CLI ingest them into notes
following the wiki's own rules file.

## Architecture

```
[Chrome tab] --capture--> [background SW] --POST--> [companion.mjs @localhost:7781]
                                             |            |
                                   companion offline   git pull
                                             |            |
                                             v            run: opencode run --model $MODEL "ingest ..."
                                  GitHub REST API         write inbox/*.md
                                  (PAT, raw transcript    git add/commit/push
                                   to inbox/, fallback)
```

Three components:

1. **Chrome extension (MV3, plain JS, no build step)** — capture + push.
2. **Local companion (`companion.mjs`, ~150 lines, Node stdlib only)** — runs
   `opencode`, does the git commit/push from a local wiki clone.
3. **Wiki repo conventions** — `inbox/` for raw captures, `AGENTS.md` holds the
   agent wiki rules (opencode reads `AGENTS.md` automatically from repo root).

## Component 1: Chrome extension (`extension/`)

- `manifest.json` — MV3. Permissions: `activeTab`, `scripting`, `storage`,
  `contextMenus`. Host permissions: `https://api.github.com/*`,
  `http://localhost:7781/*`.
- **Capture (content script, injected on demand via chrome.scripting):**
  - YouTube: read `window.ytInitialPlayerResponse.captions.playerCaptionsTracklistRenderer.captionTracks[0].baseUrl`,
    `fetch(baseUrl + '&fmt=json3')` (same-origin, works in content script),
    parse json3 events → plain transcript text. No captions → return error to popup.
  - HTML page: `window.getSelection().toString()`, fallback `document.body.innerText`.
    Send back with `{url, title, source}` metadata.
- **Push (background service worker):**
  1. Try `POST http://localhost:7781/ingest` with JSON `{url, title, transcript, source, capturedAt}`.
  2. If companion unreachable → fallback: `PUT /repos/{owner}/{repo}/contents/inbox/<date>-<slug>.md`
     via GitHub REST API with the fine-grained PAT (from `chrome.storage.local`),
     message `capture: <title>` so the companion ingests it on its next pull.
  3. Return status; popup shows success / error.
- **UI:**
  - Popup: one button per mode (YouTube transcript / page capture), status line,
    settings link.
  - Context menu: "Send to wiki" on selection.
  - Options page: PAT, repo (`owner/repo`), rules file path (default `AGENTS.md`),
    inbox folder (default `inbox/`), companion URL. All settings, nothing hardcoded.

## Component 2: Local companion (`companion.mjs`)

- Node stdlib only (`http`, `child_process`). Single file.
- `companion.config.json`: `{ "wikiDir": "~/wiki", "model": "provider/model", "port": 7781, "branch": "main" }`
- `POST /ingest` flow:
  1. `git pull --ff-only` in the wiki clone (or first-run `git clone`).
  2. Write `inbox/<date>-<slug>.md` with YAML frontmatter: `source`, `url`,
     `captured`, `status: unprocessed`, plus the raw transcript body.
  3. Run `opencode run --model $MODEL "<ingest instruction>"` with cwd = wiki
     dir. Instruction: "Inbox file X contains a new capture. Read AGENTS.md and
     ingest it into the wiki per the rules: create/update notes, link
     appropriately, then mark the inbox file `status: processed`."
     (opencode loads `AGENTS.md` as project context automatically.)
  4. `git add -A && git commit -m "ingest: <title>" && git push`.
  5. Respond `{ok, summary}` (opencode's stdout tail) so the popup can show it.
- Runs via `node companion.mjs` — user starts it when they want ingestion.

## Component 3: Wiki repo conventions

- `AGENTS.md` at repo root — the authoritative "agent wiki rules". Already
  exists in the wiki repo; extension option points to it; the companion's
  ingest instruction references it. Ingest quality = quality of this file.
- `inbox/` — raw captures land here (extension fallback or companion). Files
  carry `status:` frontmatter so unprocessed ones are identifiable.

## File tree

```
ouroboros/
  PLAN.md
  extension/
    manifest.json
    background.js
    popup.html / popup.js
    options.html / options.js
    capture.js            (content script logic, injected programmatically)
  companion/
    companion.mjs
    companion.config.json (gitignored — local paths)
    companion.config.example.json
  test/
    parse.test.mjs        (json3/xml transcript parser self-check)
    companion.test.mjs    (start companion, POST fake ingest against a temp git repo, assert file + commit)
```

## Build order

1. `extension/` capture + push (testable alone: capture YouTube transcript,
   check fallback GitHub PUT lands a file in `inbox/`).
2. `companion.mjs` + config (test with `curl -d @sample.json localhost:7781/ingest`).
3. Wire popup/context menu polish + status surfacing.
4. Verify end-to-end on a real video: capture → push → companion ingests →
   `git push` shows the note following AGENTS.md rules.

## Known risks / ceilings

- **YouTube captions**: baseUrl extraction breaks if YouTube changes player
  response shape; live streams and some videos have no captions → popup shows a
  clear error, fallback is manual selection capture.
- **PAT scope**: fine-grained PAT needs Contents read/write on the wiki repo
  only. Stored in `chrome.storage.local` (extension-local, not synced).
- **Companion trust**: localhost server with no auth — fine for a personal
  machine; don't expose the port.
- **opencode non-interactive mode**: `opencode run [message..]` per official
  docs (opencode.ai/docs/cli); `--model provider/model` flag selects the model.
