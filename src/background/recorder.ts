import {
  MAX_RECORDED_REQUESTS,
  RECORD_STATE_MESSAGE,
  isRawRequestRecord,
  sanitizeRecord,
  type RecordedRequest,
  type RecordingSample,
  type RecordingStatus,
} from "../boss/recording";

/**
 * 上传接口录制的 Service Worker 侧：状态与脱敏后的记录放在 chrome.storage.session，
 * 浏览器关闭即清空；Service Worker 被回收后重启也能接着录。原始记录只在内存里经过 sanitizeRecord。
 */

const STATE_KEY = "record:state";
const ITEMS_KEY = "record:items";

interface StoredState {
  recording: boolean;
  startedAt?: string;
  truncated?: boolean;
}

/** 追加记录与开关操作串行执行，避免并发读改写丢条目。 */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

async function readState(): Promise<{ state: StoredState; items: RecordedRequest[] }> {
  const stored = await chrome.storage.session.get([STATE_KEY, ITEMS_KEY]);
  return {
    state: (stored[STATE_KEY] as StoredState | undefined) ?? { recording: false },
    items: (stored[ITEMS_KEY] as RecordedRequest[] | undefined) ?? [],
  };
}

/** 通知所有 BOSS 标签页的桥接脚本；没注入桥接脚本的标签页会报错，忽略即可。 */
async function broadcast(recording: boolean): Promise<void> {
  const tabs = await chrome.tabs.query({ url: ["https://*.zhipin.com/*"] });
  await Promise.all(
    tabs.map((tab) => (tab.id === undefined ? undefined : chrome.tabs.sendMessage(tab.id, { type: RECORD_STATE_MESSAGE, recording }).catch(() => undefined))),
  );
}

export function getRecordingStatus(): Promise<RecordingStatus> {
  return serial(async () => {
    const { state, items } = await readState();
    return { recording: state.recording, startedAt: state.startedAt, count: items.length };
  });
}

/** 开始录制：清空上一轮记录。 */
export function startRecording(): Promise<RecordingStatus> {
  return serial(async () => {
    const startedAt = new Date().toISOString();
    await chrome.storage.session.set({ [STATE_KEY]: { recording: true, startedAt } satisfies StoredState, [ITEMS_KEY]: [] });
    await broadcast(true);
    return { recording: true, startedAt, count: 0 };
  });
}

/** 结束录制并返回样本；记录随之清空，样本只交给扩展页下载。 */
export function stopRecording(): Promise<RecordingSample | null> {
  return serial(async () => {
    const { state, items } = await readState();
    await chrome.storage.session.remove([STATE_KEY, ITEMS_KEY]);
    await broadcast(false);
    // 返回 null 而不是 undefined：扩展页靠 undefined 判断“后台没回应”。
    if (!state.startedAt) return null;
    return {
      kind: "boss-upload-recording",
      version: 1,
      startedAt: state.startedAt,
      stoppedAt: new Date().toISOString(),
      truncated: state.truncated === true,
      requests: items,
    };
  });
}

/** 桥接脚本交来的原始记录：校验结构、脱敏后追加；未在录制时直接丢弃。 */
export function appendRecord(raw: unknown): Promise<void> {
  return serial(async () => {
    if (!isRawRequestRecord(raw)) return;
    const { state, items } = await readState();
    if (!state.recording || !state.startedAt) return;
    const startedAtMs = Date.parse(state.startedAt);
    // 页面加载初期暂存的记录可能早于开始录制，不属于本轮。
    if (raw.at < startedAtMs) return;
    if (items.length >= MAX_RECORDED_REQUESTS) {
      if (!state.truncated) await chrome.storage.session.set({ [STATE_KEY]: { ...state, truncated: true } });
      return;
    }
    const sanitized = sanitizeRecord(raw, startedAtMs);
    if (!sanitized) return;
    await chrome.storage.session.set({ [ITEMS_KEY]: [...items, sanitized] });
  });
}
