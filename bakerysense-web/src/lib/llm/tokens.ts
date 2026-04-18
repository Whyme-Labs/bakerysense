const CHARS_PER_TOKEN = 3.5;
const PER_MESSAGE_OVERHEAD = 4;

export function approxTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function approxMessagesTokens(
  messages: Array<{ role: string; content: string | null | undefined }>,
): number {
  let n = 0;
  for (const m of messages) {
    n += PER_MESSAGE_OVERHEAD;
    n += approxTokens(m.content);
    n += approxTokens(m.role);
  }
  return n;
}
