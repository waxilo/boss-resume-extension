import { describe, expect, it } from "vitest";
import { createBlankResume } from "../../src/domain/factories";
import { resumeContentFingerprint } from "../../src/domain/diff";
import { ensureSyncBaseline, markContentSynced, reconcileSyncState } from "../../src/domain/syncState";
import type { BossResumeDocument } from "../../src/domain/types";

function syncedResume(): BossResumeDocument {
  const resume = createBlankResume({ now: "2026-10-01T00:00:00.000Z", createId: () => "local-1" });
  resume.title = "Java 简历";
  resume.source = "boss-import";
  resume.profile = { name: "张三", gender: "male", workStartDate: "2018-07" };
  resume.jobIntent = { cities: ["上海"], positions: ["Java"], industries: [] };
  resume.workExperiences = [
    {
      localId: "work-1",
      companyName: "示例公司",
      positionName: "Java",
      startDate: "2020-03",
      isCurrent: true,
      skills: [],
    },
  ];
  resume.bossCvId = "cv-1";
  return markContentSynced(resume);
}

describe("resumeContentFingerprint", () => {
  it("忽略 ID、时间戳、同步状态与远程快照", () => {
    const resume = syncedResume();
    const before = resumeContentFingerprint(resume);
    resume.updatedAt = "2027-01-01T00:00:00.000Z";
    resume.lastBossFetchedAt = "2027-01-01T00:00:00.000Z";
    resume.lastBossUploadedAt = "2027-01-01T00:00:00.000Z";
    resume.syncState = "local-dirty";
    resume.remoteSnapshot = { capturedAt: "2027-01-01T00:00:00.000Z", source: "fetch", rawData: { a: 1 } };
    resume.onlineFetchedAt = "2027-01-01T00:00:00.000Z";
    resume.onlineSnapshot = { capturedAt: "2027-01-01T00:00:00.000Z", rawData: { b: 2 } };
    expect(resumeContentFingerprint(resume)).toBe(before);
  });

  it("内容或模块顺序变化会改变指纹", () => {
    const resume = syncedResume();
    const before = resumeContentFingerprint(resume);
    resume.workExperiences[0].companyName = "新公司";
    expect(resumeContentFingerprint(resume)).not.toBe(before);

    const other = syncedResume();
    other.sectionOrder = ["profile", "work", "advantage", "professionalSkills", "projects", "education", "customModules"];
    const baseline = resumeContentFingerprint(other);
    other.sectionOrder = [...other.sectionOrder].reverse();
    expect(resumeContentFingerprint(other)).not.toBe(baseline);
  });
});

describe("reconcileSyncState", () => {
  it("内容没变时保持已同步（打开简历、补字段、只改元数据）", () => {
    const resume = syncedResume();
    const before = resume.syncState;
    resume.onlineFetchedAt = "2027-01-01T00:00:00.000Z";
    resume.updatedAt = "2027-01-01T00:00:00.000Z";
    reconcileSyncState(resume);
    expect(before).toBe("synced");
    expect(resume.syncState).toBe("synced");
  });

  it("内容变化后降级为本地已修改，改回原样再恢复已同步", () => {
    const resume = syncedResume();
    resume.advantage = "新增的个人优势";
    reconcileSyncState(resume);
    expect(resume.syncState).toBe("local-dirty");

    resume.advantage = "";
    reconcileSyncState(resume);
    expect(resume.syncState).toBe("synced");
  });

  it("未绑定 BOSS 的简历不参与判断", () => {
    const resume = createBlankResume({ createId: () => "local-2" });
    resume.advantage = "内容";
    reconcileSyncState(resume);
    expect(resume.syncState).toBe("unbound");
    expect(resume.syncedContentFingerprint).toBeUndefined();
  });

  it("旧档案打开时用当前内容补基线，之后的真实修改仍会被识别", () => {
    const resume = syncedResume();
    delete resume.syncedContentFingerprint;
    ensureSyncBaseline(resume);
    expect(resume.syncedContentFingerprint).toBe(resumeContentFingerprint(resume));

    resume.profile.name = "李四";
    reconcileSyncState(resume);
    expect(resume.syncState).toBe("local-dirty");
  });
});
