# fast-CV

Open a job posting → click the extension → your resume comes back re-angled to that posting, in your own format, on one page, editable, downloadable as a PDF. Without leaving the tab, and without inventing anything.

Everything runs on your machine or uses secure API keys provided directly by you. The job description and your resume never leave your control.

## Multi-Provider LLM Support

`fast-CV` supports both local models (via Ollama) and cloud-based models:
- **Ollama**: Run completely local inference using models like `qwen2.5:7b`.
- **Gemini**: Key-based inference using Google Gemini models.
- **OpenAI**: Key-based inference using OpenAI GPT models.
- **Anthropic**: Key-based inference using Anthropic Claude models.

Select your provider and input your API key directly in the extension's minimalist B&W pop-up. Keys are stored securely in Chrome's local storage.

## What it does not do

It will not add a skill, employer, tool, number or outcome that is not already in your resume. That is enforced mechanically, not by asking the model politely:

- **Every rewritten bullet must cite the source bullet it came from.** No citation, or a citation it barely overlaps with, and the bullet is dropped and your original restored.
- **Every proper noun, tool and number in the output is checked** against everything your resume says. Anything unattested is highlighted in red for you to decide on.
- **Skills can only be re-ordered**, never added to.
- **Things the job wants that you don't have** are listed separately as gaps — kept out of the resume on purpose, so you can decide whether to apply or how to answer for them.

## Setup (on the laptop where you browse)

Requires Node 18+, Chrome or Brave, and optionally [Ollama](https://ollama.com) (if running locally).

Copy the `fast-CV` folder across however you like. Run `npm install` on the laptop; the bundled `.npmrc` already skips optional native dependencies, so the install is ~32 MB and needs no compiler.

```bash
cd fast-cv
npm install

# Option A: Local Ollama setup
ollama serve                # if it isn't already running
ollama pull qwen2.5:7b      # ~4.7 GB

# Start the server
npm run dev                 # http://127.0.0.1:7788
```

Then, one time only:

1. Open <http://127.0.0.1:7788/setup>
2. Your resume is already parsed into `data/facts.json` and will load automatically. To start from a different PDF, drop it in here.
3. **Read what it parsed.** Fix anything wrong — especially the lines it flags, where a line-break hyphen is ambiguous (`write-confirmation` vs `writeconfirmation`).
4. Save.

Load the extension:

1. `chrome://extensions` → enable **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. (Works the same in Brave at `brave://extensions`.)

## Using it

1. Open the job — LinkedIn, a careers page, anywhere.
2. Click the fast-CV toolbar button.
3. Click "Generate" and configure your preferred provider (Ollama, Gemini, OpenAI, or Anthropic) in the minimalist modal.
4. It pulls the JD off the page, tailors each section, and shows the result in your format. If it grabbed the wrong text, paste the real JD in the right-hand panel and re-run.
5. Click any line to edit it. **Update** saves. **Download PDF** saves the file.

## How the format is preserved

The renderer was fitted against `Vigneshwaran_AIEngineer.pdf` rather than approximated: the same Latin Modern fonts LaTeX embedded (from CTAN), the same A4 page, 37.44pt margins, 520.4pt text block, and vertical spacing fitted gap-by-gap against the original's baselines.

Chrome cannot shrink inter-word space the way TeX can, so tailored content that runs long is compressed down a fixed ladder until it holds one page. If it still overflows, the panel tells you how much to cut instead of silently spilling onto page two.

```bash
npm run check   # re-render and diff the geometry against the original PDF
npm test        # the anti-fabrication checks
```

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `7788` | server port |
| `OLLAMA_MODEL` | `qwen2.5:7b` | Ollama model |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | where Ollama runs |
| `JW_CHROME` | auto-detected | browser binary used for PDF output |

The server binds to `127.0.0.1` and only accepts requests from the extension or its own setup page, so a website you're browsing cannot read your resume off localhost.
