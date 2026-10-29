import { describe, expect, it } from "vitest";
import { createBlankResume } from "../../src/domain/factories";
import { describeIssue, validateResume } from "../../src/domain/validation";

describe("简历校验", () => {
  it("报告必填项、日期范围和链接格式问题", () => {
    const resume = createBlankResume({ createId: () => "resume-1" });
    resume.title = "";
    resume.workExperiences = [{
      localId: "work-1",
      companyName: "",
      positionName: "",
      startDate: "2025-12",
      endDate: "2025-01",
      skills: [],
    }];
    resume.socialProfiles = [{ localId: "social-1", platform: "", url: "not-a-url" }];
    resume.profile.birthDate = "2026-02-30";

    const result = validateResume(resume);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining([
        "title",
        "profile.name",
        "workExperiences[0].companyName",
        "workExperiences[0].positionName",
        "workExperiences[0].endDate",
        "socialProfiles[0].platform",
        "socialProfiles[0].url",
      ]),
    );
  });

  it("问题描述带上模块序号与字段名", () => {
    const resume = createBlankResume({ createId: () => "resume-1" });
    resume.title = "Java";
    resume.profile.name = "张三";
    resume.workExperiences = [
      { localId: "work-1", companyName: "甲公司", positionName: "Java", startDate: "2026-01", skills: [] },
      { localId: "work-2", companyName: "乙公司", positionName: "", startDate: "2023-03", endDate: "2025-12", skills: [] },
    ];

    const { issues } = validateResume(resume);

    expect(issues).toEqual([
      { path: "workExperiences[1].positionName", location: "工作经历 2", message: "职位名称为必填项" },
    ]);
    expect(issues.map(describeIssue)).toEqual(["工作经历 2 · 职位名称为必填项"]);
  });

  it("接受结构完整且日期合法的简历", () => {
    const resume = createBlankResume({ createId: () => "resume-1" });
    resume.title = "前端工程师";
    resume.profile.name = "张三";
    resume.workExperiences = [{
      localId: "work-1",
      companyName: "示例公司",
      positionName: "工程师",
      startDate: "2024-01",
      isCurrent: true,
      skills: ["TypeScript"],
    }];
    resume.socialProfiles = [{
      localId: "social-1",
      platform: "GitHub",
      url: "https://github.com/example",
    }];
    // 项目勾了「至今」时不需要结束时间，也不能因此报错
    resume.projects = [{ localId: "project-1", projectName: "示例项目", startDate: "2023-01", isCurrent: true }];

    expect(validateResume(resume)).toEqual({ valid: true, issues: [] });
  });
});
