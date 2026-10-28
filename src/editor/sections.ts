/** 编辑页的模块定义，编辑表单、左侧菜单与预览共用。求职意向与直聘简历一样并在基本资料里。 */
export type SectionId = "profile" | "advantage" | "work" | "projects";

/** 可拖动排序的模块；基本资料与直聘简历一样固定在最上面。 */
export type MovableSectionId = Exclude<SectionId, "profile">;

export const SECTION_LABEL: Record<SectionId, string> = {
  profile: "基本资料",
  advantage: "个人优势",
  work: "工作经历",
  projects: "项目经历",
};

/** 直聘简历 profileVO.sort 里的模块编码。 */
export const SECTION_CODE: Record<MovableSectionId, number> = {
  advantage: 1002,
  work: 1003,
  projects: 1005,
};

export const MOVABLE_SECTIONS: readonly MovableSectionId[] = ["advantage", "work", "projects"];

/** 本地顺序缺失或不完整时按默认顺序补齐，保证三个模块都在且不重复。 */
export function normalizeSectionOrder(order?: readonly string[]): MovableSectionId[] {
  const result: MovableSectionId[] = [];
  for (const id of order ?? []) {
    if ((MOVABLE_SECTIONS as readonly string[]).includes(id) && !result.includes(id as MovableSectionId)) result.push(id as MovableSectionId);
  }
  return [...result, ...MOVABLE_SECTIONS.filter((id) => !result.includes(id))];
}

/** 直聘简历的 sort（模块编码列表）→ 本地可拖动模块顺序。 */
export function sectionOrderFromSort(sort: unknown): MovableSectionId[] {
  const codes = Array.isArray(sort) ? sort.map(Number) : typeof sort === "string" ? sort.split(",").map(Number) : [];
  const ids = codes
    .map((code) => MOVABLE_SECTIONS.find((id) => SECTION_CODE[id] === code))
    .filter((id): id is MovableSectionId => Boolean(id));
  return normalizeSectionOrder(ids);
}
