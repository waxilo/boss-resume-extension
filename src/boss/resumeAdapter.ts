import type {
  BossEducation,
  BossJobIntent,
  BossProfile,
  BossProject,
  BossWorkExperience,
} from "../domain/types";
import type { BossImportResult, BossResumeContent } from "../domain/bossImport";
import type { BossCapturedResponse, BossCaptureResult, BossFetchError } from "./types";

/**
 * BossResumeAdapter：唯一接触 BOSS 接口字段名的模块。
 *
 * 数据来源：BOSS 简历页自身加载时请求的接口响应（被动捕获）。接口路径与 zpData 内部字段名都没有
 * 公开资料，因此不绑定某个接口，而是在所有成功响应里按候选键深度查找：
 * - 列表（工作/项目/教育/期望）：找第一个候选键对应的对象数组；
 * - 基本信息、个人优势、求职状态：只在非数组元素的对象里找，避免把项目名当成姓名。
 * 拿到真实结构样本后，只需收敛这里的候选键与对应测试。
 */

type Raw = Record<string, unknown>;

export type BossAdaptOutcome =
  | { ok: true; result: BossImportResult }
  | { ok: false; error: BossFetchError };

const CODE_NOT_LOGGED_IN = 37;
const CODES_SECURITY = new Set([121, 122]);
const CODE_RATE_LIMITED = 9;
const MAX_DEPTH = 8;

const KEYS = {
  name: ["name", "geekName", "userName", "realName"],
  avatar: ["avatar", "largeAvatar", "tinyAvatar", "tiny", "avatarUrl", "headImg"],
  gender: ["genderDesc", "gender", "sex"],
  jobIdentity: ["geekIdentityDesc", "identityDesc", "jobIdentity"],
  workStartDate: ["workDate", "workStartDate", "startWorkDate", "workYearDate"],
  birthDate: ["birthday", "birthDate", "birth"],
  advantage: ["userDescription", "advantage", "geekDesc", "selfDescription", "userDesc"],
  jobStatus: ["applyStatusDesc", "jobStatusDesc", "applyStatusName"],
  workList: ["workExpList", "geekWorkExpList", "workExperienceList", "workList"],
  projectList: ["projectExpList", "geekProjExpList", "projExpList", "projectList"],
  educationList: ["eduExpList", "geekEduExpList", "educationExpList", "eduList", "educationList"],
  expectList: ["expectList", "resumeExpectList", "geekExpectList", "jobExpectList", "expectPositionList"],
};

function isRecord(value: unknown): value is Raw {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** 返回第一个有值的候选键及其值。 */
function pick(source: Raw, keys: string[]): { key?: string; value: unknown } {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return { key, value };
  }
  return { value: undefined };
}

class FieldReader {
  public readonly consumed = new Set<string>();

  public constructor(public readonly source: Raw) {}

  public text(keys: string[]): string | undefined {
    const { key, value } = pick(this.source, keys);
    if (typeof value !== "string" && typeof value !== "number") return undefined;
    if (key) this.consumed.add(key);
    return String(value).trim() || undefined;
  }

  public month(keys: string[]): string | undefined {
    const { key, value } = pick(this.source, keys);
    const month = normalizeMonth(value);
    if (month && key) this.consumed.add(key);
    return month;
  }

  public rest(): Record<string, unknown> {
    return Object.fromEntries(Object.entries(this.source).filter(([key]) => !this.consumed.has(key)));
  }
}

/** 支持毫秒时间戳、YYYY-MM、YYYY.MM、YYYY/MM、YYYYMM、YYYYMMDD，统一为 YYYY-MM。 */
export function normalizeMonth(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e11) {
      const date = new Date(value);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    }
    value = String(value);
  }
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  const separated = /^(\d{4})[-./年](\d{1,2})/.exec(text);
  if (separated) return toMonth(separated[1], separated[2]);
  const compact = /^(\d{4})(\d{2})(\d{2})?$/.exec(text);
  if (compact) return toMonth(compact[1], compact[2]);
  return undefined;
}

