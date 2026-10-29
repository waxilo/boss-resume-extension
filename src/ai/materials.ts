/**
 * AI 编辑的「补充材料」：用户导入的 JD、旧简历、项目笔记等纯文本，
 * 每次提问时随简历一起送给模型，用来补全和核对事实。
 *
 * 只认纯文本格式（docx / pdf 解析需要额外依赖，先不做）；从文件夹导入时
 * 会跳过 node_modules、dist 这类目录，避免把依赖里的几千个文件拖进来。
 */

export interface ResumeMaterial {
  id: string;
  /** 文件名；从文件夹导入时是相对路径。 */
  name: string;
  /** 实际送给模型的字数（截断后）。 */
  chars: number;
  /** 因为超过单文件上限被截断。 */
  truncated: boolean;
  text: string;
}

export const MATERIAL_LIMITS = {
  /** 最多同时挂几个文件。 */
  files: 24,
  /** 单个文件送进 prompt 的字数上限。 */
  perFileChars: 12000,
  /** 全部材料合计字数上限。 */
  totalChars: 40000,
  /** 超过这个大小的文件直接跳过。 */
  fileBytes: 2 * 1024 * 1024,
} as const;

const TEXT_EXTENSIONS = new Set([
  "txt", "text", "md", "markdown", "json", "jsonl", "csv", "tsv",
  "html", "htm", "xml", "yml", "yaml", "log",
]);

/** 文件夹导入时整段忽略的目录。 */
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "target", "coverage", ".git", ".idea", ".vscode"]);

export interface MaterialSkip {
  name: string;
  reason: string;
}

export interface MaterialReadResult {
  materials: ResumeMaterial[];
  /** 类型不支持 / 过大 / 读不出文字的文件。 */
  skipped: MaterialSkip[];
}

let seq = 0;

function nextId(): string {
  seq += 1;
  return `material-${Date.now()}-${seq}`;
}

/** 按单文件上限截断，并标出后面还有多少字没送进去。 */
export function createMaterial(name: string, text: string): ResumeMaterial {
  const truncated = text.length > MATERIAL_LIMITS.perFileChars;
  const clipped = truncated
    ? `${text.slice(0, MATERIAL_LIMITS.perFileChars)}…（后面还有 ${text.length - MATERIAL_LIMITS.perFileChars} 字未送入）`
    : text;
  return { id: nextId(), name, chars: clipped.length, truncated, text: clipped };
}

function relativeName(file: File): string {
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
  return path && path.length ? path : file.name;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index + 1).toLowerCase() : "";
}

/** 文件夹里的依赖 / 产物目录不算「跳过的文件」，静默忽略。 */
function isInSkippedDir(path: string): boolean {
  const parts = path.split("/").slice(0, -1);
  return parts.some((part) => SKIP_DIRS.has(part) || part.startsWith("."));
}

/**
 * 读文本：先按 UTF-8，出现替换字符（说明不是 UTF-8）再试 GBK，
 * 挑乱码更少的那个。Windows 上导出的 txt / csv 常见 GBK。
 */
async function readText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("\uFFFD")) return utf8;
  try {
    const gbk = new TextDecoder("gbk").decode(buffer);
    const utf8Broken = utf8.split("\uFFFD").length;
    const gbkBroken = gbk.split("\uFFFD").length;
    return gbkBroken < utf8Broken ? gbk : utf8;
  } catch {
    return utf8;
  }
}

/** 把 html 压成纯文本（只留正文文字，去脚本、样式和标签）。 */
export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    // html 里连续空白等价于一个空格，标签换行留下的前后空格也没意义
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 统一换行、压掉多余空行与行尾空格。 */
export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, "").replace(/[ \t]{3,}/g, "  "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 批量读取用户选中（或拖入）的文件，按纯文本处理。 */
export async function readMaterialFiles(input: FileList | File[]): Promise<MaterialReadResult> {
  const materials: ResumeMaterial[] = [];
  const skipped: MaterialSkip[] = [];
  for (const file of Array.from(input)) {
    const name = relativeName(file);
    if (isInSkippedDir(name)) continue;
    const extension = extensionOf(name);
    if (!TEXT_EXTENSIONS.has(extension)) {
      skipped.push({ name, reason: "只支持 txt / md / json / csv / html 等纯文本" });
      continue;
    }
    if (file.size > MATERIAL_LIMITS.fileBytes) {
      skipped.push({ name, reason: "文件超过 2MB" });
      continue;
    }
    try {
      const raw = await readText(file);
      const text = tidy(extension === "html" || extension === "htm" ? stripHtml(raw) : raw);
      if (!text) {
        skipped.push({ name, reason: "没有读到文字" });
        continue;
      }
      materials.push(createMaterial(name, text));
    } catch (error) {
      skipped.push({ name, reason: error instanceof Error ? error.message : "读取失败" });
    }
  }
  return { materials, skipped };
}

export function totalMaterialChars(materials: ResumeMaterial[]): number {
  return materials.reduce((sum, item) => sum + item.chars, 0);
}

/**
 * 合并到已有材料：同名（同路径）覆盖旧的；超过份数或合计字数上限的丢掉，
 * 由调用方提示用户，不静默替换已有材料。
 */
export function mergeMaterials(
  existing: ResumeMaterial[],
  incoming: ResumeMaterial[],
): { materials: ResumeMaterial[]; dropped: string[] } {
  const materials = [...existing];
  const dropped: string[] = [];
  let total = totalMaterialChars(materials);
  for (const item of incoming) {
    const index = materials.findIndex((material) => material.name === item.name);
    if (index >= 0) {
      total += item.chars - materials[index].chars;
      materials.splice(index, 1, item);
      continue;
    }
    if (materials.length >= MATERIAL_LIMITS.files) {
      dropped.push(item.name);
      continue;
    }
    if (total + item.chars > MATERIAL_LIMITS.totalChars) {
      dropped.push(item.name);
      continue;
    }
    materials.push(item);
    total += item.chars;
  }
  return { materials, dropped };
}

/** 拼进 system prompt 的材料段落；没有材料时返回空串。 */
export function buildMaterialsBlock(materials: ResumeMaterial[]): string {
  if (!materials.length) return "";
  const body = materials.map((item) => `【${item.name}】\n${item.text}`).join("\n\n");
  return `\n用户随附的补充材料（当作事实来源，用来补全和核对简历；不要照抄原文，也不要在 reply 里提文件名）：\n\n${body}\n`;
}
