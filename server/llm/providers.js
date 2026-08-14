'use strict';

/*
 * Free-first LLM provider adapter.
 *
 * LLM_FREE_ONLY defaults to true. In that mode the adapter accepts only
 * provider/model combinations that are explicitly free-routed or listed on
 * the providers' public free tiers. Paid providers are never used as fallback.
 */

const GROQ_FREE_MODELS = new Set([
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'openai/gpt-oss-safeguard-20b',
  'qwen/qwen3.6-27b',
  'groq/compound',
  'groq/compound-mini'
]);

const GEMINI_FREE_MODELS = new Set([
  'gemini-2.5-pro',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash-lite-preview-09-2025',
  'gemini-2.5-flash-preview-tts'
]);

const DEFAULTS = Object.freeze({
  groq: process.env.GROQ_FREE_MODEL || 'llama-3.1-8b-instant',
  gemini: process.env.GEMINI_FREE_MODEL || 'gemini-2.5-flash-lite',
  openrouter: process.env.OPENROUTER_FREE_MODEL || 'openrouter/free'
});

function freeOnly() {
  /* This build is intentionally hard-locked to free providers. */
  return true;
}

function textFromChat(data) {
  const c = data?.choices?.[0]?.message?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map(x => typeof x === 'string' ? x : (x?.text || '')).join('');
  return '';
}

function textFromGemini(data) {
  return (data?.candidates || [])
    .flatMap(c => c?.content?.parts || [])
    .map(p => p?.text || '')
    .join('\n');
}

function parseJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(raw);
}

async function request(url, options, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs || 30000);
  try {
    const r = await fetch(url, { ...options, signal: ctrl.signal });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch { data = { error: text }; }
    if (!r.ok) {
      const err = new Error(`LLM provider returned ${r.status}: ${data?.error?.message || data?.error || text.slice(0, 180)}`);
      err.status = r.status;
      throw err;
    }
    return data;
  } finally { clearTimeout(timer); }
}

function isOpenRouterFreeModel(model) {
  const m = String(model || '').trim();
  return m === 'openrouter/free' || m.endsWith(':free');
}

function validateConfig(provider, model, { allowMock = true } = {}) {
  const p = String(provider || '').trim().toLowerCase();
  const m = String(model || '').trim();

  if (p === 'mock' && allowMock) return { provider: p, model: m || 'mock', free: true };
  if (!p) throw Object.assign(new Error('An LLM provider is required.'), { status: 400 });


  if (p === 'groq') {
    if (!GROQ_FREE_MODELS.has(m)) throw Object.assign(new Error(`Model ${m || '(blank)'} is not on this build's Groq free-model allowlist.`), { status: 400 });
    return { provider: p, model: m, free: true };
  }
  if (p === 'gemini') {
    if (!GEMINI_FREE_MODELS.has(m)) throw Object.assign(new Error(`Model ${m || '(blank)'} is not on this build's Gemini free-tier allowlist.`), { status: 400 });
    return { provider: p, model: m, free: true };
  }
  if (p === 'openrouter') {
    if (!isOpenRouterFreeModel(m)) throw Object.assign(new Error('Free-only mode permits only openrouter/free or model IDs ending in :free.'), { status: 400 });
    return { provider: p, model: m, free: true };
  }

  if (p === 'openai' || p === 'anthropic') {
    throw Object.assign(new Error(`${p} is disabled while LLM_FREE_ONLY=true.`), { status: 400 });
  }
  throw Object.assign(new Error(`Unsupported model provider: ${p}`), { status: 400 });
}

function providerHasKey(provider) {
  if (provider === 'groq') return Boolean(process.env.GROQ_API_KEY);
  if (provider === 'gemini') return Boolean(process.env.GEMINI_API_KEY);
  if (provider === 'openrouter') return Boolean(process.env.OPENROUTER_API_KEY);
  return provider === 'mock';
}

