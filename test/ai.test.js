import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GroqDamageAnalyzer, normalizeAnalysis } from '../src/infrastructure/DamageAnalyzer.js';
import { PNG_BYTES } from './helpers.js';

const groqReply = (content, status = 200) => async (url, init) => {
  groqReply.last = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
  return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content } }] } : { error: { message: 'rate limit' } }), { status });
};

test('normalizeAnalysis acota valores y descarta categorías desconocidas', () => {
  const at = new Date('2026-10-30T12:00:00Z');
  assert.deepEqual(normalizeAnalysis({ isRoad: true, category: 'crack', risk: 'medium', confidence: 1.7, reason: 'Grieta' }, { model: 'm', at }), {
    isRoad: true, category: 'CRACK', risk: 'MEDIUM', confidence: 1, reason: 'Grieta', model: 'm', analyzedAt: at.toISOString(),
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
