import { describe, expect, it } from "vitest";
import { copyResume, createBlankResume } from "../../src/domain/factories";

describe("简历工厂", () => {
  it("创建具有完整字段结构的未绑定空白简历", () => {
    const resume = createBlankResume({
      now: "2026-10-27T00:00:00.000Z",
      createId: () => "resume-1",
    });

    expect(resume).toMatchObject({
      localId: "resume-1",
      title: "未命名简历",
      source: "manual",
      createdAt: "2026-10-27T00:00:00.000Z",
      updatedAt: "2026-10-27T00:00:00.000Z",
      syncState: "unbound",
      profile: { name: "" },
      jobIntent: { cities: [], positions: [], industries: [] },
      workExperiences: [],
      projects: [],
      educations: [],
      certificates: [],
      socialProfiles: [],
      volunteerExperiences: [],
      jobSearchStatus: {},
    });
  });

  it("深拷贝简历并移除 BOSS 绑定信息", () => {
    const original = createBlankResume({ now: "2026-10-01T00:00:00.000Z", createId: () => "original" });
    original.title = "前端工程师";
    original.workExperiences.push({
      localId: "work-1",
      companyName: "示例公司",
      positionName: "工程师",
      startDate: "2024-01",
      skills: ["TypeScript"],
    });
    original.remoteSnapshot = {
      capturedAt: "2026-10-01T00:00:00.000Z",
      source: "fetch",
      rawData: { resumeId: "remote" },
    };
    original.unmappedFields = { legacyField: { value: 1 } };

    const copied = copyResume(original, {
      now: "2026-10-27T00:00:00.000Z",
      createId: () => "copy",
    });
    copied.workExperiences[0].skills.push("Vue");
    (copied.unmappedFields?.legacyField as { value: number }).value = 2;

    expect(copied).toMatchObject({
      localId: "copy",
      title: "前端工程师副本",
      source: "copy",
      createdAt: "2026-10-27T00:00:00.000Z",
      syncState: "unbound",
      workExperiences: [{ skills: ["TypeScript", "Vue"] }],
    });
    expect(copied).not.toHaveProperty("remoteSnapshot");
    expect(copied).not.toHaveProperty("lastBossFetchedAt");
    expect(original.workExperiences[0].skills).toEqual(["TypeScript"]);
    expect((original.unmappedFields?.legacyField as { value: number }).value).toBe(1);
  });
});
