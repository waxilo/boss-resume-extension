import { collectBossCaptureInPage } from "../boss/pageCapture";
import {
  BOSS_FETCH_MESSAGE,
  type BossCaptureResult,
  type BossFetchMessageResponse,
} from "../boss/types";

const editorUrl = chrome.runtime.getURL("index.html");
const extensionOrigin = new URL(editorUrl).origin;

/**
 * BOSS 在线简历页（求职者唯一的在线简历）。
 * 注意：cv.zhipin.com/my-resumes/ 是「直聘简历」模板工具（可建多份模板简历），只加载模板列表，不含在线简历数据。
 */
const RESUME_PAGE_URL = "https://www.zhipin.com/web/geek/resume";
const RESUME_PAGE_HOST = "www.zhipin.com";
const RESUME_PAGE_PATH = "/web/geek/resume";
const RESUME_TAB_PATTERNS = ["https://www.zhipin.com/web/geek/resume*"];
const TAB_LOAD_TIMEOUT_MS = 15_000;

/** 已打开的标签：捕获从页面加载起就在进行，短暂等待即可。 */
const EXISTING_TAB_WAIT = { quietMs: 600, maxMs: 2_500 };
/** 临时标签：页面刚加载，等待其接口请求静默。 */
const TEMP_TAB_WAIT = { quietMs: 1_500, maxMs: 15_000 };

chrome.action.onClicked.addListener(async () => {
  await chrome.tabs.create({ url: editorUrl });
});

/** 已加载完成的 BOSS 简历页，当前激活的优先，其余按最近访问排序。 */
async function findResumeTabs(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ url: RESUME_TAB_PATTERNS });
  return tabs
    .filter((tab) => tab.id !== undefined && !tab.discarded && tab.status === "complete")
    .sort((a, b) => Number(b.active) - Number(a.active) || (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
}

function waitForTabComplete(tabId: number): Promise<chrome.tabs.Tab> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("BOSS 页面加载超时"));
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
      reject(new Error("BOSS 页面被关闭"));
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

async function collectInTab(tabId: number, wait: { quietMs: number; maxMs: number }): Promise<BossFetchMessageResponse> {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: collectBossCaptureInPage,
      args: [wait.quietMs, wait.maxMs],
    });
    const capture = injection?.result as BossCaptureResult | undefined;
    if (!capture) {
      return { ok: false, error: { code: "PAGE_UNAVAILABLE", message: "BOSS 页面没有返回结果，请刷新 BOSS 简历页后重试" } };
    }
    return { ok: true, capture };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "PAGE_UNAVAILABLE",
        message: "无法在 BOSS 页面中执行读取，请刷新 BOSS 简历页后重试",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/** 后台临时打开 BOSS 简历页，等页面自身请求完简历数据后读取，读完立即关闭。 */
async function collectInTemporaryTab(): Promise<BossFetchMessageResponse> {
  let tabId: number | undefined;
  try {
    const tab = await chrome.tabs.create({ url: RESUME_PAGE_URL, active: false });
    tabId = tab.id;
    if (tabId === undefined) throw new Error("无法创建标签页");
    const loaded = await waitForTabComplete(tabId);
    // 未登录时会被跳到登录页等其他地址。
    const landed = loaded.url ? new URL(loaded.url) : undefined;
    if (!landed || landed.hostname !== RESUME_PAGE_HOST || !landed.pathname.startsWith(RESUME_PAGE_PATH)) {
      return { ok: false, error: { code: "NOT_LOGGED_IN", message: "BOSS 登录状态无效，请在浏览器中重新登录求职者账号", detail: loaded.url } };
    }
    return await collectInTab(tabId, TEMP_TAB_WAIT);
  } catch (error) {
    return {
      ok: false,
      error: {
        code: "NO_TAB",
        message: "无法打开 BOSS 简历页读取，请手动打开 www.zhipin.com/web/geek/resume 后重试",
        detail: error instanceof Error ? error.message : String(error),
      },
    };
  } finally {
    if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

async function fetchResume(): Promise<BossFetchMessageResponse> {
  // 已打开的简历页有数据就直接用；没装上捕获脚本（扩展加载前打开的）或没数据，改用临时标签。
  for (const tab of await findResumeTabs()) {
    const response = await collectInTab(tab.id!, EXISTING_TAB_WAIT);
    if (response.ok && response.capture.hooked && response.capture.entries.length > 0) return response;
  }
  return collectInTemporaryTab();
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse): boolean | void => {
  // 只接受扩展自身页面的请求，网页无法触发读取。
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(extensionOrigin)) return;
  if ((message as { type?: unknown } | null)?.type !== BOSS_FETCH_MESSAGE) return;

  void fetchResume().then(sendResponse);
  return true;
});
