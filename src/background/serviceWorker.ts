import { installCvApiInPage } from "../boss/cvPageApi";
import { cvResumeTaskInPage } from "../boss/pageFetch";
import { uploadResumeInPage } from "../boss/pageUpload";
import { BOSS_FETCH_MESSAGE, BOSS_LIST_MESSAGE, type BossFetchError, type BossPageOutcome } from "../boss/types";
import { BOSS_UPLOAD_MESSAGE, type BossUploadResult, type UploadPlan } from "../boss/uploadPlan";
import { RECORD_APPEND_MESSAGE, RECORD_START_MESSAGE, RECORD_STATUS_MESSAGE, RECORD_STOP_MESSAGE } from "../boss/recording";
import { appendRecord, getRecordingStatus, startRecording, stopRecording } from "./recorder";

const editorUrl = chrome.runtime.getURL("index.html");
const extensionOrigin = new URL(editorUrl).origin;

/** 直聘简历（可建多份简历）。读取、上传都在这个页面里调用它自己的接口。 */
const CV_PAGE_URL = "https://cv.zhipin.com/my-resumes/";
const CV_PAGE_HOST = "cv.zhipin.com";
const CV_TAB_PATTERNS = ["https://cv.zhipin.com/*"];
const TAB_LOAD_TIMEOUT_MS = 15_000;

chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: editorUrl });
});

function waitForTabComplete(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("直聘简历页加载超时"));
    }, TAB_LOAD_TIMEOUT_MS);
    const finish = (tab: chrome.tabs.Tab) => {
      cleanup();
      resolve(tab);
    };
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && info.status === "complete" && tab.url && tab.url !== "about:blank") finish(tab);
    };
    const onRemoved = (id: number) => {
      if (id !== tabId) return;
      cleanup();
      reject(new Error("直聘简历页被关闭"));
    };
    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      chrome.tabs.onRemoved.removeListener(onRemoved);
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.onRemoved.addListener(onRemoved);
    // 监听注册前页面可能已加载完成；新标签初始的 about:blank 带 pendingUrl，需排除。
    void chrome.tabs
      .get(tabId)
      .then((tab) => {
        if (tab.status === "complete" && !tab.pendingUrl && tab.url && tab.url !== "about:blank") finish(tab);
      })
      .catch(() => undefined);
  });
}

/** 已加载完成的直聘简历标签，当前激活的优先，其余按最近访问排序。 */
async function findCvTab(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ url: CV_TAB_PATTERNS });
  return tabs
    .filter((tab) => tab.id !== undefined && !tab.discarded && tab.status === "complete")
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0]?.id;
}

class CvPageError extends Error {
  public constructor(public readonly info: BossFetchError) {
    super(info.message);
  }
}

/**
 * 在直聘简历页的主世界里执行 func：先装请求工具，再执行任务。
 * reuseOpenTab 为 true 时优先用已打开的直聘简历标签；否则后台临时打开 my-resumes，执行完关闭。
 */
