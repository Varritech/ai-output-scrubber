'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'ai-output-scrubber.js');

// spawn + child.stdin.end — promisified execFile's `input` option silently
// hangs stdin-reading CLIs, so stdin is piped by hand here.
function runCli(input, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(input);
  });
}

test('default run strips the fence and filler and prints pretty JSON to stdout', async () => {
  const r = await runCli('Sure! Here is the data:\n\n```json\n{"a": 1}\n```\n\nLet me know!\n');
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '{\n  "a": 1\n}\n');
  assert.match(r.stderr, /detected json/);
});

test('--format csv converts a pasted markdown table', async () => {
  const r = await runCli('| City | Temp |\n| --- | --- |\n| Paris | 21 |', ['--format', 'csv']);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, 'City,Temp\nParis,21\n');
});

test('--format=json on plain text exits 1 with a clear stderr message', async () => {
  const r = await runCli('just a friendly answer', ['--format=json']);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /cannot convert/i);
});

test('warnings about dropped non-data lines go to stderr, stdout stays clean', async () => {
  const r = await runCli('{"a": 1}\n\nDO NOT DELETE THIS NOTE', []);
  assert.equal(r.code, 0);
  assert.equal(r.stdout, '{\n  "a": 1\n}\n');
  assert.match(r.stderr, /warning: dropped 1 non-data line/);
});

test('--help prints usage and exits 0', async () => {
  const r = await runCli('', ['--help']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /Usage: ai-output-scrubber/);
});

test('an unknown format value exits 2 and names the allowed formats', async () => {
  const r = await runCli('{"a":1}', ['--format', 'yaml']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /auto\|json\|csv\|markdown\|text/);
});

test('empty stdin exits 2 with a no-input message', async () => {
  const r = await runCli('   \n');
  assert.equal(r.code, 2);
  assert.match(r.stderr, /no input/);
});