function toMonth(year: string, month: string): string | undefined {
  const value = Number(month);
  return value >= 1 && value <= 12 ? `${year}-${String(value).padStart(2, "0")}` : undefined;
}

function isCurrentMarker(value: unknown): boolean {
  return typeof value === "string" && /至今|今|present|now/i.test(value);
}

function itemId(prefix: string, raw: Raw, index: number): string {
  const remote = pick(raw, ["encryptId", "id", "expId", "encryptExpId"]).value;
  return typeof remote === "string" || typeof remote === "number"
    ? `${prefix}-boss-${remote}`
    : `${prefix}-boss-${index}`;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item : isRecord(item) ? pick(item, ["name", "tagName", "label"]).value : undefined))
      .filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) return value.split(/[,，、]/).map((item) => item.trim()).filter(Boolean);
  return [];
}

function unique(items: Array<string | undefined>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item)))];
}

// ---------- 在捕获的响应里深度查找 ----------

interface Root {
  path: string;
  data: Raw;
}

interface Visit {
  path: string;
  obj: Raw;
  inArray: boolean;
}

/** 广度优先遍历所有对象，浅层优先。 */
function* walk(roots: Root[]): Generator<Visit> {
  let level: Array<Visit & { depth: number }> = roots.map((root) => ({ path: root.path, obj: root.data, inArray: false, depth: 0 }));
  while (level.length) {
    const next: typeof level = [];
    for (const visit of level) {
      yield visit;
      if (visit.depth >= MAX_DEPTH) continue;
      for (const value of Object.values(visit.obj)) {
        if (isRecord(value)) next.push({ path: visit.path, obj: value, inArray: visit.inArray, depth: visit.depth + 1 });
        else if (Array.isArray(value)) {
          for (const item of value) {
            if (isRecord(item)) next.push({ path: visit.path, obj: item, inArray: true, depth: visit.depth + 1 });
          }
        }
      }
    }
    level = next;
  }
}

/** 第一个候选键对应的对象数组，非空的优先。 */
function findList(roots: Root[], keys: string[]): { path?: string; items: Raw[] } {
  let empty: { path: string; items: Raw[] } | undefined;
  for (const { path, obj } of walk(roots)) {
    for (const key of keys) {
      const value = obj[key];
      if (!Array.isArray(value)) continue;
      const items = value.filter(isRecord);
      if (items.length) return { path, items };
      empty ??= { path, items: [] };
    }
  }
  return empty ?? { items: [] };
}

/** 第一个含任一候选键（字符串值）的非数组元素对象。 */
function findObject(roots: Root[], keys: string[]): Visit | undefined {
  for (const visit of walk(roots)) {
    if (visit.inArray) continue;
    const { value } = pick(visit.obj, keys);
    if (typeof value === "string" && value.trim()) return visit;
  }
  return undefined;
}

// ---------- 分组映射 ----------

function mapGender(reader: FieldReader, warnings: string[]): BossProfile["gender"] {
  const { key, value } = pick(reader.source, KEYS.gender);
  if (value === "男" || value === "male") { reader.consumed.add(key!); return "male"; }
  if (value === "女" || value === "female") { reader.consumed.add(key!); return "female"; }
  // 数字性别码的含义未经验证，保留在未映射字段里，不猜测。
  if (value !== undefined) warnings.push("性别为编码值，含义未验证，已保留原始值未映射");
  return undefined;
}

function mapWork(raw: Raw, index: number): BossWorkExperience {
  const r = new FieldReader(raw);
  const endText = pick(raw, ["endDate", "endDateDesc", "endTime"]).value;
  return {
    localId: itemId("work", raw, index),
    companyName: r.text(["company", "companyName", "brandName"]) ?? "",
    industry: r.text(["industryName", "industry", "industryDesc"]),
    department: r.text(["department", "departmentName"]),
    positionName: r.text(["positionName", "positionTitle", "position", "jobName"]) ?? "",
    startDate: r.month(["startDate", "startDateDesc", "startTime"]) ?? "",
    endDate: r.month(["endDate", "endDateDesc", "endTime"]),
    isCurrent: isCurrentMarker(endText) || undefined,
    responsibilities: r.text(["responsibility", "workContent", "description", "workDesc"]),
    skills: textList(pick(raw, ["workEmphasisList", "skills", "skillList", "keywords"]).value),
    achievements: r.text(["performance", "achievement", "achievements"]),
  };
}

