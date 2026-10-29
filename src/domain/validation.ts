import type { BossResumeDocument } from "./types";

export interface ResumeValidationIssue {
  /** 字段路径，如 workExperiences[1].positionName。 */
  path: string;
  /** 面向用户的位置，与编辑页模块名一致，如「工作经历 2」。 */
  location: string;
  /** 面向用户的问题描述，已包含字段名，如「职位名称为必填项」。 */
  message: string;
}

export interface ResumeValidationResult {
  valid: boolean;
  issues: ResumeValidationIssue[];
}

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/;
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

/** 把一条校验问题格式化成「位置 · 描述」，供界面直接展示。 */
export function describeIssue(issue: ResumeValidationIssue): string {
  return `${issue.location} · ${issue.message}`;
}

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  if (value.length === 7) return true;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

interface DateField {
  field: string;
  value: string | undefined;
  label: string;
}

/** 绑定到某个位置（模块 + 序号）的问题收集器，字段路径相对该位置。 */
class IssueScope {
  public constructor(
    private readonly issues: ResumeValidationIssue[],
    private readonly basePath: string,
    private readonly location: string,
  ) {}

  private push(field: string, message: string): void {
    const path = this.basePath ? `${this.basePath}.${field}` : field;
    this.issues.push({ path, location: this.location, message });
  }

  public required(field: string, value: string, label: string): void {
    if (value.trim().length === 0) this.push(field, `${label}为必填项`);
  }

  public date({ field, value, label }: DateField): void {
    if (value !== undefined && value !== "" && !isValidDate(value)) {
      this.push(field, `${label}必须为有效的 YYYY-MM 或 YYYY-MM-DD 格式`);
    }
  }

  public dateRange(start: DateField, end: DateField): void {
    this.date(start);
    this.date(end);
    if (start.value && end.value && start.value > end.value) {
      this.push(end.field, `${end.label}不能早于${start.label}`);
    }
  }

  public url(field: string, value: string | undefined, label: string): void {
    if (value && !URL_PATTERN.test(value)) this.push(field, `${label}必须是 HTTP 或 HTTPS 地址`);
  }
}

function eachItem<T>(
  issues: ResumeValidationIssue[],
  items: T[],
  key: string,
  label: string,
  check: (scope: IssueScope, item: T) => void,
): void {
  items.forEach((item, index) => check(new IssueScope(issues, `${key}[${index}]`, `${label} ${index + 1}`), item));
}

/** 校验可编辑的 BOSS 简历字段，不对未映射原始字段施加规则。字段名与编辑页标签保持一致。 */
export function validateResume(resume: BossResumeDocument): ResumeValidationResult {
  const issues: ResumeValidationIssue[] = [];

  const basic = new IssueScope(issues, "", "基本资料");
  basic.required("title", resume.title, "简历名称");
  basic.required("profile.name", resume.profile.name, "姓名");
  basic.date({ field: "profile.workStartDate", value: resume.profile.workStartDate, label: "参加工作时间" });
  basic.date({ field: "profile.birthDate", value: resume.profile.birthDate, label: "出生年月" });

  eachItem(issues, resume.workExperiences, "workExperiences", "工作经历", (scope, work) => {
    scope.required("companyName", work.companyName, "公司名称");
    scope.required("positionName", work.positionName, "职位名称");
    scope.required("startDate", work.startDate, "开始时间");
    scope.dateRange(
      { field: "startDate", value: work.startDate, label: "开始时间" },
      { field: "endDate", value: work.isCurrent ? undefined : work.endDate, label: "结束时间" },
    );
  });

  eachItem(issues, resume.projects, "projects", "项目经历", (scope, project) => {
    scope.required("projectName", project.projectName, "项目名称");
    scope.required("startDate", project.startDate, "开始时间");
    scope.dateRange(
      { field: "startDate", value: project.startDate, label: "开始时间" },
      { field: "endDate", value: project.isCurrent ? undefined : project.endDate, label: "结束时间" },
    );
    scope.url("link", project.link, "项目链接");
  });

  eachItem(issues, resume.educations, "educations", "教育经历", (scope, education) => {
    scope.required("schoolName", education.schoolName, "学校名称");
    scope.dateRange(
      { field: "startDate", value: education.startDate, label: "开始时间" },
      { field: "endDate", value: education.isCurrent ? undefined : education.endDate, label: "结束时间" },
    );
  });

  eachItem(issues, resume.certificates, "certificates", "资格证书", (scope, certificate) => {
    scope.required("name", certificate.name, "证书名称");
    scope.dateRange(
      { field: "issueDate", value: certificate.issueDate, label: "获得日期" },
      { field: "expiryDate", value: certificate.expiryDate, label: "到期日期" },
    );
  });

  eachItem(issues, resume.socialProfiles, "socialProfiles", "社交主页", (scope, social) => {
    scope.required("platform", social.platform, "平台");
    scope.required("url", social.url, "链接");
    scope.url("url", social.url, "链接");
  });

  eachItem(issues, resume.volunteerExperiences, "volunteerExperiences", "志愿者服务", (scope, volunteer) => {
    scope.required("organizationName", volunteer.organizationName, "组织名称");
    scope.dateRange(
      { field: "startDate", value: volunteer.startDate, label: "开始时间" },
      { field: "endDate", value: volunteer.endDate, label: "结束时间" },
    );
  });

  return { valid: issues.length === 0, issues };
}
