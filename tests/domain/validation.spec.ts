import { describe, expect, it } from "vitest";
import { createBlankResume } from "../../src/domain/factories";
import { validateResume } from "../../src/domain/validation";

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

    expect(validateResume(resume)).toEqual({ valid: true, issues: [] });
  });
});
