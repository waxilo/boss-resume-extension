import { BossResumeAdapter, type BossAdaptOutcome } from "./resumeAdapter";
import { BOSS_FETCH_MESSAGE, BOSS_LIST_MESSAGE, type BossFetchError, type BossPageOutcome, type CvResumeList } from "./types";
import { BOSS_UPLOAD_MESSAGE, type BossUploadResult, type UploadPlan } from "./uploadPlan";
import {
  RECORD_START_MESSAGE,
  RECORD_STATUS_MESSAGE,
  RECORD_STOP_MESSAGE,
  type RecordingSample,
  type RecordingStatus,
} from "./recording";

const inExtension = (): boolean => typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
const EXTENSION_ONLY: BossFetchError = { code: "EXTENSION_ONLY", message: "请在已加载的浏览器扩展中使用“从 BOSS 获取”" };
const NO_RESPONSE: BossFetchError = { code: "PAGE_UNAVAILABLE", message: "扩展后台没有响应，请在扩展管理页重新加载扩展后重试" };

/** 后台没有回应时 sendMessage 返回 undefined，必须当作失败，不能当作结果交给界面。 */
async function recordCall<T>(type: string): Promise<T> {
  if (!inExtension()) throw new Error("请在已加载的浏览器扩展中使用录制功能");
  const response = (await chrome.runtime.sendMessage({ type })) as (T & { error?: string }) | undefined;
  if (response === undefined) throw new Error(NO_RESPONSE.message);
  if (response && typeof response === "object" && "error" in response && response.error) throw new Error(response.error);
  return response as T;
}

export const getRecordingStatus = (): Promise<RecordingStatus> => recordCall<RecordingStatus>(RECORD_STATUS_MESSAGE);
export const startRecording = (): Promise<RecordingStatus> => recordCall<RecordingStatus>(RECORD_START_MESSAGE);
/** null：当前没有进行中的录制。 */
export const stopRecording = (): Promise<RecordingSample | null> => recordCall<RecordingSample | null>(RECORD_STOP_MESSAGE);

async function pageCall<T>(message: Record<string, unknown>): Promise<BossPageOutcome<T>> {
  if (!inExtension()) return { ok: false, error: EXTENSION_ONLY };
  const response = (await chrome.runtime.sendMessage(message)) as BossPageOutcome<T> | undefined;
  if (!response || typeof response !== "object" || !("ok" in response)) return { ok: false, error: NO_RESPONSE };
  return response;
}

/** 扩展页调用：列出直聘简历（cv.zhipin.com/my-resumes/）里的全部简历。 */
export function listBossResumes(): Promise<BossPageOutcome<CvResumeList>> {
  return pageCall<CvResumeList>({ type: BOSS_LIST_MESSAGE });
}

/** 扩展页调用：读取一份直聘简历并转换为本地字段。 */
export async function fetchBossResume(cvId: string): Promise<BossAdaptOutcome> {
  const response = await pageCall<unknown>({ type: BOSS_FETCH_MESSAGE, cvId });
  return response.ok ? BossResumeAdapter.adaptDetail(cvId, response.data) : response;
}

/** 扩展页调用：经 Service Worker 在直聘简历新建一份简历并按计划填写。 */
export async function uploadBossResume(plan: UploadPlan): Promise<BossUploadResult> {
  if (!inExtension()) {
    return { ok: false, error: { code: "EXTENSION_ONLY", message: "请在已加载的浏览器扩展中使用“上传到 BOSS”" }, warnings: [] };
  }
  // 计划要跨进程传递，先去掉 Vue 代理。
  const payload = JSON.parse(JSON.stringify(plan)) as UploadPlan;
  const response = (await chrome.runtime.sendMessage({ type: BOSS_UPLOAD_MESSAGE, plan: payload })) as BossUploadResult | undefined;
  if (!response || typeof response !== "object" || !("ok" in response)) {
    return { ok: false, error: { code: "NO_TAB", message: NO_RESPONSE.message }, warnings: [] };
  }
  return response;
}
