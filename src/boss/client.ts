import { BossResumeAdapter, type BossAdaptOutcome } from "./resumeAdapter";
import { buildStructureSample } from "./structureSample";
import { BOSS_FETCH_MESSAGE, type BossCaptureResult, type BossFetchMessageResponse } from "./types";

export interface BossFetchOutcome {
  adapted: BossAdaptOutcome;
  /** 只含接口路径与字段结构的脱敏样本，用于校准适配器。 */
  structureSample?: unknown;
}

/** 接口路径与页面地址不含个人内容，原样保留；响应体只保留结构。 */
function structureOf(capture: BossCaptureResult): unknown {
  return {
    pageUrl: capture.pageUrl,
    hooked: capture.hooked,
    responses: capture.entries.map((entry) => ({
      path: entry.path,
      status: entry.status,
      structure: buildStructureSample(entry.body),
    })),
  };
}

/** 扩展页调用：经 Service Worker 读取 BOSS 简历页自身加载的数据。 */
export async function fetchBossResume(): Promise<BossFetchOutcome> {
  if (typeof chrome === "undefined" || !chrome.runtime?.id) {
    return {
      adapted: { ok: false, error: { code: "EXTENSION_ONLY", message: "请在已加载的浏览器扩展中使用“从 BOSS 获取”" } },
    };
  }

  const response = (await chrome.runtime.sendMessage({ type: BOSS_FETCH_MESSAGE })) as BossFetchMessageResponse | undefined;
  if (!response) {
    return { adapted: { ok: false, error: { code: "PAGE_UNAVAILABLE", message: "扩展后台没有响应，请重新加载扩展后重试" } } };
  }
  if (!response.ok) return { adapted: { ok: false, error: response.error } };

  return {
    adapted: BossResumeAdapter.adaptCapture(response.capture),
    structureSample: structureOf(response.capture),
  };
}
