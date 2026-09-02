'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

test('index.html embeds the exact src/scrub.js core so the page can never drift from the CLI', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const core = fs.readFileSync(path.join(ROOT, 'src', 'scrub.js'), 'utf8');
  const m = html.match(/\/\* SCRUB-CORE-BEGIN \*\/\n([\s\S]*?)\n\/\* SCRUB-CORE-END \*\//);
  assert.ok(m, 'index.html must contain SCRUB-CORE markers');
  assert.equal(m[1], core.trim());
});

test('index.html is fully self-contained — no external scripts, styles, or fonts', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.equal(/<script[^>]+src=/i.test(html), false, 'no external <script src>');
  assert.equal(/<link[^>]+href=/i.test(html), false, 'no external <link href>');
  assert.equal(/src="https?:/i.test(html), false, 'no remote assets');
  assert.equal(/@import/i.test(html), false, 'no CSS @import');
});
