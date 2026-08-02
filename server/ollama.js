const fs = require('fs');
const path = require('path');

// Load environment variables from .env file if it exists
try {
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    for (const line of env.split('\n')) {
      const match = line.match(/^\s*([^#=]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1].trim();
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
        if (!process.env[key]) process.env[key] = val;
      }
    }
  }
} catch (e) {
  // ignore
}

const HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || process.env.JW_MODEL || 'qwen2.5:7b';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

async function chat(messages, { json = true, temperature = 0.2, model = null, provider = null, apiKey = null } = {}) {
  const activeProvider = provider ? provider.toLowerCase() : (apiKey ? 'gemini' : (GEMINI_API_KEY ? 'gemini' : 'ollama'));
  const activeKey = apiKey || (activeProvider === 'gemini' ? GEMINI_API_KEY : null);

  if (activeProvider === 'gemini') {
    const activeModel = model || GEMINI_MODEL;
    if (!activeKey) {
      throw new Error('Gemini API Key is required but not provided.');
    }
    const start = Date.now();
    console.log(`[Gemini] Sending request to model '${activeModel}'...`);

    // Find system instruction
    const systemMsg = messages.find((m) => m.role === 'system');
    const systemInstruction = systemMsg
      ? {
          parts: [{ text: systemMsg.content }],
        }
      : undefined;

    // Build contents, mapping 'assistant' role to 'model'
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent?key=${activeKey}`;

    const body = {
      contents,
      systemInstruction,
      generationConfig: {
        temperature,
        responseMimeType: json ? 'application/json' : 'text/plain',
      },
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`gemini ${res.status}: ${await res.text()}`);
    }

    const resBody = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Gemini] Response received from '${activeModel}' in ${elapsed}s`);

    const candidate = resBody.candidates && resBody.candidates[0];
    if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0]) {
      throw new Error(`Invalid Gemini response: ${JSON.stringify(resBody)}`);
    }

    return candidate.content.parts[0].text;
  } else if (activeProvider === 'openai') {
    const activeModel = model || 'gpt-4o-mini';
    const activeKey = apiKey || process.env.OPENAI_API_KEY;
    if (!activeKey) {
      throw new Error('OpenAI API Key is required but not provided.');
    }
    const start = Date.now();
    console.log(`[OpenAI] Sending request to model '${activeModel}'...`);

    const url = `https://api.openai.com/v1/chat/completions`;
    const body = {
      model: activeModel,
      messages,
      temperature,
      response_format: json ? { type: 'json_object' } : undefined,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${activeKey}`
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`openai ${res.status}: ${await res.text()}`);
    }

    const resBody = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[OpenAI] Response received from '${activeModel}' in ${elapsed}s`);

    const choice = resBody.choices && resBody.choices[0];
    if (!choice || !choice.message || !choice.message.content) {
      throw new Error(`Invalid OpenAI response: ${JSON.stringify(resBody)}`);
    }

    return choice.message.content;
  } else if (activeProvider === 'anthropic') {
    const activeModel = model || 'claude-3-5-haiku-20241022';
    const activeKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!activeKey) {
      throw new Error('Anthropic API Key is required but not provided.');
    }
    const start = Date.now();
    console.log(`[Anthropic] Sending request to model '${activeModel}'...`);

    const url = `https://api.anthropic.com/v1/messages`;
    const systemMsg = messages.find((m) => m.role === 'system');
    const filteredMessages = messages.filter((m) => m.role !== 'system');

    const body = {
      model: activeModel,
      max_tokens: 4000,
      system: systemMsg ? systemMsg.content : undefined,
      messages: filteredMessages,
      temperature,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': activeKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`anthropic ${res.status}: ${await res.text()}`);
    }

    const resBody = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Anthropic] Response received from '${activeModel}' in ${elapsed}s`);

    const content = resBody.content && resBody.content[0];
    if (!content || !content.text) {
      throw new Error(`Invalid Anthropic response: ${JSON.stringify(resBody)}`);
    }

    return content.text;
  } else {
    // Ollama implementation
    const activeModel = model || OLLAMA_MODEL;
    const start = Date.now();
    console.log(`[Ollama] Sending request to model '${activeModel}'...`);
    const res = await fetch(`${HOST}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: activeModel,
        messages,
        stream: false,
        format: json ? 'json' : undefined,
        options: { temperature, num_ctx: 2048 },
      }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
    const body = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Ollama] Response received from '${activeModel}' in ${elapsed}s`);
    return body.message.content;
  }
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
  if (GEMINI_API_KEY) {
    return { ok: true, models: [GEMINI_MODEL], using: GEMINI_MODEL, present: true, isGemini: true };
  }
  try {
    const res = await fetch(`${HOST}/api/tags`);
    if (!res.ok) return { ok: false, error: `status ${res.status}`, isGemini: false };
    const body = await res.json();
    const models = (body.models || []).map((m) => m.name);
    return { ok: true, models, using: OLLAMA_MODEL, present: models.includes(OLLAMA_MODEL), isGemini: false };
  } catch (e) {
    return { ok: false, error: e.message, isGemini: false };
  }
}

module.exports = { chat, chatJson, health, MODEL: OLLAMA_MODEL, HOST };

