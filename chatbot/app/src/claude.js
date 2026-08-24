/*
 * The production path: Claude answers, with the knowledge base as its only
 * source of truth. Falls back to the local matcher if there's no API key.
 */
let Anthropic = null;
try { Anthropic = require('@anthropic-ai/sdk'); } catch (e) { /* not installed yet */ }

const MODEL = process.env.SMPR_MODEL || 'claude-opus-5';

function buildSystemPrompt(kb) {
  const b = kb.business;
  const p = kb.persona || {};
  return [
    `You are ${p.name || b.name}, answering customers on the website of ${b.name} — a family-run walk-in phone repair shop and online store at ${b.addressShort}.`,
    ``,
    `Answer in first person, like the owner replying between jobs. Plain, warm, Australian. Short sentences — two or three at most. Answer the question first, then the one detail that actually helps. No corporate padding, no "Great question", no emoji except 📞 and 📍 on contact details.`,
    ``,
    `Write the way a person texts: a short line, then another, rather than one long paragraph.`,
    ``,
    `THE KNOWLEDGE BASE BELOW IS YOUR ONLY SOURCE OF TRUTH. If an answer is not in it, you do not know the answer.`,
    ``,
    `Rules you never break:`,
    ...kb.guardrails.map(g => `- ${g}`),
    `- Quote prices only from pricing.repairs. If the price is null or missing, say you do not have that one listed and give ${b.phone}. Never estimate from a similar model.`,
    `- Every price is a guide, confirmed in store once we see the device and the customer picks genuine or aftermarket.`,
    `- If asked directly whether you are a real person or a bot, say honestly that you are the shop's assistant, then keep helping. Never claim to be human when asked straight out.`,
    ``,
    `When you are not sure, say so plainly and hand off: ${kb.escalation.line.replace('{{phone}}', b.phone).replace('{{addressShort}}', b.addressShort).replace('{{hoursSummary}}', b.hoursSummary)}`,
    ``,
    `KNOWLEDGE BASE:`,
    JSON.stringify(kb)
  ].join('\n');
}

function available() {
  return Boolean(Anthropic && (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN));
}

async function ask(kb, history, message) {
  const client = new Anthropic();

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    // the knowledge base barely changes, so cache it as a prefix and pay for it once
    system: [{ type: 'text', text: buildSystemPrompt(kb), cache_control: { type: 'ephemeral' } }],
    messages: [...history, { role: 'user', content: message }]
  });

  const text = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  return {
    text,
    card: null,
    contact: false,
    chips: [],
    intent: 'claude:' + MODEL,
    usage: response.usage
  };
}

module.exports = { ask, available, buildSystemPrompt, MODEL };
