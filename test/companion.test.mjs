// Boots companion.mjs against a temp git repo, POSTs a fake capture, asserts
// the inbox file + commit. Model is unset so opencode is skipped.
import assert from 'node:assert';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wiki-test-'));
const run = (cmd, args) => execFileSync(cmd, args, { cwd: tmp, encoding: 'utf8' });
run('git', ['init', '-b', 'main']);
run('git', ['config', 'user.email', 't@t']);
run('git', ['config', 'user.name', 't']);
fs.writeFileSync(path.join(tmp, 'README.md'), 'x\n');
run('git', ['add', '-A']);
run('git', ['commit', '-m', 'init']);

const cfgFile = path.join(tmp, 'cfg.json');
const port = randomInt(20000, 40000);
fs.writeFileSync(cfgFile, JSON.stringify({ wikiDir: tmp, port }));

const child = spawn('node', [fileURLToPath(new URL('../companion/companion.mjs', import.meta.url)), cfgFile], { stdio: 'pipe' });
await new Promise((res) => {
  child.stdout.on('data', (d) => d.toString().includes('→') && res());
  setTimeout(res, 3000);
});

let exitCode = 0;
try {
const body = JSON.stringify({
  source: 'youtube',
  title: 'Test "Video" Title',
  url: 'https://youtu.be/abc',
  transcript: 'hello world',
  capturedAt: '2026-09-15T00:00:00Z',
});
const res = await fetch(`http://127.0.0.1:${port}/ingest`, { method: 'POST', body, headers: { 'content-type': 'application/json' } });
const json = await res.json();
assert.equal(json.ok, true, JSON.stringify(json));

const file = path.join(tmp, 'inbox', json.file);
assert.ok(fs.existsSync(file), 'inbox file written');
const md = fs.readFileSync(file, 'utf8');
assert.match(md, /status: unprocessed/);
assert.match(md, /title: "Test \\"Video\\" Title"/);

const log = run('git', ['log', '--oneline']);
assert.match(log, /capture: Test Video Title/, 'commit made');
console.log('companion.test.mjs ✓');
} finally {
  child.kill();
}