function fallbackCandidates(primaryProvider, primaryModel) {
  const first = { provider: String(primaryProvider || '').toLowerCase(), model: primaryModel };
  if (first.provider === 'mock') return [first];

  const order = [
    first,
    { provider: 'groq', model: DEFAULTS.groq },
    { provider: 'gemini', model: DEFAULTS.gemini },
    { provider: 'openrouter', model: DEFAULTS.openrouter }
  ];
  const seen = new Set();
  return order.filter(x => {
    const k = `${x.provider}:${x.model}`;
    if (seen.has(k)) return false;
    seen.add(k);
    try { validateConfig(x.provider, x.model, { allowMock: false }); }
    catch { return false; }
    return providerHasKey(x.provider);
  });
}

async function completeSingle({ provider, model, system, input, timeoutMs = 30000 }) {
  const checked = validateConfig(provider, model);
  provider = checked.provider;
  model = checked.model;

  if (provider === 'mock') {
    if (input?.mode === 'vote') return { vote_for: input.proposals?.[0]?.id || null, reasoning: 'Mock vote.' };
    return { action_kind: 'nothing', priority: 0, payload: {}, rationale: 'Mock provider takes no action.' };
  }

  if (provider === 'groq') {
    if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured.');
    const data = await request('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${system}\n\nReturn ONLY one valid JSON object. No markdown.` },
          { role: 'user', content: JSON.stringify(input) }
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' }
      })
    }, timeoutMs);
    return parseJson(textFromChat(data));
  }

  if (provider === 'gemini') {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
    const data = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: `${system}\n\nReturn ONLY one valid JSON object. No markdown.` }] },
        contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
      })
    }, timeoutMs);
    return parseJson(textFromGemini(data));
  }

  if (provider === 'openrouter') {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not configured.');
    const data = await request('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': process.env.PUBLIC_URL || 'https://localhost',
        'X-Title': process.env.OPENROUTER_APP_NAME || 'The Republic Diplomacy'
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: `${system}\n\nReturn ONLY one valid JSON object. No markdown.` },
          { role: 'user', content: JSON.stringify(input) }
        ],
        temperature: 0.4,
        response_format: { type: 'json_object' }
      })
    }, timeoutMs);
    return parseJson(textFromChat(data));
  }


  throw new Error(`Unsupported model provider: ${provider}`);
}

async function complete(args) {
  const candidates = fallbackCandidates(args.provider, args.model);
  if (!candidates.length) {
    /* Gives a precise free-only validation error for the requested configuration. */
    validateConfig(args.provider, args.model);
    throw new Error('No configured free LLM provider is available.');
  }

  const failures = [];
  for (const c of candidates) {
    try {
      return await completeSingle({ ...args, provider: c.provider, model: c.model });
    } catch (err) {
      failures.push(`${c.provider}/${c.model}: ${err.message}`);
    }
  }
  throw new Error(`Every configured free LLM provider failed. ${failures.join(' | ')}`);
}

function policy() {
  return {
    free_only: true,
    hard_locked: true,
    providers: {
      groq: { configured: providerHasKey('groq'), default_model: DEFAULTS.groq, allowed_models: [...GROQ_FREE_MODELS] },
      gemini: { configured: providerHasKey('gemini'), default_model: DEFAULTS.gemini, allowed_models: [...GEMINI_FREE_MODELS] },
      openrouter: { configured: providerHasKey('openrouter'), default_model: DEFAULTS.openrouter, rule: 'openrouter/free or any model ending in :free' },
      mock: { configured: true, default_model: 'mock' }
    },
    fallback_order: ['requested free provider', 'groq', 'gemini', 'openrouter'],
    paid_providers_disabled: freeOnly() ? ['openai', 'anthropic'] : []
  };
}

module.exports = { complete, completeSingle, validateConfig, policy, freeOnly, GROQ_FREE_MODELS, GEMINI_FREE_MODELS };
