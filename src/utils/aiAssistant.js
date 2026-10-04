const DEFAULT_MODEL = 'gpt-5.6-luna';
const COOLDOWN_MS = 30_000;
const DAILY_REQUEST_LIMIT = 60;
const recentCalls = new Map();
const activeGuilds = new Set();
const dailyCalls = new Map();

function assistantEnabled() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function outputText(response) {
  return (response.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text)
    .join('\n')
    .trim();
}

async function requestAssistant({ instructions, input, maxOutputTokens = 400 }) {
  if (!assistantEnabled()) throw new Error('AI is disabled. Add OPENAI_API_KEY to the bot environment and restart.');
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      ...(process.env.OPENAI_MODEL ? {} : { reasoning: { effort: 'none' } }),
      instructions,
      input: input.slice(0, 12_000),
      max_output_tokens: maxOutputTokens,
      store: false,
    }),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`AI request failed (HTTP ${response.status}).`);
  const result = await response.json();
  const text = outputText(result);
  if (!text) throw new Error('AI returned an empty response.');
  return text;
}

async function limitedRequest(guildId, userId, request) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const usage = dailyCalls.get(guildId);
  if (activeGuilds.has(guildId)) throw new Error('Another AI request is already running in this server.');
  if (usage?.day === day && usage.count >= DAILY_REQUEST_LIMIT) {
    throw new Error('This server has reached its daily AI limit. Try again tomorrow (UTC).');
  }
  if (now - (recentCalls.get(key) || 0) < COOLDOWN_MS) {
    throw new Error('Please wait 30 seconds before another AI request.');
  }
  recentCalls.set(key, now);
  dailyCalls.set(guildId, { day, count: usage?.day === day ? usage.count + 1 : 1 });
  activeGuilds.add(guildId);
  try {
    return await request();
  } finally {
    activeGuilds.delete(guildId);
  }
}

function parseMusicIntent(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Could not understand the music request. Try /play or /music.');
  const intent = JSON.parse(match[0]);
  if (!['play', 'skip', 'pause', 'resume', 'queue'].includes(intent.action)) {
    throw new Error('Unsupported music action.');
  }
  if (intent.action === 'play' && (typeof intent.query !== 'string' || !intent.query.trim() || intent.query.length > 200)) {
    throw new Error('Could not identify a song or keyword.');
  }
  return { action: intent.action, query: intent.action === 'play' ? intent.query.trim() : null };
}

function formatFaq(faq) {
  return Object.values(faq).map(entry => `Q: ${entry.question}\nA: ${entry.answer}`).join('\n\n').slice(0, 8000);
}

async function readTicketMessages(channel, limit = 50) {
  const messages = await channel.messages.fetch({ limit });
  return [...messages.values()]
    .reverse()
    .filter(message => !message.author.bot && message.content?.trim())
    .map(message => `${message.author.username}: ${message.content.slice(0, 500)}`)
    .join('\n')
    .slice(0, 12_000);
}

module.exports = {
  assistantEnabled,
  formatFaq,
  limitedRequest,
  outputText,
  parseMusicIntent,
  readTicketMessages,
  requestAssistant,
};
