# CONTINUITY

## [DECISIONS]
- [USER] 2026-09-15 — LLM ingest runs via **local companion** executing `opencode run` (not browser API call).
- [USER] 2026-09-15 — Agent wiki rules live in a rules file in the wiki repo (settings field, default `AGENTS.md`).
- [USER] 2026-09-15 — Push method: GitHub API + fine-grained PAT in extension settings; PAT is the **offline fallback** (companion does normal git push when online).
- [USER] 2026-09-15 — HTML page capture = selection, fallback full page text.
- [USER] 2026-09-15 — Wiki repo/rules path/model/port all configurable; nothing hardcoded.
- [USER] 2026-09-15 — opencode edits the local wiki clone directly; companion commits/pushes.
- [USER] 2026-09-15 — Companion: single Node script, stdlib only (default port 7781).
- [TOOL] 2026-09-15 — Verified: `opencode run [message..]` is the non-interactive mode, `--model provider/model` supported (opencode.ai/docs/cli).

## [MILESTONE]
- [CODE] 2026-09-15 — PLAN.md written (branch `agent/wiki-ingest-plan`); empty repo scaffolded.

## [PROGRESS]
- [CODE] 2026-09-15 — Implementation complete on branch `agent/wiki-ingest-app`: extension (capture/push/options/popup/context menu), companion (`opencode run` + git), tests passing (`node test/*.test.mjs`).

## [DISCOVERIES]
- [CODE] 2026-09-15 — Companion writes captures to `<wikiDir>/inbox/`; extension fallback PUTs the same frontmatter format to `inbox/` so companion picks up offline captures on its next run (`status: unprocessed` scan).
- [CODE] 2026-09-15 — YouTube caption track is read MAIN-world (`ytInitialPlayerResponse` / `movie_player.getPlayerResponse()`), fetched from the SW (host permission bypasses CORS), parsed from `&fmt=json3` with consecutive-duplicate collapse for ASR rolling text.

## [OUTCOMES]
- [CODE] 2026-09-15 — Unit/integration tests pass. UNCONFIRMED: end-to-end run against the real wiki repo + real video (needs user PAT, wiki clone, opencode installed).
