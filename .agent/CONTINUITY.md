# CONTINUITY

## [DECISIONS]
- [USER] 2025-09-15 — LLM ingest runs via **local companion** executing `opencode run` (not browser API call).
- [USER] 2025-09-15 — Agent wiki rules live in a rules file in the wiki repo (path = settings, default `AGENTS.md`).
- [USER] 2025-09-15 — Push method: GitHub API + fine-grained PAT in extension settings; PAT is the **offline fallback** (companion does normal git push when online).
- [USER] 2025-09-15 — HTML page capture = selection, fallback full page text.
- [USER] 2025-09-15 — Wiki repo/rules path/model/port all configurable (companion.config.json + extension options page), nothing hardcoded.
- [USER] 2025-09-15 — opencode edits the local wiki clone directly; companion commits/pushes.
- [USER] 2025-09-15 — Companion: single Node script, stdlib only, port 7781.
- [TOOL] 2025-09-15 — Verified: `opencode run [message..]` is the non-interactive mode, `--model provider/model` supported (opencode.ai/docs/cli).

## [PROGRESS]
- [CODE] 2025-09-15 — PLAN.md written on branch `agent/wiki-ingest-plan`. No code yet. `ouroboros` repo was empty (README only).

## [ASSUMPTIONS]
- [ASSUMPTION] Wiki repo is a standard git remote reachable from this machine; opencode CLI is installed locally.
- [ASSUMPTION] AGENTS.md exists at wiki repo root (UNCONFIRMED — settings field covers relocation).
