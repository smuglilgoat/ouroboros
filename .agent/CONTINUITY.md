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
- [CODE] 2026-09-15 — Unit/integration tests pass.
- [CODE] 2026-09-15 — First real ingest completed end-to-end (manual rerun after path fix): Positions revue article → 4 entities, 5 concepts, 1 source page; merged to main in The Aerie and pushed. Companion HTTP loop itself still UNCONFIRMED live (next real capture via extension will exercise it).
- [CODE] 2026-09-15 — The Aerie's AGENTS.md: raw/ is user-owned/immutable; captures stage in inbox/ (tool-owned); opencode creates a feature branch per ingest rather than committing to main directly — merge to main afterwards is a separate step.
