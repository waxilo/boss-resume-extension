import type { BossProject, BossWorkExperience } from "../domain";

/** 条目型模块的列表展示与新建规则，供 ItemList 使用；表单字段在 App.vue 的插槽里。 */
export interface ItemSectionConfig<T> {
  eyebrow: string;
  heading: string;
  hint: string;
  addLabel: string;
  emptyText: string;
  title: (item: T) => string;
  meta: (item: T) => string;
  create: () => T;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function range(start?: string, end?: string, current = false): string {
  if (!start && !end && !current) return "";
  return `${start || "—"} – ${current ? "至今" : end || "至今"}`;
}

function join(...parts: Array<string | undefined>): string {
  return parts.map((part) => part?.trim()).filter(Boolean).join(" · ");
}

export const WORK: ItemSectionConfig<BossWorkExperience> = {
  eyebrow: "WORK EXPERIENCE",
  heading: "工作经历",
  hint: "按时间倒序整理你的工作和成果。",
  addLabel: "+ 新增经历",
  emptyText: "尚未添加工作经历。",
  title: (item) => item.companyName.trim() || "未填写公司",
  meta: (item) => join(item.positionName, range(item.startDate, item.endDate, item.isCurrent)),
  create: () => ({ localId: newId("work"), companyName: "", positionName: "", startDate: "", skills: [] }),
};

export const PROJECTS: ItemSectionConfig<BossProject> = {
  eyebrow: "PROJECTS",
  heading: "项目经历",
  hint: "描述你实际负责的项目和可量化结果。",
  addLabel: "+ 新增项目",
  emptyText: "尚未添加项目经历。",
  title: (item) => item.projectName.trim() || "未命名项目",
  meta: (item) => join(item.role, range(item.startDate, item.endDate)),
  create: () => ({ localId: newId("project"), projectName: "", startDate: "" }),
};
