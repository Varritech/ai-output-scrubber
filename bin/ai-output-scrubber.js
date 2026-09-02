#!/usr/bin/env node
'use strict';

const { scrub } = require('../src/scrub.js');

const FORMATS = ['auto', 'json', 'csv', 'markdown', 'text'];

const USAGE = `Usage: ai-output-scrubber [--format auto|json|csv|markdown|text]

Paste a raw AI response on stdin; clean data goes to stdout.

Options:
  -f, --format <fmt>  Output format (default: auto — keep the detected shape)
  -h, --help          Show this help

  auto      Detect fenced JSON / markdown table / bare CSV and clean it
  json      Pretty-printed JSON (tables and CSV become arrays of objects)
  csv       RFC-style CSV (JSON arrays of objects become rows)
  markdown  Normalized markdown table (JSON arrays become tables)
  text      Plain cleaned text with fences and filler removed

Exit codes: 0 success · 1 cannot convert · 2 bad usage or no input
`;

function parseArgs(argv) {
  let format = 'auto';
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(USAGE);
      return { exitCode: 0 };
    }
    if (arg === '--format' || arg === '-f') {
      format = argv[++i] || '';
    } else if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
    } else {
      process.stderr.write(`unknown argument: ${arg}\n`);
      return { exitCode: 2 };
    }
  }
  if (!FORMATS.includes(format)) {
    process.stderr.write(`invalid format "${format}" — allowed: auto|json|csv|markdown|text\n`);
    return { exitCode: 2 };
  }
  return { format };
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.exitCode !== undefined) process.exit(parsed.exitCode);

  const input = await readStdin();
  if (!input.trim()) {
    process.stderr.write('ai-output-scrubber: no input on stdin\n');
    process.exit(2);
  }

  try {
    const r = scrub(input, { format: parsed.format });
    for (const w of r.warnings) process.stderr.write(`warning: ${w}\n`);
    const notes = [];
    if (r.fenceStripped) notes.push('fence stripped');
    if (r.fillerRemoved > 0) notes.push(`${r.fillerRemoved} filler line(s) removed`);
    process.stderr.write(`ai-output-scrubber: detected ${r.detected}${notes.length ? ` (${notes.join(', ')})` : ''}\n`);
    process.stdout.write(r.output + '\n');
  } catch (err) {
    process.stderr.write(`ai-output-scrubber: ${err.message}\n`);
    process.exit(1);
  }
}

main();
