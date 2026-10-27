const MAX_DEPTH = 10;
const MAX_ARRAY_ITEMS = 2;

/**
 * 把 BOSS 原始响应转换为“只有字段结构、没有个人内容”的样本，用于校准适配器。
 *
 * - 字符串只保留长度；浮点数、大整数（ID、时间戳、手机号）只保留类型。
 * - 0–999 的整数保留原值：它们通常是性别、学历等枚举码，映射时需要知道取值。
 * - 数组只保留前两项结构和总长度。
 */
export function buildStructureSample(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return `<string:${value.length}>`;
  if (typeof value === "boolean") return "<boolean>";
  if (typeof value === "number") {
    if (Number.isInteger(value) && value >= 0 && value <= 999) return `<integer:${value}>`;
    return Number.isInteger(value) ? "<integer>" : "<number>";
  }
  if (depth >= MAX_DEPTH) return "<truncated>";
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return [`<array:${value.length}>`, ...value.slice(0, MAX_ARRAY_ITEMS).map((item) => buildStructureSample(item, depth + 1))];
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, buildStructureSample(item, depth + 1)]),
    );
  }
  return `<${typeof value}>`;
}
