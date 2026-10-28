import type { CvApi } from "./cvPageApi";
import type { BossFetchError, BossPageOutcome, CvResumeList } from "./types";

/**
 * 在 cv.zhipin.com 页面主世界执行，读取直聘简历。须先注入 installCvApiInPage。
 *
 * - list：myresume/querylist.json，返回全部简历的名称、样式模板与更新时间；
 * - detail：myresume/query.json（参数 cvId），原样返回 zpData，由扩展页的 resumeAdapter 转换。
 *
 * 函数会被序列化后注入页面，不能引用模块作用域内的任何变量或导入（类型除外）。只读，不写任何数据。
 */
export async function cvResumeTaskInPage(task: "list" | "detail", cvId?: string): Promise<BossPageOutcome<unknown>> {
  type Raw = Record<string, unknown>;
  const isRecord = (value: unknown): value is Raw => typeof value === "object" && value !== null && !Array.isArray(value);
  const api = (window as unknown as Raw)["__bossResumeCvApi__"] as CvApi | undefined;
  if (!api) return { ok: false, error: { code: "PAGE_UNAVAILABLE", message: "直聘简历页没有装上读取工具，请重新加载扩展后重试" } };

  try {
    if (task === "list") {
      const data = await api.call("GET", "/wapi/zpcvresume/myresume/querylist.json");
      if (!isRecord(data) || !Array.isArray(data.myresumelist)) {
        return { ok: false, error: { code: "UNEXPECTED_RESPONSE", message: "直聘简历列表格式与预期不符" } };
      }
      const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
      const list: CvResumeList = {
        maxCount: typeof data.maxCount === "number" ? data.maxCount : undefined,
        resumes: data.myresumelist.filter(isRecord).flatMap((item) => {
          const id = text(item.id);
          if (!id) return [];
          return [{
            cvId: id,
            cvName: text(item.cvName) ?? "未命名简历",
            templateId: text(item.templateId),
            templateName: text(item.templateName),
            updatedAt: typeof item.updateTime === "number" ? new Date(item.updateTime).toISOString() : undefined,
          }];
        }),
      };
      return { ok: true, data: list };
    }

    if (!cvId) return { ok: false, error: { code: "API_ERROR", message: "缺少要读取的简历" } };
    const detail = await api.call("POST", "/wapi/zpcvresume/myresume/query.json", { cvId });
    if (!isRecord(detail) || !isRecord(detail.profileVO)) {
      return { ok: false, error: { code: "UNEXPECTED_RESPONSE", message: "直聘简历详情格式与预期不符：缺少 profileVO" } };
    }
    return { ok: true, data: detail };
  } catch (error) {
    const known = isRecord(error) && error.cvApiError === true ? (error as unknown as BossFetchError) : undefined;
    return {
      ok: false,
      error: known
        ? { code: known.code, message: known.message, detail: known.detail }
        : { code: "UNEXPECTED_RESPONSE", message: "读取直聘简历时出现意外错误", detail: error instanceof Error ? error.message : String(error) },
    };
  }
}
