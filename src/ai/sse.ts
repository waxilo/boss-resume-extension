/**
 * 按 SSE 规范逐个产出事件的 data 内容。
 *
 * - 行尾兼容 \n、\r\n、\r；网络分包可能把一行（甚至 \r\n 本身）切到两个 chunk 里，未结束的部分留在缓冲区；
 * - 以 `:` 开头的是注释行（如 kiro2api 的 `: keepalive` 心跳），直接忽略；
 * - 同一事件的多行 data 用 \n 拼接，空行表示事件结束；
 * - 流结束时还没遇到空行的事件也照常产出。
 */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];

  function* consume(line: string): Generator<string> {
    if (line === "") {
      if (data.length) yield data.join("\n");
      data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    if (field !== "data") return;
    const value = colon < 0 ? "" : line.slice(colon + 1);
    data.push(value.startsWith(" ") ? value.slice(1) : value);
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // 末尾单独的 \r 可能是被切开的 \r\n，等下一个 chunk 再判断
      const held = !done && buffer.endsWith("\r") ? "\r" : "";
      const lines = (held ? buffer.slice(0, -1) : buffer).split(/\r\n|\r|\n/);
      buffer = (done ? "" : (lines.pop() ?? "")) + held;
      for (const line of lines) yield* consume(line);
      if (done) {
        yield* consume("");
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
