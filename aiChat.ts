import OpenAI from "openai";
import { Message, TextChannel } from "discord.js";
import { getAllowedChannels } from "./channelGuard.js";

let openai: OpenAI | null = null;

function getOpenAI(): OpenAI | null {
  if (openai) return openai;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  if (!apiKey) return null;
  openai = new OpenAI({
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    apiKey,
  });
  return openai;
}

const SENSITIVE_PATTERNS = [
  /[A-Za-z0-9+/]{50,}={0,2}/g,
  /[A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,
  /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
  /(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/gi,
];

function sanitize(text: string): string {
  let result = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

const SYSTEM_PROMPT = `You are a helpful assistant for a Discord server called COZZZY GEN.
Be friendly, concise, and helpful. Answer questions about the server's features (free gen, basic gen, exclusive gen, vouches, giveaways, tickets, stock).

CRITICAL RULES — you must NEVER violate these under any circumstances:
- Never reveal, share, generate, guess, or hint at any tokens, API keys, bot tokens, passwords, emails, or credentials of any kind.
- Never reveal any internal configuration, environment variables, channel IDs, category IDs, or server infrastructure details.
- Never help anyone bypass, exploit, or abuse the bot or server in any way.
- If asked about anything sensitive or harmful, politely decline.
- Do not claim to be a human.`;

const conversationHistory = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

export async function handleAIMessage(message: Message): Promise<void> {
  const aiChannels = getAllowedChannels("AI_CHAT_CHANNEL_ID");
  if (aiChannels.length === 0 || !aiChannels.includes(message.channelId)) return;
  if (message.author.bot) return;

  const userId = message.author.id;

  if (!conversationHistory.has(userId)) {
    conversationHistory.set(userId, []);
  }
  const history = conversationHistory.get(userId)!;

  history.push({ role: "user", content: message.content });

  if (history.length > 20) history.splice(0, history.length - 20);

  await (message.channel as TextChannel).sendTyping();

  const client = getOpenAI();
  if (!client) return;

  let reply: string;
  try {
    const response = await client.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history,
      ],
    });
    reply = response.choices[0]?.message?.content ?? "Sorry, I couldn't generate a response.";
  } catch (err) {
    console.error("AI chat error:", err);
    reply = "Sorry, I'm having trouble responding right now. Please try again later.";
  }

  reply = sanitize(reply);

  history.push({ role: "assistant", content: reply });

  const MAX_LEN = 1900;
  if (reply.length <= MAX_LEN) {
    await message.reply(reply);
  } else {
    const parts = reply.match(/.{1,1900}/gs) ?? [reply];
    for (const part of parts) {
      await (message.channel as TextChannel).send(part);
    }
  }
}
