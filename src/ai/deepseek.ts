import type { AiSettings } from "./settings";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AiError extends Error {}

export interface ChatOptions {
  signal?: AbortSignal;
  maxTokens?: number;
}

const STATUS_MESSAGE: Record<number, string> = {
  400: "请求格式错误，请检查模型名称",
  401: "API Key 无效，请到 AI 设置里重新填写",
  402: "DeepSeek 账户余额不足",
  403: "接口拒绝了这次请求，请在接口服务里放行浏览器扩展来源",
  422: "请求参数错误，请检查模型名称",
  429: "请求太频繁，请稍后再试",
  500: "AI 服务出错，请稍后再试",
  503: "AI 服务繁忙，请稍后再试",
};

/**
 * 调用 OpenAI 兼容的 /chat/completions，开启 JSON Output，返回解析后的 JSON。
 * 提示词里必须出现「json」字样（DeepSeek JSON Output 的要求）。
 */
export async function chatJson(settings: AiSettings, messages: ChatMessage[], options: ChatOptions = {}): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`${settings.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        messages,
        response_format: { type: "json_object" },
        max_tokens: options.maxTokens ?? 8192,
        stream: false,
      }),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AiError("连不上 AI 接口，请检查网络和接口地址");
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = STATUS_MESSAGE[response.status] ?? `AI 接口返回错误（HTTP ${response.status}）`;
    throw new AiError(detail ? `${message}：${detail.slice(0, 200)}` : message);
  }

  const data = (await response.json().catch(() => undefined)) as
    | { choices?: Array<{ finish_reason?: string; message?: { content?: string | null } }> }
    | undefined;
  const choice = data?.choices?.[0];
  if (choice?.finish_reason === "length") throw new AiError("AI 输出太长被截断了，请把要求拆小一点再试");
  const content = choice?.message?.content?.trim();
  if (!content) throw new AiError("AI 返回了空内容，请重试");
  try {
    return JSON.parse(content) as unknown;
  } catch {
    throw new AiError("AI 返回的内容不是有效的 JSON，请重试");
  }
}

/** 用一次极小的请求验证 Key、地址和模型是否可用。 */
export async function pingAi(settings: AiSettings): Promise<void> {
  await chatJson(
    settings,
    [
      { role: "system", content: '只输出 json：{"ok": true}' },
      { role: "user", content: "ping" },
    ],
    { maxTokens: 20 },
  );
}
