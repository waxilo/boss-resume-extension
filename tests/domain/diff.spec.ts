import { describe, expect, it } from "vitest";
import { diffResumes } from "../../src/domain/diff";
import { createBlankResume } from "../../src/domain/factories";

describe("简历字段差异", () => {
  it("忽略元数据并返回字段级变更", () => {
    const before = createBlankResume({
      now: "2026-10-01T00:00:00.000Z",
      createId: () => "resume-1",
    });
    before.profile.name = "张三";
    before.workExperiences = [{
      localId: "work-1",
      companyName: "示例公司",
      positionName: "工程师",
      startDate: "2024-01",
      skills: ["TypeScript"],
    }];

    const after = structuredClone(before);
    after.updatedAt = "2026-10-27T00:00:00.000Z";
    after.syncState = "local-dirty";
    after.profile.name = "李四";
    after.workExperiences[0].positionName = "高级工程师";
    after.workExperiences.push({
      localId: "work-2",
      companyName: "另一家公司",
      positionName: "工程师",
      startDate: "2025-01",
      skills: [],
    });

    expect(diffResumes(before, after)).toEqual([
      { path: "profile.name", kind: "changed", before: "张三", after: "李四" },
      {
        path: "workExperiences[work-1].positionName",
        kind: "changed",
        before: "工程师",
        after: "高级工程师",
      },
      {
        path: "workExperiences[work-2]",
        kind: "added",
        after: {
          localId: "work-2",
          companyName: "另一家公司",
          positionName: "工程师",
          startDate: "2025-01",
          skills: [],
        },
      },
    ]);
  });

  it("按条目 localId 识别删除", () => {
    const before = createBlankResume({ createId: () => "resume-1" });
    before.workExperiences = [{
      localId: "work-1",
      companyName: "示例公司",
      positionName: "工程师",
      startDate: "2024-01",
      skills: [],
    }];
    const after = structuredClone(before);
    after.workExperiences = [];

    expect(diffResumes(before, after)).toEqual([
      { path: "workExperiences[work-1]", kind: "removed", before: before.workExperiences[0] },
    ]);
  });
});
