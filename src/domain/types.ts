export type BossResumeSource = "boss-import" | "manual" | "copy";

export type BossResumeSyncState =
  | "unbound"
  | "synced"
  | "local-dirty"
  | "upload-failed"
  | "unsupported";

export interface BossResumeDocument {
  localId: string;
  title: string;
  source: BossResumeSource;
  createdAt: string;
  updatedAt: string;
  lastBossFetchedAt?: string;
  /** 最近一次成功上传到 BOSS（新增一份简历）的时间；上传不改变 BOSS 已有简历。 */
  lastBossUploadedAt?: string;
  syncState: BossResumeSyncState;
  /** 从直聘简历读取时那份简历的 cvId；刷新时按它重新读取。 */
  bossCvId?: string;
  /** 直聘简历的样式模板；上传时沿用，保证拉取后再上传样式不变。复制时保留。 */
  bossTemplateId?: string;
  /** 个人优势 / 工作经历 / 项目经历的显示顺序（advantage、work、projects），对应直聘简历的模块排序。缺省按默认顺序。 */
  sectionOrder?: string[];
  profile: BossProfile;
  advantage: string;
  jobIntent: BossJobIntent;
  workExperiences: BossWorkExperience[];
  projects: BossProject[];
  educations: BossEducation[];
  certificates: BossCertificate[];
  socialProfiles: BossSocialProfile[];
  volunteerExperiences: BossVolunteerExperience[];
  jobSearchStatus: BossJobSearchStatus;
  remoteSnapshot?: BossRemoteSnapshot;
  unmappedFields?: Record<string, unknown>;
}

export interface BossProfile {
  avatar?: string;
  name: string;
  gender?: "male" | "female" | "unknown";
  jobIdentity?: string;
  workStartDate?: string;
  birthDate?: string;
}

export interface BossJobIntent {
  jobType?: string;
  cities: string[];
  positions: string[];
  jobPreference?: string;
  salary?: string;
  industries: string[];
}

export interface BossWorkExperience {
  localId: string;
  companyName: string;
  industry?: string;
  department?: string;
  positionName: string;
  startDate: string;
  endDate?: string;
  isCurrent?: boolean;
  responsibilities?: string;
  skills: string[];
  achievements?: string;
}

export interface BossProject {
  localId: string;
  projectName: string;
  role?: string;
  startDate: string;
  endDate?: string;
  description?: string;
  achievements?: string;
  link?: string;
}

export interface BossEducation {
  localId: string;
  schoolName: string;
  degree?: string;
  major?: string;
  startDate?: string;
  endDate?: string;
  campusExperience?: string;
  thesis?: string;
}

export interface BossCertificate {
  localId: string;
  name: string;
  issuer?: string;
  credentialId?: string;
  issueDate?: string;
  expiryDate?: string;
  description?: string;
}

export interface BossSocialProfile {
  localId: string;
  platform: string;
  url: string;
  label?: string;
}

export interface BossVolunteerExperience {
  localId: string;
  organizationName: string;
  role?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
}

export interface BossJobSearchStatus {
  status?: string;
  availableDate?: string;
  preferredContactTime?: string;
  note?: string;
}

/** 从 BOSS 读取的原始响应，仅作为本地兼容与对比资料保留，不用于拼装上传请求。 */
export interface BossRemoteSnapshot {
  capturedAt: string;
  source: "fetch";
  /** 直聘简历 cvId；旧数据（从 www.zhipin.com 捕获）没有。 */
  cvId?: string;
  rawData: Record<string, unknown>;
  version?: string;
}

export interface ResumeIndexItem {
  localId: string;
  title: string;
  source: BossResumeSource;
  updatedAt: string;
  lastBossFetchedAt?: string;
  /** 最近一次成功上传到 BOSS（新增一份简历）的时间；上传不改变 BOSS 已有简历。 */
  lastBossUploadedAt?: string;
  syncState: BossResumeSyncState;
}

export interface ResumeSettings {
  lastSelectedResumeId?: string;
}