function mapProject(raw: Raw, index: number): BossProject {
  const r = new FieldReader(raw);
  return {
    localId: itemId("project", raw, index),
    projectName: r.text(["name", "projectName"]) ?? "",
    role: r.text(["roleName", "role", "projectRole"]),
    startDate: r.month(["startDate", "startDateDesc", "startTime"]) ?? "",
    endDate: r.month(["endDate", "endDateDesc", "endTime"]),
    description: r.text(["projectDescription", "description", "projectDesc"]),
    achievements: r.text(["performance", "achievement", "projectResult"]),
    link: r.text(["url", "link", "projectUrl"]),
  };
}

function mapEducation(raw: Raw, index: number): BossEducation {
  const r = new FieldReader(raw);
  return {
    localId: itemId("education", raw, index),
    schoolName: r.text(["school", "schoolName"]) ?? "",
    degree: r.text(["degreeName", "degreeDesc", "degree"]),
    major: r.text(["major", "majorName"]),
    startDate: r.month(["startDate", "startYearStr", "startDateDesc", "startYear"]),
    endDate: r.month(["endDate", "endYearStr", "endDateDesc", "endYear"]),
    campusExperience: r.text(["eduDescription", "schoolExp", "description"]),
    thesis: r.text(["thesisTitle", "paper", "thesis"]),
  };
}

function mapJobIntent(expects: Raw[]): BossJobIntent {
  const readers = expects.map((raw) => new FieldReader(raw));
  return {
    jobType: readers.map((r) => r.text(["expectTypeDesc", "jobTypeDesc", "jobType"])).find(Boolean),
    positions: unique(readers.map((r) => r.text(["positionName", "positionDesc", "position"]))),
    cities: unique(readers.map((r) => r.text(["locationName", "cityName", "city"]))),
    salary: readers.map((r) => r.text(["salaryDesc", "salary"])).find(Boolean),
    industries: unique(expects.flatMap((raw) => textList(pick(raw, ["industryDesc", "industryList", "industryName"]).value))),
  };
}

/** 把 BOSS 信封中的错误码翻译为可读错误；code === 0 返回 undefined。 */
export function classifyResponse(response: Pick<BossCapturedResponse, "status" | "body">, label: string): BossFetchError | undefined {
  const body = response.body;
  if (!isRecord(body) || typeof body.code !== "number") {
    return { code: "UNEXPECTED_RESPONSE", message: `${label}返回的不是 BOSS 接口 JSON`, detail: `HTTP ${response.status}` };
  }
  if (body.code === 0) return undefined;
  const detail = `code=${body.code}${typeof body.message === "string" ? `，${body.message}` : ""}`;
  if (body.code === CODE_NOT_LOGGED_IN) return { code: "NOT_LOGGED_IN", message: "BOSS 登录已失效，请在 BOSS 页面重新登录后重试", detail };
  if (CODES_SECURITY.has(body.code)) return { code: "SECURITY_BLOCKED", message: "请求被 BOSS 安全校验拦截，请在 BOSS 页面完成验证后手动重试", detail };
  if (body.code === CODE_RATE_LIMITED) return { code: "RATE_LIMITED", message: "BOSS 提示操作过于频繁，请稍后再手动重试", detail };
  return { code: "API_ERROR", message: `${label}读取失败`, detail };
}

const ERROR_PRIORITY: BossFetchError["code"][] = ["NOT_LOGGED_IN", "SECURITY_BLOCKED", "RATE_LIMITED"];

