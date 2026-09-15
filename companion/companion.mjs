#!/usr/bin/env node
// Ouroboros wiki companion: receives captures from the extension, ingests them
// with `opencode run` (per the wiki's AGENTS.md rules), commits and pushes.
// Run: node companion.mjs [path/to/companion.config.json]
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfgFile = process.argv[2] || path.join(here, 'companion.config.json');
const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
// Trim strings so shell-style escapes / trailing spaces in JSON can't create bogus paths.
const cfgTrimmed = Object.fromEntries(
  Object.entries(cfg).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
);
const { wikiDir, model = '', port = 7781, branch = 'main', rulesFile = 'AGENTS.md', inboxDir = 'inbox' } = cfgTrimmed;
if (!wikiDir || !fs.existsSync(path.join(wikiDir, '.git'))) {
  console.error(`wikiDir must point at a git clone of your wiki — got: ${JSON.stringify(wikiDir)}`);
  process.exit(1);
}
const inbox = path.join(wikiDir, inboxDir);

// execFileSync (no shell) so titles/messages can't inject commands.
const git = (...args) => execFileSync('git', args, { cwd: wikiDir, encoding: 'utf8' });

const slugify = (t) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'capture';

const mdFor = (item) =>
  `---\nsource: ${item.source}\ntitle: ${JSON.stringify(item.title)}\nurl: ${item.url}\n` +
  `captured: ${item.capturedAt || new Date().toISOString()}\nstatus: unprocessed\n---\n\n${item.transcript}\n`;

function commitPush(message) {
  try { git('add', '-A'); } catch {}
  try {
    git('commit', '-m', message);
  } catch (e) {
    // "nothing to commit" is the normal no-op case; real failures surface at push.
  }
  try {
    git('push');
    return true;
  } catch (e) {
    console.log('[companion] git:', (e.stderr || e.stdout || e.message).split('\n')[0]);
    return false;
  }
}

function mergeToMain(branch) {
  try {
    git('checkout', 'main');
    try {
      git('merge', '--ff-only', branch);
    } catch {
      // main moved (e.g. obsidian-git vault backup) — take a real merge
      git('merge', '--no-edit', branch);
    }
    commitPush(`merge: ${branch}`);
  } catch (e) {
    console.log('[companion] merge failed:', (e.stderr || e.message).split('\n')[0]);
  }
}

function ingest(files) {
  const list = files.map((f) => path.join(inboxDir, f)).join('\n  - ');
  const prompt =
    `New capture(s) in ${inboxDir}/:\n  - ${list}\n\n` +
    `Read ${rulesFile} and ingest each capture into the wiki per those rules: ` +
    `create/update the appropriate notes with proper links, update index.md and log.md ` +
    `as the rules require, then set each capture file's frontmatter to "status: processed" ` +
    `(inbox files only — never touch anything under raw/).`;
  // bash -c with explicit cd: spawning opencode directly with cwd: wikiDir
  // starts it in the wrong project root (observed: it picked up the
  // companion's own cwd), which then auto-rejects the wiki as external.
  const p = spawn(
    'bash',
    ['-c', 'cd "$1" && exec opencode run --model "$2" "$3"', '_', wikiDir, model, prompt],
    { stdio: 'inherit' }
  );
  p.on('exit', (code) => {
    console.log(`[companion] opencode exited ${code}`);
    const branch = git('branch', '--show-current').trim();
    if (branch && branch !== 'main') mergeToMain(branch);
    else commitPush(`ingest: ${files.length} capture(s)`);
  });
}

function handle(item, res) {
  try {
    git('pull', '--ff-only', 'origin', branch);
  } catch (e) {
    console.log('[companion] pull skipped:', (e.stderr || e.message).split('\n')[0]);
  }
  fs.mkdirSync(inbox, { recursive: true });
  const name = `${new Date().toISOString().slice(0, 10)}-${slugify(item.title)}.md`;
  fs.writeFileSync(path.join(inbox, name), mdFor(item));
  commitPush(`capture: ${item.title.replace(/"/g, '')}`);
  // Also pick up any raw captures the extension committed via the GitHub fallback.
  const pending = fs
    .readdirSync(inbox)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => /status:\s*unprocessed/.test(fs.readFileSync(path.join(inbox, f), 'utf8')));
  if (model && pending.length) ingest(pending);
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, file: name, ingest: model ? `queued (${pending.length} file(s))` : 'skipped — no model configured' }));
}

http
  .createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/ingest') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          handle(JSON.parse(body), res);
        } catch (e) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: e.message }));
        }
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`[companion] :${port} → ${wikiDir} (inbox: ${inboxDir}, model: ${model || 'none'})`));
