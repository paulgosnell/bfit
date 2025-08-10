export interface InlineKeyboardButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export interface ReplyMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface SendMessageOptions {
  chat_id: number | string;
  text: string;
  parse_mode?: "Markdown" | "HTML" | "MarkdownV2";
  reply_markup?: ReplyMarkup;
  disable_web_page_preview?: boolean;
}

export async function sendTelegramMessage(token: string, payload: SendMessageOptions): Promise<Response> {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  return await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function buildInlineKeyboard(rows: InlineKeyboardButton[][]): ReplyMarkup {
  return { inline_keyboard: rows };
}

export function short(text: string, max = 400): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function commandFromText(text?: string | null): { cmd: string; args: string } | null {
  if (!text) return null;
  if (!text.startsWith("/")) return null;
  const [first, ...rest] = text.trim().split(/\s+/);
  const cmd = first.split("@")[0].toLowerCase();
  const args = rest.join(" ");
  return { cmd, args };
}


