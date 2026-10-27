/**
 * 在 BOSS 页面主世界 document_start 注入（manifest content_scripts, world: "MAIN"）。
 *
 * 被动记录页面自身发出的 zhipin.com /wapi/ JSON 响应，供扩展“从 BOSS 获取”时读取：
 * - 不发起任何请求，不读取 Cookie，不改动请求或响应；
 * - 只记录 origin + pathname，丢弃查询串；
 * - 只保留形如 {code: number, ...} 的 JSON，条数与单条大小有上限。
 *
 * 本文件不能有运行时 import：它以普通脚本形式注入。
 */
export {};

const GLOBAL_KEY = "__bossResumeCapture__";
const MAX_ENTRIES = 60;
const MAX_BODY_CHARS = 512 * 1024;

interface Entry {
  path: string;
  status: number;
  body: unknown;
}

const host = window as unknown as Record<string, unknown>;

if (!host[GLOBAL_KEY]) {
  const entries: Entry[] = [];
  let inflight = 0;
  let lastAt = Date.now();

  const acceptedPath = (url: string | undefined): string | undefined => {
    if (!url) return undefined;
    try {
      const parsed = new URL(url, location.href);
      if (!/(^|\.)zhipin\.com$/.test(parsed.hostname) || !parsed.pathname.includes("/wapi/")) return undefined;
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return undefined;
    }
  };

  const record = (path: string, status: number, text: string): void => {
    if (!text || text.length > MAX_BODY_CHARS) return;
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return;
    }
    if (!body || typeof body !== "object" || typeof (body as { code?: unknown }).code !== "number") return;
    entries.push({ path, status, body });
    if (entries.length > MAX_ENTRIES) entries.shift();
  };

  const settle = (): void => {
    inflight = Math.max(0, inflight - 1);
    lastAt = Date.now();
  };

  const nativeFetch = window.fetch;
  window.fetch = function captureFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const promise = nativeFetch.call(window, input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = acceptedPath(url);
    if (!path) return promise;
    inflight += 1;
    promise
      .then((response) => response.clone().text().then((text) => record(path, response.status, text)))
      .catch(() => undefined)
      .finally(settle);
    return promise;
  };

  const xhrUrls = new WeakMap<XMLHttpRequest, string>();
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function captureOpen(this: XMLHttpRequest, ...args: unknown[]): void {
    xhrUrls.set(this, String(args[1]));
    (nativeOpen as (...rest: unknown[]) => void).apply(this, args);
  };
  XMLHttpRequest.prototype.send = function captureSend(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    const path = acceptedPath(xhrUrls.get(this));
    if (path) {
      inflight += 1;
      this.addEventListener("loadend", () => {
        try {
          const text =
            this.responseType === "" || this.responseType === "text"
              ? this.responseText
              : this.responseType === "json"
                ? JSON.stringify(this.response)
                : "";
          record(path, this.status, text);
        } catch {
          // 响应不可读时忽略，不影响页面。
        }
        settle();
      });
    }
    nativeSend.call(this, body);
  };

  Object.defineProperty(host, GLOBAL_KEY, {
    configurable: false,
    enumerable: false,
    value: Object.freeze({
      snapshot: () => ({ inflight, lastAt, entries: entries.map((entry) => ({ ...entry })) }),
    }),
  });
}
