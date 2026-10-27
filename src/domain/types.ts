export type BossResumeSource = "boss-import" | "manual" | "copy";

export type BossResumeSyncState =
  | "unbound"
  | "synced"
  | "local-dirty"
  | "write-failed"
  | "unsupported";

export interface BossResumeDocument {
  localId: string;
  title: string;
  source: BossResumeSource;
  createdAt: string;
  updatedAt: string;
  lastBossFetchedAt?: string;
  lastBossWrittenAt?: string;
  syncState: BossResumeSyncState;
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

/** BOSS 原始响应仅作为本地兼容与对比资料保留，不用于拼装写回请求。 */
export interface BossRemoteSnapshot {
  capturedAt: string;
  source: "fetch" | "write";
  rawData: Record<string, unknown>;
  version?: string;
}

export interface ResumeIndexItem {
  localId: string;
  title: string;
  source: BossResumeSource;
  updatedAt: string;
  lastBossFetchedAt?: string;
  lastBossWrittenAt?: string;
  syncState: BossResumeSyncState;
}

export interface ResumeSettings {
  lastSelectedResumeId?: string;
}
