const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const MODEL = process.env.JW_MODEL || 'qwen2.5:7b';

async function chat(messages, { json = true, temperature = 0.2, model = MODEL } = {}) {
  const start = Date.now();
  console.log(`[Ollama] Sending request to model '${model}'...`);
  const res = await fetch(`${HOST}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      messages,
      stream: false,
      format: json ? 'json' : undefined,
      options: { temperature, num_ctx: 2048 },
    }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const body = await res.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[Ollama] Response received from '${model}' in ${elapsed}s`);
  return body.message.content;
}

async function chatJson(messages, opts) {
  const raw = await chat(messages, { ...opts, json: true });
  try {
    return JSON.parse(raw);
  } catch (e) {
    const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) return JSON.parse(m[0]);
    throw new Error(`model did not return JSON: ${raw.slice(0, 300)}`);
  }
}

async function health() {
  try {
    const res = await fetch(`${HOST}/api/tags`);
    if (!res.ok) return { ok: false, error: `status ${res.status}` };
    const body = await res.json();
    const models = (body.models || []).map((m) => m.name);
    return { ok: true, models, using: MODEL, present: models.includes(MODEL) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { chat, chatJson, health, MODEL, HOST };
