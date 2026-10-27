import type { BossResumeDocument } from "./types";

export interface ResumeValidationIssue {
  path: string;
  message: string;
}

export interface ResumeValidationResult {
  valid: boolean;
  issues: ResumeValidationIssue[];
}

const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/;
const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

function addRequired(
  issues: ResumeValidationIssue[],
  path: string,
  value: string,
  label: string,
): void {
  if (value.trim().length === 0) {
    issues.push({ path, message: `${label}为必填项` });
  }
}

function isValidDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) {
    return false;
  }

  if (value.length === 7) {
    return true;
  }

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function addDateIssue(
  issues: ResumeValidationIssue[],
  path: string,
  value: string | undefined,
): void {
  if (value !== undefined && value !== "" && !isValidDate(value)) {
    issues.push({ path, message: "日期必须为有效的 YYYY-MM 或 YYYY-MM-DD 格式" });
  }
}

function addDateRangeIssue(
  issues: ResumeValidationIssue[],
  startPath: string,
  startDate: string | undefined,
  endPath: string,
  endDate: string | undefined,
): void {
  addDateIssue(issues, startPath, startDate);
  addDateIssue(issues, endPath, endDate);

  if (startDate && endDate && startDate > endDate) {
    issues.push({ path: endPath, message: "结束日期不能早于开始日期" });
  }
}

/** 校验可编辑的 BOSS 简历字段，不对未映射原始字段施加规则。 */
export function validateResume(resume: BossResumeDocument): ResumeValidationResult {
  const issues: ResumeValidationIssue[] = [];

  addRequired(issues, "title", resume.title, "简历名称");
  addRequired(issues, "profile.name", resume.profile.name, "姓名");
  addDateIssue(issues, "profile.workStartDate", resume.profile.workStartDate);
  addDateIssue(issues, "profile.birthDate", resume.profile.birthDate);

  resume.workExperiences.forEach((experience, index) => {
    const path = `workExperiences[${index}]`;
    addRequired(issues, `${path}.companyName`, experience.companyName, "公司名称");
    addRequired(issues, `${path}.positionName`, experience.positionName, "职位名称");
    addRequired(issues, `${path}.startDate`, experience.startDate, "开始日期");
    addDateRangeIssue(
      issues,
      `${path}.startDate`,
      experience.startDate,
      `${path}.endDate`,
      experience.isCurrent ? undefined : experience.endDate,
    );
  });

  resume.projects.forEach((project, index) => {
    const path = `projects[${index}]`;
    addRequired(issues, `${path}.projectName`, project.projectName, "项目名称");
    addRequired(issues, `${path}.startDate`, project.startDate, "开始日期");
    addDateRangeIssue(issues, `${path}.startDate`, project.startDate, `${path}.endDate`, project.endDate);

    if (project.link && !URL_PATTERN.test(project.link)) {
      issues.push({ path: `${path}.link`, message: "项目链接必须是 HTTP 或 HTTPS 地址" });
    }
  });

  resume.educations.forEach((education, index) => {
    const path = `educations[${index}]`;
    addRequired(issues, `${path}.schoolName`, education.schoolName, "学校名称");
    addDateRangeIssue(issues, `${path}.startDate`, education.startDate, `${path}.endDate`, education.endDate);
  });

  resume.certificates.forEach((certificate, index) => {
    const path = `certificates[${index}]`;
    addRequired(issues, `${path}.name`, certificate.name, "证书名称");
    addDateRangeIssue(issues, `${path}.issueDate`, certificate.issueDate, `${path}.expiryDate`, certificate.expiryDate);
  });

  resume.socialProfiles.forEach((socialProfile, index) => {
    const path = `socialProfiles[${index}]`;
    addRequired(issues, `${path}.platform`, socialProfile.platform, "社交平台");
    addRequired(issues, `${path}.url`, socialProfile.url, "社交主页链接");

    if (socialProfile.url && !URL_PATTERN.test(socialProfile.url)) {
      issues.push({ path: `${path}.url`, message: "社交主页链接必须是 HTTP 或 HTTPS 地址" });
    }
  });

  resume.volunteerExperiences.forEach((experience, index) => {
    const path = `volunteerExperiences[${index}]`;
    addRequired(issues, `${path}.organizationName`, experience.organizationName, "志愿服务组织");
    addDateRangeIssue(issues, `${path}.startDate`, experience.startDate, `${path}.endDate`, experience.endDate);
  });

  return { valid: issues.length === 0, issues };
}
