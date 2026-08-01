# jobwire

Open a job posting → click the extension → your resume comes back re-angled to that
posting, in your own format, on one page, editable, downloadable as a PDF. Without
leaving the tab, and without inventing anything.

Everything runs on your machine. The job description and your resume never leave it.

## What it does not do

It will not add a skill, employer, tool, number or outcome that is not already in your
resume. That is enforced mechanically, not by asking the model politely:

- **Every rewritten bullet must cite the source bullet it came from.** No citation, or a
  citation it barely overlaps with, and the bullet is dropped and your original restored.
- **Every proper noun, tool and number in the output is checked** against everything your
  resume says. Anything unattested is highlighted in red for you to decide on.
- **Skills can only be re-ordered**, never added to.
- **Things the job wants that you don't have** are listed separately as gaps — kept out of
  the resume on purpose, so you can decide whether to apply or how to answer for them.

## Setup (on the laptop where you browse)

Requires Node 18+, Chrome or Brave, and [Ollama](https://ollama.com).

Copy the `jobwire` folder across however you like — it is plain JS with no build
step, so drag-and-drop is fine. Do **not** copy `node_modules`: it contains a
Linux-compiled binary (`canvas`, an optional pdfjs dependency this project never
uses). Run `npm install` on the laptop instead; the bundled `.npmrc` already skips
that optional native dependency, so the install is ~32 MB and needs no compiler.

```bash
cd jobwire
npm install

ollama serve                # if it isn't already running
ollama pull qwen2.5:7b      # ~4.7 GB

npm start                   # http://127.0.0.1:7788
```

Then, one time only:

1. Open <http://127.0.0.1:7788/setup>
2. Your resume is already parsed into `data/facts.json` and will load automatically.
   To start from a different PDF, drop it in here.
3. **Read what it parsed.** Fix anything wrong — especially the lines it flags, where a
   line-break hyphen is ambiguous (`write-confirmation` vs `writeconfirmation`).
4. Save.

Load the extension:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. (Works the same in Brave at `brave://extensions`.)

## Using it

1. Open the job — LinkedIn, a careers page, anywhere.
2. Click the jobwire toolbar button.
3. It pulls the JD off the page, tailors each section, and shows the result in your format.
   If it grabbed the wrong text, paste the real JD in the right-hand panel and re-run.
4. Click any line to edit it. **Update** saves. **Download PDF** saves the file.

Selecting the JD text before clicking makes extraction exact.

## How the format is preserved

The renderer was fitted against `Vigneshwaran_AIEngineer.pdf` rather than approximated:
the same Latin Modern fonts LaTeX embedded (from CTAN), the same A4 page, 37.44pt margins,
520.4pt text block, and vertical spacing fitted gap-by-gap against the original's baselines.

Measured against the source PDF: identical glyph widths (0.999 ratio), identical font
sizes, `dx = 0` on every line, and all spacing within ~2pt.

Chrome cannot shrink inter-word space the way TeX can, so tailored content that runs long
is compressed down a fixed ladder until it holds one page. If it still overflows, the
panel tells you how much to cut instead of silently spilling onto page two.

```bash
npm run check   # re-render and diff the geometry against the original PDF
npm test        # the anti-fabrication checks
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `JW_PORT` | `7788` | server port |
| `JW_MODEL` | `qwen2.5:7b` | Ollama model |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | where Ollama runs |
| `JW_CHROME` | auto-detected | browser binary used for PDF output |

The server binds to `127.0.0.1` and only accepts requests from the extension or its own
setup page, so a website you're browsing cannot read your resume off localhost.

## Layout

```
server/
  pdf-import.js   resume PDF -> structured facts (fonts, columns, right-aligned dates)
  render.js       facts -> HTML in your exact format
  fit.js          one-page compression ladder, shared by preview and PDF
  tailor.js       per-section prompts; sections run concurrently
  verify.js       the anti-fabrication gate
  pdf-out.js      HTML -> PDF via headless Chrome
extension/        MV3 extension: JD capture + on-page modal
setup/            one-time import and review UI
tools/            geometry verification against the original PDF
```

## Status

MVP. The deterministic half — import, render, one-page fit, and the honesty checks — is
tested and verified against the real PDF. The tailoring quality depends on the local model;
`qwen2.5:7b` is competent, not brilliant. If the wording disappoints, use a bigger model
via `JW_MODEL` rather than expecting prompt changes to fix it.

Not yet done: OCR for job descriptions posted as images, and the "promote an edit back into
your master resume" toggle.
