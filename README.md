# AI Output Scrubber

Paste raw AI responses — wrapped in ```` ``` ```` code fences, polluted with "Sure! Here is your CSV:" filler, or formatted as markdown tables — and get clean **JSON**, **CSV**, **Markdown**, or **plain text**. Fully offline: a single `index.html` you open in a browser, plus a zero-dependency Node CLI. No accounts, no API keys, nothing uploaded.

## What it does

- **Strips code fences** — ```` ```json ```` / ```` ```csv ```` / bare ```` ``` ```` blocks, including unclosed fences from truncated replies. With several fences it keeps the largest block.
- **Removes conversational filler** — "Certainly! Here is the data…" preambles and "Let me know if you need anything else!" outros, counted and dropped.
- **Converts markdown tables** — `| A | B |` tables become real JSON arrays or RFC-quoted CSV. Escaped `\|` pipes, ragged rows (padded), and `|---|---|` separator variants all survive.
- **Parses bare CSV** — quoted fields, embedded commas, doubled quotes.
- **Round-trips JSON** — pretty-prints it, or shapes an array of objects into CSV/Markdown (nested values are stringified inside cells; single objects become `key,value` rows).
- **Warns instead of silently eating data** — non-filler lines dropped around a structured payload are reported (CLI: stderr; page: a badge).

## Install

```bash
git clone https://github.com/Varritech/ai-output-scrubber.git
cd ai-output-scrubber
```

No dependencies to install. (For the test suite you just need Node 18+.)

## Usage

### Web page (most people)

Open `index.html` in any browser. Paste the AI reply, pick an output format, hit **Scrub it** — or just start typing, it scrubs as you paste. **Copy output** puts the result on your clipboard.

### CLI

Reads stdin, writes clean data to stdout and notes/warnings to stderr:

```bash
node bin/ai-output-scrubber.js [--format auto|json|csv|markdown|text]
# or, after `npm link`:
ai-output-scrubber --format csv < raw.txt
```

Exit codes: `0` success · `1` cannot convert (e.g. `--format json` on plain prose) · `2` bad usage or no input.

## Examples

Everything below is the real CLI output.

**Fenced JSON with a wrapper → pretty JSON** (default `auto`):

```bash
$ printf 'Sure! Here is the data:\n\n```json\n{"name":"Ada","users":2}\n```\n\nLet me know!\n' | node bin/ai-output-scrubber.js
ai-output-scrubber: detected json (fence stripped)
{
  "name": "Ada",
  "users": 2
}
```

**Markdown table → CSV you can paste into a spreadsheet:**

```bash
$ printf '| Name | Score |\n| --- | --- |\n| Ada | 98 |\n| Grace | 99 |\n' | node bin/ai-output-scrubber.js --format csv
ai-output-scrubber: detected markdown-table
Name,Score
Ada,98
Grace,99
```

**JSON array → markdown table for a doc or README:**

```bash
$ printf '[{"city":"Paris","temp":21},{"city":"Tokyo","temp":26}]' | node bin/ai-output-scrubber.js -f markdown
ai-output-scrubber: detected json
| city | temp |
| --- | --- |
| Paris | 21 |
| Tokyo | 26 |
```

(`ai-output-scrubber: detected …` lines go to stderr, so `> out.csv` only ever captures the clean data.)

## How it works

One pipeline, no network: **extract largest fenced block** (or use the raw text) → **locate the payload** (balanced-brace JSON match → markdown table → consistent-width CSV run → plain text fallback) → **drop filler bookends** around it → **render** to the requested format. When converting to JSON, table/CSV cells are type-coerced (`true`/`false` → booleans, numerics → numbers). The exact same `src/scrub.js` source is inlined into `index.html`, and a test asserts the two can never drift.

## Tests

```bash
npm test
```

27+ behavior tests over the scrub engine, the CLI (exit codes, stdin/stdout/stderr), and the web bundle.

## License

MIT — see [LICENSE](LICENSE).

---

**[Made by Varritech](https://varritech.com)**

Varritech builds AI workforces that run your day-to-day. Learn more about Skillsmith and Scalewright at [varritech.com](https://varritech.com).