async function runInCvPage<A extends unknown[], R>(func: (...args: A) => Promise<R>, args: A, reuseOpenTab: boolean): Promise<R> {
  let tabId = reuseOpenTab ? await findCvTab() : undefined;
  let temporary: number | undefined;
  try {
    if (tabId === undefined) {
      const tab = await chrome.tabs.create({ url: CV_PAGE_URL, active: false }).catch((error: unknown) => {
        throw new CvPageError({ code: "NO_TAB", message: "无法打开直聘简历页，请手动打开 cv.zhipin.com/my-resumes/ 后重试", detail: String(error) });
      });
      if (tab.id === undefined) throw new CvPageError({ code: "NO_TAB", message: "无法打开直聘简历页" });
      tabId = temporary = tab.id;
      const loaded = await waitForTabComplete(tabId).catch((error: unknown) => {
        throw new CvPageError({ code: "NO_TAB", message: "直聘简历页没有打开成功，请稍后重试", detail: error instanceof Error ? error.message : String(error) });
      });
      // 未登录时会被跳到登录页等其他地址。
      const landed = loaded.url ? new URL(loaded.url) : undefined;
      if (!landed || landed.hostname !== CV_PAGE_HOST) {
        throw new CvPageError({ code: "NOT_LOGGED_IN", message: "直聘简历登录状态无效，请在浏览器中登录 BOSS 求职者账号后重试", detail: loaded.url });
      }
    }
    let result: unknown;
    try {
      await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: installCvApiInPage });
      // args 必须可序列化：undefined 会让 executeScript 报 Value is unserializable，先经 JSON 往返清掉。
      const safeArgs = JSON.parse(JSON.stringify(args)) as A;
      const [injection] = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func, args: safeArgs });
      result = injection?.result;
    } catch (error) {
      throw new CvPageError({
        code: "PAGE_UNAVAILABLE",
        message: "无法在直聘简历页中执行，请刷新直聘简历页后重试",
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    if (result === undefined) throw new CvPageError({ code: "PAGE_UNAVAILABLE", message: "直聘简历页没有返回结果，请刷新后重试" });
    return result as R;
  } finally {
    if (temporary !== undefined) await chrome.tabs.remove(temporary).catch(() => undefined);
  }
}

async function readCv(task: "list" | "detail", cvId?: string): Promise<BossPageOutcome<unknown>> {
  try {
    // executeScript 的 args 不能含 undefined（会报 Value is unserializable），列表任务传空串。
    return await runInCvPage(cvResumeTaskInPage, [task, cvId ?? ""] as ["list" | "detail", string], true);
  } catch (error) {
    return { ok: false, error: error instanceof CvPageError ? error.info : { code: "PAGE_UNAVAILABLE", message: String(error) } };
  }
}

/** 同一时间只允许一个上传任务，防止重复点击建出多份简历。 */
let uploading = false;

/** 后台临时打开直聘简历页，按计划新建并填写简历，完成后关闭。 */
async function uploadResume(plan: UploadPlan): Promise<BossUploadResult> {
  if (uploading) return { ok: false, error: { code: "API_ERROR", message: "已有一个上传任务在进行，请等它结束" }, warnings: [] };
  uploading = true;
  try {
    return await runInCvPage(uploadResumeInPage, [plan], false);
  } catch (error) {
    const info: BossFetchError = error instanceof CvPageError ? error.info : { code: "NO_TAB", message: String(error) };
    const code = info.code === "NOT_LOGGED_IN" ? "NOT_LOGGED_IN" : "NO_TAB";
    return { ok: false, error: { code, message: info.message, detail: info.detail }, warnings: [] };
  } finally {
    uploading = false;
  }
}

/**
 * 只有扩展自身页面能触发读取、上传与录制开关；网页无法冒充。
 * 编辑页是在标签页里打开的，sender.tab 一定存在，只能按 URL 来源判断。
 */
function fromExtensionPage(sender: chrome.runtime.MessageSender): boolean {
  return sender.id === chrome.runtime.id && !!sender.url?.startsWith(`${extensionOrigin}/`);
}

/** BOSS 页面里的桥接脚本（content/captureBridge.ts）。 */
function fromBossContentScript(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || !sender.tab || !sender.url) return false;
  try {
    return /(^|\.)zhipin\.com$/.test(new URL(sender.url).hostname);
  } catch {
    return false;
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse): boolean | void => {
  const data = message as { type?: unknown; record?: unknown; cvId?: unknown; plan?: unknown } | null;
  const reply = (task: Promise<unknown>): true => {
    void task.then(sendResponse, (error: unknown) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  };

  if (fromBossContentScript(sender)) {
    if (data?.type === RECORD_STATUS_MESSAGE) return reply(getRecordingStatus());
    if (data?.type === RECORD_APPEND_MESSAGE) return reply(appendRecord(data.record));
    return;
  }
  if (!fromExtensionPage(sender)) return;

  switch (data?.type) {
    case BOSS_LIST_MESSAGE:
      return reply(readCv("list"));
    case BOSS_FETCH_MESSAGE:
      if (typeof data.cvId !== "string" || !data.cvId) return reply(Promise.resolve({ ok: false, error: { code: "API_ERROR", message: "缺少要读取的简历" } }));
      return reply(readCv("detail", data.cvId));
    case BOSS_UPLOAD_MESSAGE:
      if (!data.plan || typeof data.plan !== "object") return reply(Promise.resolve({ ok: false, error: { code: "API_ERROR", message: "缺少上传内容" }, warnings: [] }));
      return reply(uploadResume(data.plan as UploadPlan));
    case RECORD_STATUS_MESSAGE:
      return reply(getRecordingStatus());
    case RECORD_START_MESSAGE:
      return reply(startRecording());
    case RECORD_STOP_MESSAGE:
      return reply(stopRecording());
    default:
      return;
  }
});
