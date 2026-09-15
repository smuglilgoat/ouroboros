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
const { wikiDir, model = '', port = 7781, branch = 'main', rulesFile = 'AGENTS.md' } = cfg;
if (!wikiDir) {
  console.error('companion.config.json needs { "wikiDir": "/path/to/wiki-clone" }');
  process.exit(1);
}
const inboxDir = path.join(wikiDir, 'inbox');

// execFileSync (no shell) so titles/messages can't inject commands.
const git = (...args) => execFileSync('git', args, { cwd: wikiDir, encoding: 'utf8' });

const slugify = (t) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'capture';

const mdFor = (item) =>
  `---\nsource: ${item.source}\ntitle: ${JSON.stringify(item.title)}\nurl: ${item.url}\n` +
  `captured: ${item.capturedAt || new Date().toISOString()}\nstatus: unprocessed\n---\n\n${item.transcript}\n`;

function commitPush(message) {
  try {
    git('add', '-A');
    git('commit', '-m', message);
    git('push');
    return true;
  } catch (e) {
    console.log('[companion] git:', (e.stderr || e.stdout || e.message).split('\n')[0]);
    return false;
  }
}

function ingest(files) {
  const list = files.join('\n  - ');
  const prompt =
    `New capture(s) in inbox/:\n  - ${list}\n\n` +
    `Read ${rulesFile} and ingest each capture into the wiki per those rules: ` +
    `create/update the appropriate notes with proper links, then set each inbox ` +
    `file's frontmatter to "status: processed".`;
  const p = spawn('opencode', ['run', '--model', model, prompt], { cwd: wikiDir, stdio: 'inherit' });
  p.on('exit', (code) => {
    console.log(`[companion] opencode exited ${code}`);
    commitPush(`ingest: ${files.length} capture(s)`);
  });
}

function handle(item, res) {
  try {
    git('pull', '--ff-only', 'origin', branch);
  } catch (e) {
    console.log('[companion] pull skipped:', (e.stderr || e.message).split('\n')[0]);
  }
  fs.mkdirSync(inboxDir, { recursive: true });
  const name = `${new Date().toISOString().slice(0, 10)}-${slugify(item.title)}.md`;
  fs.writeFileSync(path.join(inboxDir, name), mdFor(item));
  commitPush(`capture: ${item.title.replace(/"/g, '')}`);
  // Also pick up any raw captures the extension committed via the GitHub fallback.
  const pending = fs
    .readdirSync(inboxDir)
    .filter((f) => f.endsWith('.md'))
    .filter((f) => /status:\s*unprocessed/.test(fs.readFileSync(path.join(inboxDir, f), 'utf8').slice(0, 400)));
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
  .listen(port, '127.0.0.1', () => console.log(`[companion] :${port} → ${wikiDir} (model: ${model || 'none'})`));
