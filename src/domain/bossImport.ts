import { createBlankResume, type ResumeFactoryOptions } from "./factories";
import type { BossRemoteSnapshot, BossResumeDocument, ResumeIndexItem } from "./types";

/** 简历中可由 BOSS 数据填充的业务字段，不含本地元数据。 */
export type BossResumeContent = Pick<
  BossResumeDocument,
  | "profile"
  | "advantage"
  | "jobIntent"
  | "workExperiences"
  | "projects"
  | "educations"
  | "certificates"
  | "socialProfiles"
  | "volunteerExperiences"
  | "jobSearchStatus"
>;

export interface BossImportGroupSummary {
  label: string;
  count: number;
}

export interface BossImportReport {
  fetchedAt: string;
  /** false 表示响应结构无法识别：保留原始快照，但不允许写回。 */
  recognized: boolean;
  readGroups: BossImportGroupSummary[];
  missingGroups: string[];
  warnings: string[];
}

export interface BossImportResult {
  content: BossResumeContent;
  unmappedFields?: Record<string, unknown>;
  remoteSnapshot: BossRemoteSnapshot;
  report: BossImportReport;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function bossImportTitle(fetchedAt: string): string {
  const date = new Date(fetchedAt);
  if (Number.isNaN(date.getTime())) return "BOSS 简历";
  return `BOSS 简历 - ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function syncStateOf(result: BossImportResult): BossResumeDocument["syncState"] {
  return result.report.recognized ? "synced" : "unsupported";
}

/** 用一次 BOSS 读取结果新建本地简历。 */
export function createResumeFromBossImport(
  result: BossImportResult,
  options: ResumeFactoryOptions = {},
): BossResumeDocument {
  const base = createBlankResume({ now: result.report.fetchedAt, ...options });
  return {
    ...base,
    ...structuredClone(result.content),
    title: bossImportTitle(result.report.fetchedAt),
    source: "boss-import",
    lastBossFetchedAt: result.report.fetchedAt,
    syncState: syncStateOf(result),
    remoteSnapshot: structuredClone(result.remoteSnapshot),
    unmappedFields: result.unmappedFields ? structuredClone(result.unmappedFields) : undefined,
  };
}

/** 用 BOSS 数据覆盖已绑定简历的业务字段，保留本地 ID、名称、来源和写回记录。 */
export function refreshResumeFromBossImport(
  target: BossResumeDocument,
  result: BossImportResult,
  now: Date | string = new Date(),
): BossResumeDocument {
  return {
    ...structuredClone(target),
    ...structuredClone(result.content),
    updatedAt: typeof now === "string" ? now : now.toISOString(),
    lastBossFetchedAt: result.report.fetchedAt,
    syncState: syncStateOf(result),
    remoteSnapshot: structuredClone(result.remoteSnapshot),
    unmappedFields: result.unmappedFields ? structuredClone(result.unmappedFields) : undefined,
  };
}

export function isBossBoundResume(item: Pick<ResumeIndexItem, "lastBossFetchedAt" | "lastBossWrittenAt">): boolean {
  return Boolean(item.lastBossFetchedAt || item.lastBossWrittenAt);
}

/** 刷新前需要用户确认：存在尚未写回 BOSS 的本地修改。 */
export function hasUnwrittenBossChanges(resume: Pick<BossResumeDocument, "syncState">): boolean {
  return resume.syncState === "local-dirty" || resume.syncState === "write-failed";
}
