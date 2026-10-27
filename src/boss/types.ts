/** 扩展页 → Service Worker 的读取请求类型。 */
export const BOSS_FETCH_MESSAGE = "boss.fetch-resume";

/**
 * 页面内捕获器挂在 window 上的属性名。
 * content/networkCapture.ts 与 boss/pageCapture.ts 都会被注入页面、无法共享导入，需各自写死同一字面量。
 */
export const BOSS_CAPTURE_GLOBAL = "__bossResumeCapture__";

/** BOSS 页面自己发出的一次 /wapi/ 请求的响应。path 只含 origin + pathname，不含查询串。 */
export interface BossCapturedResponse {
  path: string;
  status: number;
  body: unknown;
}

export interface BossCaptureResult {
  /** 只保留 origin + pathname，避免把查询串里的参数带出页面。 */
  pageUrl: string;
  /** false：页面在扩展加载前就已打开，捕获脚本未注入。 */
  hooked: boolean;
  entries: BossCapturedResponse[];
}

export type BossFetchErrorCode =
  | "EXTENSION_ONLY"
  | "NO_TAB"
  | "NO_DATA"
  | "PAGE_UNAVAILABLE"
  | "NOT_LOGGED_IN"
  | "SECURITY_BLOCKED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "API_ERROR"
  | "UNEXPECTED_RESPONSE";

export interface BossFetchError {
  code: BossFetchErrorCode;
  message: string;
  detail?: string;
}

export type BossFetchMessageResponse =
  | { ok: true; capture: BossCaptureResult }
  | { ok: false; error: BossFetchError };
