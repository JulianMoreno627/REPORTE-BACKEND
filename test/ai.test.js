import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FallbackDamageAnalyzer, GeminiDamageAnalyzer, GroqDamageAnalyzer, normalizeAnalysis,
} from '../src/infrastructure/DamageAnalyzer.js';
import { PNG_BYTES } from './helpers.js';

const groqReply = (content, status = 200) => async (url, init) => {
  groqReply.last = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
  return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : { error: { message: 'rate limit' } }), { status });
};

test('normalizeAnalysis acota valores y descarta categorías desconocidas', () => {
  const at = new Date('2026-10-30T12:00:00Z');
  assert.deepEqual(normalizeAnalysis({ isRoad: true, category: 'crack', risk: 'medium', confidence: 1.7, reason: 'Grieta' }, { model: 'm', at }), {
    isRoad: true, category: 'CRACK', risk: 'MEDIUM', confidence: 1, reason: 'Grieta', provider: null, model: 'm', analyzedAt: at.toISOString(),
  });
  const unknown = normalizeAnalysis({ isRoad: false, category: 'NONE', risk: 'EXTREME', reason: 'x'.repeat(300) });
  assert.equal(unknown.category, null);
  assert.equal(unknown.risk, null);
  assert.equal(unknown.isRoad, false);
  assert.equal(unknown.reason.length, 160);
  assert.equal(normalizeAnalysis(null), null);
});

test('GroqDamageAnalyzer envía la imagen en base64 y entiende la respuesta JSON', async () => {
  const analyzer = new GroqDamageAnalyzer({
    apiKey: 'gsk_test', model: 'modelo-vision',
    fetchImpl: groqReply('```json\n{"isRoad":true,"category":"POTHOLE","risk":"HIGH","confidence":0.92,"reason":"Bache profundo"}\n```'),
  });
  const result = await analyzer.analyze(PNG_BYTES, { mimeType: 'image/png' });

  assert.equal(groqReply.last.auth, 'Bearer gsk_test');
  assert.equal(groqReply.last.body.model, 'modelo-vision');
  assert.match(groqReply.last.body.messages[0].content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(result.category, 'POTHOLE');
  assert.equal(result.risk, 'HIGH');
  assert.equal(result.model, 'modelo-vision');
});

test('GroqDamageAnalyzer propaga el error cuando Groq rechaza la petición', async () => {
  const analyzer = new GroqDamageAnalyzer({ apiKey: 'gsk_test', fetchImpl: groqReply('', 429) });
  await assert.rejects(analyzer.analyze(PNG_BYTES, { mimeType: 'image/png' }), /429.*rate limit/);
});

test('GeminiDamageAnalyzer envía la imagen como inline_data y lee el JSON de la respuesta', async () => {
  let sent;
  const analyzer = new GeminiDamageAnalyzer({
    apiKey: 'gemini-test', model: 'gemini-vision',
    fetchImpl: async (url, init) => {
      sent = { url, headers: init.headers, body: JSON.parse(init.body) };
      const text = '{"isRoad":true,"category":"SINKHOLE","risk":"HIGH","confidence":0.8,"reason":"Hundimiento"}';
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    },
  });
  const result = await analyzer.analyze(PNG_BYTES, { mimeType: 'image/png' });

  assert.match(sent.url, /\/models\/gemini-vision:generateContent$/);
  assert.equal(sent.headers['x-goog-api-key'], 'gemini-test');
  assert.equal(sent.body.contents[0].parts[1].inline_data.mime_type, 'image/png');
  assert.equal(sent.body.generationConfig.responseMimeType, 'application/json');
  assert.equal(result.category, 'SINKHOLE');
  assert.equal(result.provider, 'gemini');
});

test('FallbackDamageAnalyzer usa Gemini cuando Groq falla y pausa al proveedor caído', async () => {
  let clock = 0;
  const calls = [];
  const provider = (model, behavior) => ({
    enabled: true,
    model,
    analyze: async () => {
      calls.push(model);
      return behavior();
    },
  });
  const ok = (model) => ({ category: 'POTHOLE', risk: 'LOW', model });
  let groqDown = true;
  const analyzer = new FallbackDamageAnalyzer([
    provider('groq', () => { if (groqDown) throw new Error('429'); return ok('groq'); }),
    provider('gemini', () => ok('gemini')),
    { enabled: false, model: 'apagado', analyze: async () => assert.fail('no debe usarse') },
  ], { cooldownMs: 60_000, now: () => clock });

  assert.equal(analyzer.model, 'groq → gemini');
  assert.equal((await analyzer.analyze(PNG_BYTES, {})).model, 'gemini');
  assert.deepEqual(calls, ['groq', 'gemini']);

  groqDown = false;
  calls.length = 0;
  assert.equal((await analyzer.analyze(PNG_BYTES, {})).model, 'gemini');
  assert.deepEqual(calls, ['gemini']);

  clock = 61_000;
  calls.length = 0;
  assert.equal((await analyzer.analyze(PNG_BYTES, {})).model, 'groq');
  assert.deepEqual(calls, ['groq']);
});

test('FallbackDamageAnalyzer lanza el último error si todos los proveedores fallan', async () => {
  const failing = (model) => ({ enabled: true, model, analyze: async () => { throw new Error(`${model} caído`); } });
  const analyzer = new FallbackDamageAnalyzer([failing('groq'), failing('gemini')]);
  await assert.rejects(analyzer.analyze(PNG_BYTES, {}), /gemini caído/);
  assert.equal(new FallbackDamageAnalyzer([]).enabled, false);
});
