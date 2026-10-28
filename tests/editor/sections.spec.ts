import { describe, expect, it } from "vitest";
import { normalizeSectionOrder, sectionOrderFromSort } from "../../src/editor/sections";
import { BossResumeAdapter } from "../../src/boss/resumeAdapter";

describe("模块顺序", () => {
  it("缺失、重复、未知项都补齐为完整顺序", () => {
    expect(normalizeSectionOrder()).toEqual(["advantage", "work", "projects"]);
    expect(normalizeSectionOrder(["projects", "projects", "intent"])).toEqual(["projects", "advantage", "work"]);
  });

  it("直聘 sort 只取个人优势 / 工作 / 项目，忽略基本信息与教育经历", () => {
    expect(sectionOrderFromSort([1001, 1005, 1006, 1002, 1003])).toEqual(["projects", "advantage", "work"]);
    expect(sectionOrderFromSort("1001,1003,1002")).toEqual(["work", "advantage", "projects"]);
    expect(sectionOrderFromSort(undefined)).toEqual(["advantage", "work", "projects"]);
  });

  it("导入时从 profileVO.sort 读取顺序", () => {
    const outcome = BossResumeAdapter.adaptDetail("cv-1", { profileVO: { name: "张三", sort: [1001, 1003, 1005, 1002] } });
    if (!outcome.ok) throw new Error("unexpected");
    expect(outcome.result.content.sectionOrder).toEqual(["work", "projects", "advantage"]);
  });
});
