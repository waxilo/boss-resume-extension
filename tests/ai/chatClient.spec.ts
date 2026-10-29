import { afterEach, describe, expect, it, vi } from "vitest";
import { chatJson, extractJsonObject } from "../../src/ai/chatClient";
import { readSseData } from "../../src/ai/sse";

const settings = { apiKey: "sk-test", baseUrl: "http://127.0.0.1:8080/openai/v1", model: "claude-opus-5" };

/** 把字符串按给定切点拆成多个网络 chunk，模拟分包。 */
function streamOf(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

function chunk(delta: Record<string, unknown>, finishReason: string | null = null): string {
  return `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`;
}

function stubSse(parts: string[]) {
  const fetchMock = vi.fn(async () => new Response(streamOf(parts), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const data of readSseData(stream)) out.push(data);
  return out;
}

describe("readSseData", () => {
  it("跨 chunk 断行、CRLF 被切开、注释行与多行 data", async () => {
    const events = await collect(streamOf([": keepalive\r\n\r\nda", "ta: a\r", "\ndata: b\r\n\r\ndata:c", "\n\n"]));
    expect(events).toEqual(["a\nb", "c"]);
  });

  it("流结束时没有空行的事件也产出", async () => {
    expect(await collect(streamOf(["data: tail"]))).toEqual(["tail"]);
  });
});

describe("chatJson", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("拼接 kiro2api 形状的流：role 首包、思维链、usage 尾包、[DONE]", async () => {
    const fetchMock = stubSse([
      chunk({ role: "assistant", content: "" }),
      chunk({ reasoning_content: "先想想" }),
      ": keepalive\n\n",
      chunk({ content: '```json\n{"reply": "好' }),
      chunk({ content: '的", "resume": null}\n```' }),
      chunk({}, "stop"),
      `data: ${JSON.stringify({ object: "chat.completion.chunk", choices: [], usage: { completion_tokens: 9 } })}\n\n`,
      "data: [DONE]\n\n",
    ]);
    await expect(chatJson(settings, [{ role: "user", content: "hi" }])).resolves.toEqual({ reply: "好的", resume: null });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.stream).toBe(true);
  });

  it("截断时报 length", async () => {
    stubSse([chunk({ content: '{"reply": "' }), chunk({}, "length"), "data: [DONE]\n\n"]);
    await expect(chatJson(settings, [])).rejects.toThrow("截断");
  });

  it("200 流里的 API Error 正文转成错误", async () => {
    stubSse([chunk({ role: "assistant", content: "" }), chunk({ content: "API Error: token expired" }), chunk({}, "stop"), "data: [DONE]\n\n"]);
    await expect(chatJson(settings, [])).rejects.toThrow("AI 接口返回错误：token expired");
  });

  it("流中的 error 对象转成错误", async () => {
    stubSse([`data: ${JSON.stringify({ error: { message: "overloaded" } })}\n\n`]);
    await expect(chatJson(settings, [])).rejects.toThrow("overloaded");
  });

  it("服务端忽略 stream 时按非流式解析", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok": true}' } }] })));
    await expect(chatJson(settings, [])).resolves.toEqual({ ok: true });
  });

  it("HTTP 错误带出 OpenAI 错误信封里的 message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: { message: "Invalid proxy API key." } }, { status: 401 })));
    await expect(chatJson(settings, [])).rejects.toThrow("API Key 无效，请到 AI 设置里重新填写：Invalid proxy API key.");
  });
});

describe("extractJsonObject", () => {
  it("去掉前后说明文字，字符串里的花括号不影响配对", () => {
    expect(extractJsonObject('好的，结果如下：{"reply": "用 {} 表示", "resume": null} 以上')).toEqual({ reply: "用 {} 表示", resume: null });
  });

  it("字符串里的裸换行也能解析", () => {
    expect(extractJsonObject('{"reply": "第一行\n第二行", "resume": null}')).toEqual({ reply: "第一行\n第二行", resume: null });
  });

  it("没有 JSON 时返回 undefined", () => {
    expect(extractJsonObject("抱歉，我无法处理")).toBeUndefined();
  });
});
