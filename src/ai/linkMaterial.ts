/**
 * 把用户粘贴的链接读成「补充材料」。
 *
 * 模型本身不能上网，所以链接必须在扩展里先取成文字再随请求送出。两条路：
 * 1. 后台直接请求（快，适合服务端渲染的页面、json、纯文本）；
 * 2. 拿不到正文时，在后台开一个隐藏标签页按真实浏览器渲染，再读 innerText
 *    （前端渲染的分享页、需要登录态的页面只能这么读），读完立刻关掉。
 */

import { MATERIAL_LIMITS, createMaterial, stripHtml, tidy, type ResumeMaterial } from "./materials";
import { ensureHostPermission } from "./settings";

export const LINK_LIMITS = {
  /** 一次最多读几条链接，多余的当普通文字发给模型。 */
  urls: 4,
  /** 直接请求的超时时间。 */
  timeoutMs: 15000,
  /** 用标签页渲染时最多再等多久（内容晚于 load 出现）。 */
  renderMs: 15000,
  /** 下载体积上限，超过就截断。 */
  bytes: MATERIAL_LIMITS.fileBytes,
  /** 页面正文少于这么多字就认为没读到，改用标签页渲染。 */
  minChars: 180,
} as const;

export class LinkError extends Error {}

/** 正文少于这么多字就当没读到，视为无效链接。 */
const MIN_CONTENT_CHARS = 40;

/** 从一段文字里找出 http(s) 链接：遇到中文就停、去掉结尾标点、去重、限量。 */
export function extractUrls(text: string): string[] {
  const matched = text.match(/https?:\/\/[^\s<>"'`\u3000-\u303f\u4e00-\u9fff\uff01-\uff60]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const raw of matched) {
    const cleaned = raw.replace(/[.,;:!?)\]}>'"”，。；：！？）】」』、]+$/u, "");
    if (!cleaned) continue;
    let url: URL;
    try {
      url = new URL(cleaned);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    const key = url.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(key);
    if (urls.length >= LINK_LIMITS.urls) break;
  }
  return urls;
}

/** 把响应正文转成材料文本：json 展开成缩进格式，html 去标签，其余直接整理。 */
export function toMaterialText(contentType: string, body: string): string {
  const type = contentType.toLowerCase();
  if (type.includes("json")) {
    try {
      return tidy(JSON.stringify(JSON.parse(body), null, 2));
    } catch {
      // 不是合法 json，按普通文本处理
    }
  }
  if (type.includes("html") || /^\s*<(?:!doctype|html)/i.test(body)) return tidy(stripHtml(body));
  return tidy(body);
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function titleFromHtml(html: string): string {
  const matched = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return matched ? decodeEntities(matched[1]).replace(/\s+/g, " ").trim() : "";
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 只读到体积上限，避免把大文件整个吞进内存。 */
async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (size >= LINK_LIMITS.bytes) {
      await reader.cancel();
      break;
    }
  }
  return text + decoder.decode();
}

interface PageContent {
  title: string;
  text: string;
}

/** 直接请求：网络不通、跨域被挡时返回 undefined，交给标签页渲染。 */
async function fetchDirect(url: string): Promise<PageContent | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LINK_LIMITS.timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, credentials: "include", redirect: "follow" });
    if (!response.ok) throw new LinkError(`网站返回 ${response.status}，可能需要登录或链接已失效`);
    const contentType = response.headers.get("content-type") ?? "";
    const body = await readLimited(response);
    return { title: titleFromHtml(body), text: toMaterialText(contentType, body) };
  } catch (error) {
    if (error instanceof LinkError) throw error;
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForLoad(tabId: number): Promise<void> {
  const deadline = Date.now() + LINK_LIMITS.timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    if (!tab || tab.status === "complete") return;
    await sleep(250);
  }
}

/**
 * 在隐藏标签页里渲染页面再读正文。前端渲染的页面，正文会晚于 load 事件出现，
 * 所以反复读取，直到长度连续两次不变（或超时），取最长的那次。
 *
 * 简历预览类页面常把正文放在同源 iframe 里（父页面只有工具栏），
 * 所以要连 iframe 一起读，然后把完全相同的分页去掉。
 */
async function renderInTab(url: string): Promise<PageContent | undefined> {
  if (typeof chrome === "undefined" || !chrome.tabs?.create || !chrome.scripting?.executeScript) return undefined;
  const tab = await chrome.tabs.create({ url, active: false }).catch(() => undefined);
  const tabId = tab?.id;
  if (tabId === undefined) return undefined;
  try {
    await waitForLoad(tabId);
    let title = "";
    let best = "";
    let previousLength = -1;
    const deadline = Date.now() + LINK_LIMITS.renderMs;
    while (Date.now() < deadline) {
      await sleep(500);
      let content: PageContent | undefined;
      try {
        const [injected] = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            const read = (doc: Document | null): string => (doc?.body ? doc.body.innerText : "").trim();
            const frames: string[] = [];
            for (const frame of Array.from(document.querySelectorAll("iframe"))) {
              try {
                const text = read(frame.contentDocument);
                if (text) frames.push(text);
              } catch {
                // 跨域 iframe 读不到，忽略
              }
            }
            const frameText = [...new Set(frames)].join("\n\n");
            // 正文在 iframe 里时，父页面剩下的多半是工具栏文字，不掺进来
            const own = read(document);
            return {
              title: document.title,
              text: frameText.length >= 200 ? frameText : [own, frameText].filter(Boolean).join("\n\n"),
            };
          },
        });
        content = injected?.result as PageContent | undefined;
      } catch {
        // 页面被导航或还没准备好，下一轮再试
      }
      if (!content) continue;
      title = content.title || title;
      const text = tidy(content.text ?? "");
      if (text.length > best.length) best = text;
      if (best.length >= LINK_LIMITS.minChars && best.length === previousLength) break;
      previousLength = best.length;
    }
    return best ? { title, text: best } : undefined;
  } finally {
    await chrome.tabs.remove(tabId).catch(() => undefined);
  }
}

/**
 * 读一条链接。失败时抛 LinkError，message 直接可以给用户看。
 * materials 里的 name 用链接本身：重复读同一条链接时按名字覆盖，不会越堆越多。
 */
export async function readLinkMaterial(url: string): Promise<ResumeMaterial> {
  if (!(await ensureHostPermission(url))) throw new LinkError("没有获得访问这个网站的权限");
  let content = await fetchDirect(url);
  if (!content || content.text.length < LINK_LIMITS.minChars) {
    const rendered = await renderInTab(url);
    // 渲染结果一般更全，但拿不到时保留直接请求的结果
    if (rendered && rendered.text.length > (content?.text.length ?? 0)) {
      content = { title: rendered.title || content?.title || "", text: rendered.text };
    }
  }
  const text = content?.text.trim() ?? "";
  if (!text) throw new LinkError("页面里没有读到文字，可能需要登录，或者内容由脚本加载");
  if (text.length < MIN_CONTENT_CHARS) throw new LinkError("这个链接里只有页面标题，没有读到正文内容");
  const heading = content?.title ? `标题：${content.title}\n\n` : "";
  return createMaterial(url, `${heading}${text}`);
}
