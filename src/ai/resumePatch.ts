import type {
  BossCertificate,
  BossEducation,
  BossJobIntent,
  BossJobSearchStatus,
  BossProfile,
  BossProject,
  BossResumeDocument,
  BossSocialProfile,
  BossVolunteerExperience,
  BossWorkExperience,
} from "../domain/types";

/**
 * 把 AI 返回的简历 JSON 安全地合并回本地简历：
 * - 只接受可编辑字段，ID、绑定信息、同步状态、远程快照一律沿用原值；
 * - 条目按 localId 对应原条目，AI 省略的字段沿用原值，新条目生成新 ID；
 * - 类型不对的值丢弃，日期统一成 YYYY-MM(-DD)。
 */
type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function list(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => str(item)?.trim() ?? "").filter(Boolean))];
}

/** 2020.3 / 2020/03 / 2020年3月 → 2020-03；无法识别的原样保留，交给校验提示。 */
export function normalizeDate(value: unknown): string | undefined {
  const text = str(value)?.trim();
  if (!text) return text;
  const match = text.match(/^(\d{4})\s*[-./年]\s*(\d{1,2})(?:\s*[-./月]\s*(\d{1,2}))?/);
  if (!match) return text;
  const month = match[2].padStart(2, "0");
  return match[3] ? `${match[1]}-${month}-${match[3].padStart(2, "0")}` : `${match[1]}-${month}`;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function compact<T extends object>(value: T): T {
  for (const key of Object.keys(value)) if ((value as Rec)[key] === undefined) delete (value as Rec)[key];
  return value;
}

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function mergeItems<T extends { localId: string }>(
  prefix: string,
  existing: T[],
  value: unknown,
  build: (source: Rec) => Omit<T, "localId">,
): T[] {
  if (!Array.isArray(value)) return existing;
  const byId = new Map(existing.map((item) => [item.localId, item]));
  const used = new Set<string>();
  return value.filter(isRecord).map((item) => {
    const known = typeof item.localId === "string" && byId.has(item.localId) && !used.has(item.localId);
    const localId = known ? (item.localId as string) : newId(prefix);
    used.add(localId);
    const source: Rec = { ...((byId.get(localId) as Rec | undefined) ?? {}), ...item };
    return compact({ localId, ...build(source) } as T);
  });
}

const GENDERS = new Set(["male", "female", "unknown"]);

function mergeProfile(base: BossProfile, value: Rec): BossProfile {
  const source: Rec = { ...base, ...value };
  return compact({
    avatar: base.avatar,
    name: str(source.name) ?? base.name,
    gender: GENDERS.has(source.gender as string) ? (source.gender as BossProfile["gender"]) : base.gender,
    jobIdentity: str(source.jobIdentity),
    workStartDate: normalizeDate(source.workStartDate),
    birthDate: normalizeDate(source.birthDate),
  });
}

function mergeJobIntent(base: BossJobIntent, value: Rec): BossJobIntent {
  const source: Rec = { ...base, ...value };
  return compact({
    jobType: str(source.jobType),
    cities: list(source.cities),
    positions: list(source.positions),
    jobPreference: str(source.jobPreference),
    salary: str(source.salary),
    industries: list(source.industries),
  });
}

function mergeJobSearchStatus(base: BossJobSearchStatus, value: Rec): BossJobSearchStatus {
  const source: Rec = { ...base, ...value };
  return compact({
    status: str(source.status),
    availableDate: str(source.availableDate),
    preferredContactTime: str(source.preferredContactTime),
    note: str(source.note),
  });
}

export function applyAiResume(base: BossResumeDocument, patch: Rec): BossResumeDocument {
  const next = structuredClone(base);
  if ("title" in patch) next.title = str(patch.title) ?? base.title;
  if ("advantage" in patch) next.advantage = str(patch.advantage) ?? base.advantage;
  if (isRecord(patch.profile)) next.profile = mergeProfile(base.profile, patch.profile);
  if (isRecord(patch.jobIntent)) next.jobIntent = mergeJobIntent(base.jobIntent, patch.jobIntent);
  if (isRecord(patch.jobSearchStatus)) next.jobSearchStatus = mergeJobSearchStatus(base.jobSearchStatus, patch.jobSearchStatus);

  next.workExperiences = mergeItems<BossWorkExperience>("work", base.workExperiences, patch.workExperiences, (s) => {
    const isCurrent = bool(s.isCurrent);
    return {
      companyName: str(s.companyName) ?? "",
      industry: str(s.industry),
      department: str(s.department),
      positionName: str(s.positionName) ?? "",
      startDate: normalizeDate(s.startDate) ?? "",
      endDate: isCurrent ? undefined : normalizeDate(s.endDate),
      isCurrent,
      responsibilities: str(s.responsibilities),
      skills: list(s.skills),
      achievements: str(s.achievements),
    };
  });

  next.projects = mergeItems<BossProject>("project", base.projects, patch.projects, (s) => {
    const isCurrent = bool(s.isCurrent);
    return {
      projectName: str(s.projectName) ?? "",
      role: str(s.role),
      startDate: normalizeDate(s.startDate) ?? "",
      endDate: isCurrent ? undefined : normalizeDate(s.endDate),
      isCurrent,
      description: str(s.description),
      achievements: str(s.achievements),
      link: str(s.link),
    };
  });

  next.educations = mergeItems<BossEducation>("education", base.educations, patch.educations, (s) => {
    const isCurrent = bool(s.isCurrent);
    return {
      schoolName: str(s.schoolName) ?? "",
      degree: str(s.degree),
      major: str(s.major),
      startDate: normalizeDate(s.startDate),
      endDate: isCurrent ? undefined : normalizeDate(s.endDate),
      isCurrent,
      campusExperience: str(s.campusExperience),
      thesis: str(s.thesis),
    };
  });

  next.certificates = mergeItems<BossCertificate>("certificate", base.certificates, patch.certificates, (s) => ({
    name: str(s.name) ?? "",
    issuer: str(s.issuer),
    credentialId: str(s.credentialId),
    issueDate: normalizeDate(s.issueDate),
    expiryDate: normalizeDate(s.expiryDate),
    description: str(s.description),
  }));

  next.socialProfiles = mergeItems<BossSocialProfile>("social", base.socialProfiles, patch.socialProfiles, (s) => ({
    platform: str(s.platform) ?? "",
    url: str(s.url) ?? "",
    label: str(s.label),
  }));

  next.volunteerExperiences = mergeItems<BossVolunteerExperience>("volunteer", base.volunteerExperiences, patch.volunteerExperiences, (s) => ({
    organizationName: str(s.organizationName) ?? "",
    role: str(s.role),
    startDate: normalizeDate(s.startDate),
    endDate: normalizeDate(s.endDate),
    description: str(s.description),
  }));

  return next;
}
