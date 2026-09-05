/*
 * Hope's realistic voice, for free: the same neural "Natasha" (en-AU) that
 * Microsoft Edge's Read Aloud uses, fetched server-side where no browser
 * user-agent rules apply. No account, no key, no per-character bill.
 *
 * This is an unofficial endpoint, so it's treated as best-effort: any
 * failure or slowness just means the voice page falls back to the
 * browser's built-in voices. Recent phrases are cached in memory - the
 * greeting and common answers synthesize once per deploy, not per call.
 */
// msedge-tts expects the browser-style global crypto; Node 18 keeps it
// under the module instead
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('node:crypto').webcrypto;
}
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');

const VOICE = process.env.HOPE_VOICE || 'en-AU-NatashaNeural';
const TIMEOUT_MS = 15000;
const MAX_CHARS = 800;

const cache = new Map(); // text -> Buffer (mp3)
const CACHE_CAP = 200;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function synth(text) {
  text = String(text || '').slice(0, MAX_CHARS).trim();
  if (!text) return Promise.reject(new Error('empty'));
  if (cache.has(text)) return Promise.resolve(cache.get(text));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('tts timeout')), TIMEOUT_MS);
    (async () => {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
      const { audioStream } = tts.toStream(esc(text));
      const chunks = [];
      audioStream.on('data', c => chunks.push(c));
      audioStream.on('close', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(chunks);
        if (!buf.length) return reject(new Error('empty audio'));
        if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
        cache.set(text, buf);
        resolve(buf);
      });
      audioStream.on('error', err => { clearTimeout(timer); reject(err); });
    })().catch(err => { clearTimeout(timer); reject(err); });
  });
}

module.exports = { synth, VOICE };