export const BossResumeAdapter = {
  adaptCapture(capture: BossCaptureResult, fetchedAt: string = new Date().toISOString()): BossAdaptOutcome {
    if (!capture.entries.length) {
      return {
        ok: false,
        error: capture.hooked
          ? { code: "NO_DATA", message: "BOSS 简历页没有加载到简历数据，请在 BOSS 简历页确认能看到简历后重试", detail: capture.pageUrl }
          : { code: "NO_DATA", message: "BOSS 简历页是在扩展加载前打开的，请刷新该页面后重试", detail: capture.pageUrl },
      };
    }

    const roots: Root[] = [];
    const errors: BossFetchError[] = [];
    for (const entry of capture.entries) {
      const error = classifyResponse(entry, "BOSS 接口");
      if (error) errors.push(error);
      else if (isRecord((entry.body as Raw).zpData)) roots.push({ path: entry.path, data: (entry.body as Raw).zpData as Raw });
    }

    const warnings: string[] = [];
    const usedPaths = new Set<string>();
    const use = (path: string | undefined) => path && usedPaths.add(path);

    const profileVisit = findObject(roots, KEYS.name);
    use(profileVisit?.path);
    const base = new FieldReader(profileVisit?.obj ?? {});
    const profile: BossProfile = {
      name: base.text(KEYS.name) ?? "",
      avatar: base.text(KEYS.avatar),
      gender: mapGender(base, warnings),
      jobIdentity: base.text(KEYS.jobIdentity),
      workStartDate: base.month(KEYS.workStartDate),
      birthDate: base.month(KEYS.birthDate),
    };

    const textFrom = (keys: string[]): string | undefined => {
      const visit = findObject(roots, keys);
      if (!visit) return undefined;
      use(visit.path);
      return visit.obj === base.source ? base.text(keys) : new FieldReader(visit.obj).text(keys);
    };
    const listFrom = (keys: string[]): Raw[] => {
      const found = findList(roots, keys);
      if (found.items.length) use(found.path);
      return found.items;
    };

    const workRaw = listFrom(KEYS.workList);
    const projectRaw = listFrom(KEYS.projectList);
    const educationRaw = listFrom(KEYS.educationList);
    const expectRaw = listFrom(KEYS.expectList);

    const content: BossResumeContent = {
      profile,
      advantage: textFrom(KEYS.advantage) ?? "",
      jobIntent: mapJobIntent(expectRaw),
      workExperiences: workRaw.map(mapWork),
      projects: projectRaw.map(mapProject),
      educations: educationRaw.map(mapEducation),
      certificates: [],
      socialProfiles: [],
      volunteerExperiences: [],
      jobSearchStatus: { status: textFrom(KEYS.jobStatus) },
    };

    const groups = [
      { label: "基本信息", count: profile.name ? 1 : 0 },
      { label: "个人优势", count: content.advantage ? 1 : 0 },
      { label: "求职期望", count: expectRaw.length },
      { label: "工作经历", count: workRaw.length },
      { label: "项目经历", count: projectRaw.length },
      { label: "教育经历", count: educationRaw.length },
    ];
    const recognized = groups.some((group) => group.count > 0);
    if (!recognized) {
      // 什么都没认出来且有鉴权/风控类错误时，优先把错误告诉用户。
      const blocking = ERROR_PRIORITY.map((code) => errors.find((error) => error.code === code)).find(Boolean);
      if (blocking) return { ok: false, error: blocking };
      warnings.unshift("响应字段无法识别，已保留原始快照，需更新适配器；此简历不允许写回");
    }

    const baseRest = base.rest();
    const unmappedFields = Object.keys(baseRest).length ? { baseinfo: baseRest } : undefined;

    // 只保存贡献了数据的响应；无法识别时保存全部，便于排查。
    const kept = recognized ? roots.filter((root) => usedPaths.has(root.path)) : roots;
    const rawData = Object.fromEntries(kept.map((root) => [root.path, root.data]));

    return {
      ok: true,
      result: {
        content,
        unmappedFields,
        remoteSnapshot: { capturedAt: fetchedAt, source: "fetch", rawData },
        report: {
          fetchedAt,
          recognized,
          readGroups: groups.filter((group) => group.count > 0),
          missingGroups: [
            ...groups.filter((group) => group.count === 0).map((group) => group.label),
            "资格证书",
            "社交主页",
            "志愿者服务",
          ],
          warnings,
        },
      },
    };
  },
};
