import { afterEach, describe, expect, it, vi } from "vitest";
import { LinkError, extractUrls, readLinkMaterial, toMaterialText } from "../../src/ai/linkMaterial";

function mockFetch(response: Response | (() => Promise<Response>)): void {
  vi.stubGlobal("fetch", typeof response === "function" ? response : async () => response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("extractUrls", () => {
  it("取出链接并去掉结尾标点", () => {
    expect(extractUrls("看看这个 https://cv.sloan.dpdns.org/s/abc-123，补充一下。")).toEqual([
      "https://cv.sloan.dpdns.org/s/abc-123",
    ]);
    expect(extractUrls("（见 https://example.com/jd?id=1）")).toEqual(["https://example.com/jd?id=1"]);
    expect(extractUrls("[简历](https://example.com/r/9).")).toEqual(["https://example.com/r/9"]);
  });

  it("去重、只要 http(s)、最多四条", () => {
    const text = [
      "https://a.com/1",
      "https://a.com/1",
      "ftp://a.com/2",
      "https://a.com/3",
      "https://a.com/4",
      "https://a.com/5",
      "https://a.com/6",
    ].join(" ");
    expect(extractUrls(text)).toEqual(["https://a.com/1", "https://a.com/3", "https://a.com/4", "https://a.com/5"]);
  });

  it("没有链接时返回空数组", () => {
    expect(extractUrls("把工作经历改成分点描述")).toEqual([]);
  });
});

describe("toMaterialText", () => {
  it("json 展开成缩进格式", () => {
    expect(toMaterialText("application/json; charset=utf-8", '{"name":"王贤龙","skills":["Java"]}')).toContain('"name": "王贤龙"');
  });

  it("html 去标签只留正文", () => {
    const text = toMaterialText("text/html", "<h1>个人优势</h1><p>三年 Java 经验</p><script>var a=1</script>");
    expect(text).toBe("个人优势\n三年 Java 经验");
  });

  it("普通文本只整理空行", () => {
    expect(toMaterialText("text/plain", "第一行\r\n\r\n\r\n\r\n第二行")).toBe("第一行\n\n第二行");
  });
});

describe("readLinkMaterial", () => {
  it("服务端渲染的页面直接读成材料", async () => {
    const body = `<html><head><title>王贤龙 · 在线简历</title></head><body><p>${"三年 Java 后端开发经验。".repeat(20)}</p></body></html>`;
    mockFetch(new Response(body, { status: 200, headers: { "content-type": "text/html" } }));
    const material = await readLinkMaterial("https://example.com/s/1");
    expect(material.name).toBe("https://example.com/s/1");
    expect(material.text).toContain("标题：王贤龙 · 在线简历");
    expect(material.text).toContain("三年 Java 后端开发经验。");
  });

  it("只有标题的空壳页面报错，而不是把标题当内容", async () => {
    mockFetch(new Response("<html><head><title>CV Builder</title></head><body><div id=\"app\"></div></body></html>", { status: 200, headers: { "content-type": "text/html" } }));
    await expect(readLinkMaterial("https://example.com/s/empty")).rejects.toBeInstanceOf(LinkError);
  });

  it("网站返回错误码时把状态码说清楚", async () => {
    mockFetch(new Response("forbidden", { status: 403 }));
    await expect(readLinkMaterial("https://example.com/private")).rejects.toThrow("网站返回 403");
  });

  it("请求直接失败时也会抛出可读的错误", async () => {
    mockFetch(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(readLinkMaterial("https://example.com/down")).rejects.toThrow(LinkError);
  });
});
