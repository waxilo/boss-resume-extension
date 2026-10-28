import { buildStructureSample } from "./structureSample";

/**
 * 上传接口录制：账号所有者在直聘简历页手动新建并保存一份简历时，记录页面自己发出的请求，
 * 脱敏后导出为样本，用来确认新建接口、请求体、响应与错误码。扩展自身不发起任何 BOSS 请求。
 *
 * 数据流：content/networkCapture.ts（MAIN）→ window.postMessage → content/captureBridge.ts（ISOLATED）
 * → Service Worker：sanitizeRecord 脱敏后写入 chrome.storage.session，原始值不落盘。
 * 两个内容脚本是普通脚本、不能导入本模块，消息类型字面量需与这里保持一致。
 */

export const RECORD_START_MESSAGE = "boss.record.start";
export const RECORD_STOP_MESSAGE = "boss.record.stop";
export const RECORD_STATUS_MESSAGE = "boss.record.status";
export const RECORD_APPEND_MESSAGE = "boss.record.append";
/** Service Worker → 内容脚本：录制开关变化。 */
export const RECORD_STATE_MESSAGE = "boss.record.state";

/** 直聘简历：可新建多份简历的页面，上传的目标。 */
export const RECORD_PAGE_URL = "https://cv.zhipin.com/my-resumes/";
export const MAX_RECORDED_REQUESTS = 200;
const MAX_MESSAGE_CHARS = 120;

export type RawRecordBody =
  | { kind: "none" }
  | { kind: "text"; text: string }
  | { kind: "entries"; entries: Array<[string, string]> }
  | { kind: "binary" };

/** 页面发来的一条原始请求记录；请求头只有名字（content-type 带值），不含 Cookie。 */
export interface RawRequestRecord {
  method: string;
  url: string;
  headerNames: string[];
  contentType?: string;
  requestBody: RawRecordBody;
  status: number;
  responseText: string;
  at: number;
}

export type RecordedBodyKind = "none" | "json" | "form" | "text" | "binary";

/** 脱敏后的一条请求：只有结构与格式，没有个人内容。 */
export interface RecordedRequest {
  offsetMs: number;
  method: string;
  /** origin + pathname，路径中疑似 ID 的段替换为 {id}。 */
  path: string;
  query: unknown;
  headerNames: string[];
  contentType?: string;
  bodyKind: RecordedBodyKind;
  requestBody: unknown;
  status: number;
  /** BOSS 接口信封里的 code / message 原样保留：错误码与提示（如份数已满）是录制的目的之一。 */
  responseCode?: number;
  responseMessage?: string;
  responseBody: unknown;
}

export interface RecordingStatus {
  recording: boolean;
  startedAt?: string;
  count: number;
}

export interface RecordingSample {
  kind: "boss-upload-recording";
  version: 1;
  startedAt: string;
  stoppedAt: string;
  truncated: boolean;
  requests: RecordedRequest[];
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function isRawBody(value: unknown): value is RawRecordBody {
  if (!isObject(value)) return false;
  switch (value.kind) {
    case "none":
    case "binary":
      return true;
    case "text":
      return typeof value.text === "string";
    case "entries":
      return Array.isArray(value.entries) && value.entries.every((pair) => Array.isArray(pair) && pair.length === 2 && pair.every((part) => typeof part === "string"));
    default:
      return false;
  }
}

/** 内容脚本的消息来自网页环境，逐字段校验后才处理。 */
export function isRawRequestRecord(value: unknown): value is RawRequestRecord {
  return (
    isObject(value) &&
    typeof value.method === "string" &&
    typeof value.url === "string" &&
    Array.isArray(value.headerNames) &&
    value.headerNames.every((name) => typeof name === "string") &&
    (value.contentType === undefined || typeof value.contentType === "string") &&
    isRawBody(value.requestBody) &&
    typeof value.status === "number" &&
    typeof value.responseText === "string" &&
    typeof value.at === "number"
  );
}

/** 同名键合并为数组，保持表单原始形态（如 skills=a&skills=b）。 */
function entriesToObject(entries: Iterable<[string, string]>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of entries) {
    const existing = result[key];
    if (existing === undefined) result[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else result[key] = [existing, value];
  }
  return result;
}

function tryJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch {
    return { ok: false };
  }
}

/** 表单字段的值常是 JSON 字符串（如 data={"name":…}），展开后才看得到结构。 */
function expandJsonValues(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => {
      if (typeof item !== "string") return [key, item];
      const parsed = tryJson(item);
      return [key, parsed.ok ? parsed.value : item];
    }),
  );
}

export function parseRequestBody(body: RawRecordBody, contentType?: string): { kind: RecordedBodyKind; value: unknown } {
  switch (body.kind) {
    case "none":
      return { kind: "none", value: null };
    case "binary":
      return { kind: "binary", value: null };
    case "entries":
      return { kind: "form", value: expandJsonValues(entriesToObject(body.entries)) };
    case "text": {
      const json = tryJson(body.text);
      if (json.ok) return { kind: "json", value: json.value };
      const looksLikeForm = /urlencoded/i.test(contentType ?? "") || /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(body.text);
      if (looksLikeForm) return { kind: "form", value: expandJsonValues(entriesToObject(new URLSearchParams(body.text))) };
      return { kind: "text", value: body.text };
    }
  }
}

/** 路径段若像 ID（长数字、长随机串），替换为 {id}，避免把简历或账号标识带出。 */
export function maskPath(url: string): { path: string; query: Record<string, unknown> } | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const pathname = parsed.pathname
    .split("/")
    .map((segment) => {
      const [, stem, extension] = /^(.*?)(\.[A-Za-z]{2,5})?$/.exec(segment) ?? [, segment, undefined];
      const looksLikeId = /^\d{6,}$/.test(stem ?? "") || /^[A-Za-z0-9_~-]{24,}$/.test(stem ?? "");
      return looksLikeId ? `{id}${extension ?? ""}` : segment;
    })
    .join("/");
  return { path: `${parsed.origin}${pathname}`, query: entriesToObject(parsed.searchParams) };
}

/** Service Worker 调用：把页面原始记录变成只含结构的记录。不在 zhipin.com 下的记录丢弃。 */
export function sanitizeRecord(raw: RawRequestRecord, startedAtMs: number): RecordedRequest | undefined {
  const location = maskPath(raw.url);
  if (!location || !/(^|\.)zhipin\.com$/.test(new URL(location.path).hostname)) return undefined;

  const body = parseRequestBody(raw.requestBody, raw.contentType);
  const response = tryJson(raw.responseText);
  const envelope = response.ok && isObject(response.value) ? response.value : undefined;
  const message = envelope?.message;

  return {
    offsetMs: Math.max(0, raw.at - startedAtMs),
    method: raw.method.toUpperCase(),
    path: location.path,
    query: buildStructureSample(location.query),
    headerNames: [...new Set(raw.headerNames.map((name) => name.toLowerCase()))].sort(),
    contentType: raw.contentType?.slice(0, 100),
    bodyKind: body.kind,
    requestBody: buildStructureSample(body.value),
    status: raw.status,
    responseCode: typeof envelope?.code === "number" ? envelope.code : undefined,
    responseMessage: typeof message === "string" && message.length <= MAX_MESSAGE_CHARS ? message : undefined,
    responseBody: response.ok ? buildStructureSample(response.value) : raw.responseText ? `<non-json:${raw.responseText.length}>` : null,
  };
}
