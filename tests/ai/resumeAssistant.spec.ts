import { afterEach, describe, expect, it, vi } from "vitest";
import { askResumeAssistant, summarizeChanges } from "../../src/ai/resumeAssistant";
import { applyAiResume, normalizeDate } from "../../src/ai/resumePatch";
import { createBlankResume } from "../../src/domain/factories";
import type { BossResumeDocument } from "../../src/domain/types";

function sample(): BossResumeDocument {
  const resume = createBlankResume({ now: "2026-10-28T00:00:00.000Z", createId: () => "r1" });
  resume.title = "Java 开发";
  resume.profile = { name: "张三", avatar: "https://img/a.png" };
  resume.bossCvId = "cv-1";
  resume.syncState = "synced";
  resume.workExperiences = [
    { localId: "work-1", companyName: "港证软件", positionName: "Java 开发工程师", startDate: "2022-03", isCurrent: true, skills: ["Java"] },
    { localId: "work-2", companyName: "小花网络", positionName: "", startDate: "2019-07", endDate: "2022-02", skills: [] },
  ];
  return resume;
}

describe("applyAiResume", () => {
  it("按 localId 合并条目，保留绑定信息和头像，新条目生成新 ID", () => {
    const base = sample();
    const next = applyAiResume(base, {
      profile: { name: "张三", avatar: "https://evil/x.png" },
      bossCvId: "hacked",
      workExperiences: [
        { localId: "work-2", positionName: "后端开发工程师", endDate: "2022.2" },
        { companyName: "新公司", positionName: "架构师", startDate: "2018年1月", skills: ["Go", "Go", 1] },
      ],
    });

    expect(next.bossCvId).toBe("cv-1");
    expect(next.syncState).toBe("synced");
    expect(next.profile.avatar).toBe("https://img/a.png");
    expect(next.workExperiences).toHaveLength(2);
    expect(next.workExperiences[0]).toMatchObject({ localId: "work-2", companyName: "小花网络", positionName: "后端开发工程师", endDate: "2022-02" });
    expect(next.workExperiences[1].localId).toMatch(/^work-/);
    expect(next.workExperiences[1]).toMatchObject({ startDate: "2018-01", skills: ["Go", "1"] });
    expect(base.workExperiences).toHaveLength(2);
  });

  it("至今的经历不保留结束时间；未提供的模块保持原样", () => {
    const base = sample();
    const next = applyAiResume(base, { workExperiences: [{ localId: "work-1", isCurrent: true, endDate: "2026-01" }] });
    expect(next.workExperiences[0].endDate).toBeUndefined();
    expect(next.educations).toEqual(base.educations);
  });

  it("识别常见日期写法", () => {
    expect(normalizeDate("2020/3")).toBe("2020-03");
    expect(normalizeDate("2020-03-05")).toBe("2020-03-05");
    expect(normalizeDate("至今")).toBe("至今");
  });
});

describe("askResumeAssistant", () => {
  afterEach(() => vi.unstubAllGlobals());

  const settings = { apiKey: "sk-test", baseUrl: "https://api.deepseek.com", model: "deepseek-flash" };

  function stubReply(content: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] })));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("返回修改后的简历与按模块汇总的改动", async () => {
    const base = sample();
    const fetchMock = stubReply({ reply: "已补全职位", resume: { advantage: "5 年 Java 经验", workExperiences: [base.workExperiences[0], { ...base.workExperiences[1], positionName: "Java 开发工程师" }] } });

    const result = await askResumeAssistant(settings, base, [], "补全职位");

    expect(result.reply).toBe("已补全职位");
    expect(result.resume?.workExperiences[1].positionName).toBe("Java 开发工程师");
    expect(summarizeChanges(result.changes)).toEqual(["个人优势 · 1 处", "工作经历 · 1 处"]);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).not.toContain("https://img/a.png");
  });

  it("resume 为 null 时只返回回复", async () => {
    stubReply({ reply: "请提供岗位 JD", resume: null });
    const result = await askResumeAssistant(settings, sample(), [], "按 JD 优化");
    expect(result).toEqual({ reply: "请提供岗位 JD", changes: [] });
  });

  it("401 转成可读的错误", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(askResumeAssistant(settings, sample(), [], "hi")).rejects.toThrow("API Key 无效");
  });
});
