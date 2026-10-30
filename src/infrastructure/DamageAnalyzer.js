import { DamageCategory } from '../domain/DamageCategory.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const RISKS = ['LOW', 'MEDIUM', 'HIGH'];
const MAX_REASON = 160;

const PROMPT = `Eres un inspector de vías de una alcaldía. Analiza la foto enviada por un ciudadano.
Responde solo con JSON de esta forma:
{"isRoad":true,"category":"POTHOLE","risk":"HIGH","confidence":0.9,"reason":"..."}
- isRoad: true si la foto muestra una vía, calle, andén o elemento vial; false si no.
- category: POTHOLE (bache), SINKHOLE (hundimiento), MANHOLE (alcantarilla abierta o dañada), SIGNAGE (señal de tránsito dañada o faltante), CRACK (grieta o fisura), OTHER (otro daño vial) o NONE (sin daño visible).
- risk: HIGH si puede causar un accidente o daño a vehículos ya; MEDIUM si es un daño notable que empeorará; LOW si es superficial o menor.
- confidence: número entre 0 y 1.
- reason: una frase en español de máximo ${MAX_REASON} caracteres que explique lo que ves.`;

export class DamageAnalyzer {
  constructor() {
    if (new.target === DamageAnalyzer) throw new TypeError('DamageAnalyzer es una interfaz abstracta');
  }

  get enabled() { return false; }

  async analyze(_bytes, _options) {
    throw new Error('No implementado');
  }
}

export class DisabledDamageAnalyzer extends DamageAnalyzer {
  async analyze() {
    return null;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = /\{[\s\S]*\}/.exec(text ?? '');
    return match ? JSON.parse(match[0]) : null;
  }
}

export function normalizeAnalysis(raw, { model, at = new Date() } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const code = String(raw.category ?? '').toUpperCase();
  const category = DamageCategory.values().some((item) => item.code === code) ? code : null;
  const risk = String(raw.risk ?? '').toUpperCase();
  const confidence = Number(raw.confidence);
  return {
    isRoad: raw.isRoad !== false,
    category,
    risk: RISKS.includes(risk) ? risk : null,
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, Math.round(confidence * 100) / 100)) : null,
    reason: String(raw.reason ?? '').trim().slice(0, MAX_REASON),
    model,
    analyzedAt: at.toISOString(),
  };
}

export class GroqDamageAnalyzer extends DamageAnalyzer {
  #apiKey;
  #model;
  #timeoutMs;
  #fetch;

  constructor({ apiKey, model = 'qwen/qwen3.8-27b', timeoutMs = 15_000, fetchImpl = globalThis.fetch }) {
    super();
    this.#apiKey = apiKey;
    this.#model = model;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  get enabled() { return true; }
  get model() { return this.#model; }

  async analyze(bytes, { mimeType }) {
    const response = await this.#fetch(GROQ_URL, {
      method: 'POST',
      signal: AbortSignal.timeout(this.#timeoutMs),
      headers: { Authorization: `Bearer ${this.#apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.#model,
        temperature: 0.1,
        max_completion_tokens: 300,
        reasoning_effort: 'none',
        response_format: { type: 'json_object' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}` } },
          ],
        }],
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Groq respondió ${response.status}: ${data?.error?.message ?? 'sin detalle'}`);
    return normalizeAnalysis(parseJson(data?.choices?.[0]?.message?.content), { model: this.#model });
  }
}
