'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { scrub } = require('../src/scrub.js');

test('fenced JSON with conversational wrapper is reduced to pretty-printed JSON', () => {
  const input = [
    'Sure! Here is the JSON you asked for:',
    '',
    '```json',
    '{"name":"Ada","users":2,"active":true}',
    '```',
    '',
    'Let me know if you need anything else!',
    '',
  ].join('\n');

  const r = scrub(input, { format: 'auto' });

  assert.equal(r.detected, 'json');
  assert.equal(r.fenceStripped, true);
  assert.equal(r.output, '{\n  "name": "Ada",\n  "users": 2,\n  "active": true\n}');
});

test('unfenced JSON wrapped in filler lines is reduced and filler is counted', () => {
  const input = 'Certainly! Here is your data:\n\n{"a": 1, "b": [1, 2]}\n\nHope this helps! Let me know if you want it changed.\n';

  const r = scrub(input, { format: 'auto' });

  assert.equal(r.detected, 'json');
  assert.equal(r.fenceStripped, false);
  assert.equal(r.fillerRemoved, 2);
  assert.equal(r.output, '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
});

test('JSON object followed by non-filler prose keeps the prose but reports it', () => {
  const input = '{"a": 1}\n\nIMPORTANT: do not share this.';
  const r = scrub(input, { format: 'auto' });
  assert.equal(r.detected, 'json');
  assert.ok(r.warnings.some((w) => w.includes('1 non-data line')));
  assert.equal(r.output, '{\n  "a": 1\n}');
});

const TABLE_INPUT = [
  'Here is your table:',
  '',
  '| Name | Age | Active |',
  '| --- | --- | --- |',
  '| Ada Lovelace | 36 | true |',
  "| Grace Hopper | 85 | false |",
  '',
].join('\n');

test('unfenced markdown table after a preamble is detected and kept as markdown on auto', () => {
  const r = scrub(TABLE_INPUT, { format: 'auto' });
  assert.equal(r.detected, 'markdown-table');
  assert.equal(r.fillerRemoved, 1);
  assert.equal(r.output, '| Name | Age | Active |\n| --- | --- | --- |\n| Ada Lovelace | 36 | true |\n| Grace Hopper | 85 | false |');
});

test('markdown table converts to JSON with type coercion', () => {
  const r = scrub(TABLE_INPUT, { format: 'json' });
  assert.equal(r.detected, 'markdown-table');
  assert.deepEqual(JSON.parse(r.output), [
    { Name: 'Ada Lovelace', Age: 36, Active: true },
    { Name: 'Grace Hopper', Age: 85, Active: false },
  ]);
});

test('markdown table converts to CSV with quoting only when needed', () => {
  const r = scrub('| City | Note |\n| --- | --- |\n| Paris | hello |\n| NYC | a, b |', { format: 'csv' });
  assert.equal(r.output, 'City,Note\nParis,hello\nNYC,"a, b"');
});

test('JSON array of objects converts to CSV with union-of-keys header in first-seen order', () => {
  const input = '```json\n[{"a": 1, "b": "x"}, {"b": "y", "c": true}]\n```';
  const r = scrub(input, { format: 'csv' });
  assert.equal(r.detected, 'json');
  assert.equal(r.output, 'a,b,c\n1,x,\n,y,true');
});

test('JSON array with nested values stringifies them inside CSV cells', () => {
  const input = '[{"id": 1, "tags": ["a", "b"]}]';
  const r = scrub(input, { format: 'csv' });
  assert.equal(r.output, 'id,tags\n1,"[""a"",""b""]"');
});

test('single JSON object converts to CSV as key,value rows', () => {
  const r = scrub('{"name": "Ada", "age": 36}', { format: 'csv' });
  assert.equal(r.output, 'key,value\nname,Ada\nage,36');
});

test('JSON array of objects converts to a markdown table', () => {
  const r = scrub('[{"a": 1, "b": "x"}, {"a": 2, "b": "y"}]', { format: 'markdown' });
  assert.equal(r.output, '| a | b |\n| --- | --- |\n| 1 | x |\n| 2 | y |');
});

test('single JSON object converts to a markdown Key/Value table', () => {
  const r = scrub('{"name": "Ada"}', { format: 'markdown' });
  assert.equal(r.output, '| Key | Value |\n| --- | --- |\n| name | Ada |');
});

test('bare CSV with a preamble is detected and normalized on auto', () => {
  const input = 'Here is your CSV:\n\nname,age\nAda,36\nGrace,85\n';
  const r = scrub(input, { format: 'auto' });
  assert.equal(r.detected, 'csv');
  assert.equal(r.fillerRemoved, 1);
  assert.equal(r.output, 'name,age\nAda,36\nGrace,85');
});

test('quoted commas survive CSV parsing and JSON output coerces numbers', () => {
  const r = scrub('name,note,score\nAda,"loves, math",36.5', { format: 'json' });
  assert.equal(r.detected, 'csv');
  assert.deepEqual(JSON.parse(r.output), [{ name: 'Ada', note: 'loves, math', score: 36.5 }]);
});

test('fenced csv block converts to a markdown table', () => {
  const input = 'Sure thing:\n\n```csv\ncity,temp\nParis,21\n```\n\nHope this helps!';
  const r = scrub(input, { format: 'markdown' });
  assert.equal(r.detected, 'csv');
  assert.equal(r.fenceStripped, true);
  assert.equal(r.output, '| city | temp |\n| --- | --- |\n| Paris | 21 |');
});

test('plain prose keeps its content and strips filler bookends', () => {
  const input = 'Here is the answer:\n\nThe capital of France is Paris.\n\nLet me know if you need more.\n';
  const r = scrub(input, { format: 'auto' });
  assert.equal(r.detected, 'text');
  assert.equal(r.fenceStripped, false);
  assert.equal(r.fillerRemoved, 2);
  assert.equal(r.output, 'The capital of France is Paris.');
});

test('requesting JSON for a plain-text payload throws a clear error', () => {
  assert.throws(() => scrub('just a sentence, nothing structured', { format: 'json' }), /cannot convert/i);
});

test('an unclosed fence (truncated AI reply) still scrubs its content', () => {
  const input = 'Here you go:\n\n```json\n{"a": 1}\n';
  const r = scrub(input, { format: 'auto' });
  assert.equal(r.fenceStripped, true);
  assert.equal(r.detected, 'json');
  assert.equal(r.output, '{\n  "a": 1\n}');
});

test('when several fences exist, the largest block is the payload', () => {
  const input = '```\n{x}\n```\n\nSome chatter between blocks.\n\n```json\n{"real": true, "rows": [1, 2, 3]}\n```\n';
  const r = scrub(input, { format: 'auto' });
  assert.equal(r.detected, 'json');
  assert.equal(r.output, '{\n  "real": true,\n  "rows": [\n    1,\n    2,\n    3\n  ]\n}');
});

test('escaped pipes inside table cells survive as literal pipes', () => {
  const r = scrub('| Col |\n| --- |\n| a \\| b |', { format: 'json' });
  assert.deepEqual(JSON.parse(r.output), [{ Col: 'a | b' }]);
});

test('ragged table rows are padded so JSON keys never go missing', () => {
  const r = scrub('| A | B | C |\n| --- | --- | --- |\n| 1 | 2 |', { format: 'json' });
  assert.deepEqual(JSON.parse(r.output), [{ A: 1, B: 2, C: '' }]);
});
