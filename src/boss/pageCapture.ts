import type { BossCapturedResponse, BossCaptureResult } from "./types";

/**
 * 在 BOSS 页面主世界中执行（chrome.scripting.executeScript, world: "MAIN"）。
 *
 * - 函数会被序列化后注入页面，不能引用模块作用域内的任何变量或导入。
 * - 只读取 content/networkCapture.ts 已记录的响应，不发起任何请求。
 * - 等页面请求静默 quietMs 后返回；最长等待 maxMs。
 */
export async function collectBossCaptureInPage(quietMs: number, maxMs: number): Promise<BossCaptureResult> {
  type Snapshot = { inflight: number; lastAt: number; entries: BossCapturedResponse[] };
  const host = window as unknown as Record<string, unknown>;
  const api = host["__bossResumeCapture__"] as { snapshot?: () => Snapshot } | undefined;
  const pageUrl = `${location.origin}${location.pathname}`;

  // 页面若把初始数据直接渲染在全局变量里，一并带上（按接口信封包装，便于统一处理）。
  const pageGlobals = (): BossCapturedResponse[] =>
    ["__INITIAL_STATE__", "__NUXT__", "__NEXT_DATA__", "__PRELOADED_STATE__"].flatMap((name) => {
      const value = host[name];
      if (!value || typeof value !== "object") return [];
      try {
        return [{ path: `window.${name}`, status: 200, body: { code: 0, zpData: JSON.parse(JSON.stringify(value)) } }];
      } catch {
        return [];
      }
    });

  if (!api?.snapshot) return { pageUrl, hooked: false, entries: pageGlobals() };

  const startedAt = Date.now();
  for (;;) {
    const snapshot = api.snapshot();
    const now = Date.now();
    const settled = snapshot.entries.length > 0 && snapshot.inflight === 0 && now - snapshot.lastAt >= quietMs;
    if (settled || now - startedAt >= maxMs) {
      return { pageUrl, hooked: true, entries: [...snapshot.entries, ...pageGlobals()] };
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}
