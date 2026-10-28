/** 扩展页 → Service Worker：列出直聘简历（cv.zhipin.com/my-resumes/）里的全部简历。 */
export const BOSS_LIST_MESSAGE = "boss.list-resumes";
/** 扩展页 → Service Worker：读取一份直聘简历的详情（参数 cvId）。 */
export const BOSS_FETCH_MESSAGE = "boss.fetch-resume";

/** 直聘简历列表（myresume/querylist.json）里的一项，只留选择时要看的字段。 */
export interface CvResumeSummary {
  cvId: string;
  cvName: string;
  templateId?: string;
  templateName?: string;
  /** ISO 时间。 */
  updatedAt?: string;
}

export interface CvResumeList {
  maxCount?: number;
  resumes: CvResumeSummary[];
}

export type BossFetchErrorCode =
  | "EXTENSION_ONLY"
  | "NO_TAB"
  | "NO_DATA"
  | "PAGE_UNAVAILABLE"
  | "NOT_LOGGED_IN"
  | "SECURITY_BLOCKED"
  | "RATE_LIMITED"
  | "NETWORK"
  | "API_ERROR"
  | "UNEXPECTED_RESPONSE";

export interface BossFetchError {
  code: BossFetchErrorCode;
  message: string;
  detail?: string;
}

export type BossPageOutcome<T> = { ok: true; data: T } | { ok: false; error: BossFetchError };
