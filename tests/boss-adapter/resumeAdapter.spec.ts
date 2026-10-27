import { describe, expect, it } from "vitest";
import { BossResumeAdapter, normalizeMonth } from "../../src/boss/resumeAdapter";
import { buildStructureSample } from "../../src/boss/structureSample";
import type { BossCapturedResponse, BossCaptureResult } from "../../src/boss/types";
import { createResumeFromBossImport, refreshResumeFromBossImport } from "../../src/domain/bossImport";
import { createBlankResume } from "../../src/domain/factories";

// 合成样本：接口路径与字段名为候选推测值，不代表 BOSS 真实结构。拿到真实结构样本后替换为 fixtures。
const ok = (path: string, zpData: unknown): BossCapturedResponse => ({ path, status: 200, body: { code: 0, message: "Success", zpData } });
const fail = (path: string, code: number, message = "m"): BossCapturedResponse => ({ path, status: 200, body: { code, message } });
const capture = (entries: BossCapturedResponse[], hooked = true): BossCaptureResult => ({ pageUrl: "https://cv.zhipin.com/my-resumes/", hooked, entries });

const FETCHED_AT = "2026-10-27T08:00:00.000Z";

describe("BossResumeAdapter.adaptCapture", () => {
  it("跨多个接口深度查找基本信息、经历与求职期望", () => {
    const outcome = BossResumeAdapter.adaptCapture(
      capture([
        ok("https://cv.zhipin.com/wapi/a/user.json", { user: { name: "测试用户", genderDesc: "男", birthday: "1995.06", workDate: 201807, mysteryFlag: 3 } }),
        ok("https://cv.zhipin.com/wapi/a/resume.json", {
          resume: {
            userDescription: "擅长前端",
            workExpList: [{ encryptId: "w1", company: "示例公司", positionName: "前端工程师", startDate: "2020-03", endDate: "至今" }],
            projectExpList: [{ name: "项目甲", roleName: "负责人", startDate: "2021.01" }],
            eduExpList: [{ school: "示例大学", major: "计算机", degreeName: "本科" }],
          },
        }),
        ok("https://cv.zhipin.com/wapi/a/expect.json", { expectList: [{ positionName: "前端", locationName: "上海", salaryDesc: "20-30K" }, { positionName: "全栈", locationName: "上海" }] }),
        ok("https://cv.zhipin.com/wapi/a/unrelated.json", { banner: "x" }),
        fail("https://cv.zhipin.com/wapi/a/other.json", 19),
      ]),
      FETCHED_AT,
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { content, unmappedFields, report, remoteSnapshot } = outcome.result;
    expect(content.profile).toMatchObject({ name: "测试用户", gender: "male", birthDate: "1995-06", workStartDate: "2018-07" });
    expect(content.advantage).toBe("擅长前端");
    expect(content.workExperiences[0]).toMatchObject({ localId: "work-boss-w1", companyName: "示例公司", startDate: "2020-03", isCurrent: true });
    expect(content.workExperiences[0].endDate).toBeUndefined();
    // 项目数组元素里的 name 不能被当成姓名。
    expect(content.projects[0]).toMatchObject({ projectName: "项目甲", role: "负责人", startDate: "2021-01" });
    expect(content.educations[0]).toMatchObject({ schoolName: "示例大学", degree: "本科" });
    expect(content.jobIntent).toMatchObject({ positions: ["前端", "全栈"], cities: ["上海"], salary: "20-30K" });
    expect(unmappedFields).toEqual({ baseinfo: { mysteryFlag: 3 } });
    expect(report.recognized).toBe(true);
    expect(Object.keys(remoteSnapshot.rawData)).not.toContain("https://cv.zhipin.com/wapi/a/unrelated.json");
  });

  it("没有捕获到响应时提示刷新或确认页面", () => {
    const unhooked = BossResumeAdapter.adaptCapture(capture([], false));
    const empty = BossResumeAdapter.adaptCapture(capture([]));
    expect(!unhooked.ok && unhooked.error).toMatchObject({ code: "NO_DATA", message: expect.stringContaining("刷新") });
    expect(!empty.ok && empty.error.code).toBe("NO_DATA");
  });

  it("无法识别的结构保留快照并标记为不支持写回", () => {
    const outcome = BossResumeAdapter.adaptCapture(capture([ok("p", { foo: { bar: 1 } })]), FETCHED_AT);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.report.recognized).toBe(false);
    expect(outcome.result.remoteSnapshot.rawData).toEqual({ p: { foo: { bar: 1 } } });
    expect(createResumeFromBossImport(outcome.result).syncState).toBe("unsupported");
  });

  it.each([
    [37, "NOT_LOGGED_IN"],
    [121, "SECURITY_BLOCKED"],
    [9, "RATE_LIMITED"],
  ])("什么都没识别出来时 code=%s 映射为 %s", (code, expected) => {
    const outcome = BossResumeAdapter.adaptCapture(capture([fail("p", code)]));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.code).toBe(expected);
  });

  it("有数据时个别接口失败不阻断导入", () => {
    const outcome = BossResumeAdapter.adaptCapture(capture([ok("a", { name: "测试用户" }), fail("b", 37)]), FETCHED_AT);
    expect(outcome.ok && outcome.result.content.profile.name).toBe("测试用户");
  });

  it("数字性别码不猜测含义", () => {
    const outcome = BossResumeAdapter.adaptCapture(capture([ok("a", { name: "测试用户", gender: 1 })]), FETCHED_AT);
    expect(outcome.ok && outcome.result.content.profile.gender).toBeUndefined();
    expect(outcome.ok && outcome.result.unmappedFields).toEqual({ baseinfo: { gender: 1 } });
  });
});

describe("导入到本地简历", () => {
  it("新建与刷新", () => {
    const outcome = BossResumeAdapter.adaptCapture(capture([ok("a", { name: "测试用户" })]), FETCHED_AT);
    if (!outcome.ok) throw new Error("unexpected");
    const created = createResumeFromBossImport(outcome.result, { createId: () => "r1" });
    expect(created).toMatchObject({ localId: "r1", source: "boss-import", syncState: "synced", lastBossFetchedAt: FETCHED_AT });
    expect(created.title).toMatch(/^BOSS 简历 - \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    const target = { ...createBlankResume({ createId: () => "r2" }), title: "我的版本", syncState: "local-dirty" as const };
    const refreshed = refreshResumeFromBossImport(target, outcome.result, FETCHED_AT);
    expect(refreshed).toMatchObject({ localId: "r2", title: "我的版本", syncState: "synced" });
    expect(refreshed.profile.name).toBe("测试用户");
  });
});

describe("工具函数", () => {
  it("normalizeMonth", () => {
    expect(normalizeMonth("2020.3")).toBe("2020-03");
    expect(normalizeMonth("2020年11月")).toBe("2020-11");
    expect(normalizeMonth(20200315)).toBe("2020-03");
    expect(normalizeMonth("至今")).toBeUndefined();
    expect(normalizeMonth("2020-13")).toBeUndefined();
  });

  it("结构样本不含个人内容", () => {
    const sample = buildStructureSample({ name: "张三", phone: 13800000000, gender: 1, list: [{ a: "x" }, { a: "y" }, { a: "z" }] });
    expect(sample).toEqual({ name: "<string:2>", phone: "<integer>", gender: "<integer:1>", list: ["<array:3>", { a: "<string:1>" }, { a: "<string:1>" }] });
    expect(JSON.stringify(sample)).not.toContain("张三");
  });
});
