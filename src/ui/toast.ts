import { readonly, ref } from "vue";

/**
 * 全局轻提示（toast）。
 *
 * 约定：所有「结果 / 失败 / 进度汇总」类消息都走这里，不再在页面里插通知条，
 * 避免提示出现时把下面的内容顶下去。提示浮在所有面板之上，只占屏幕右上角一小块。
 */
export type ToastTone = "ok" | "error" | "info";

export interface ToastAction {
  label: string;
  href: string;
}

export interface ToastInput {
  title: string;
  tone?: ToastTone;
  /** 逐行补充说明，按顺序显示。 */
  lines?: string[];
  /** 右下角的操作链接，通常指向直聘页面。 */
  actions?: ToastAction[];
  /** 自动关闭的毫秒数；0 表示必须手动关闭。不传时按内容和语气推断。 */
  timeout?: number;
}

export interface Toast {
  id: number;
  title: string;
  tone: ToastTone;
  lines: string[];
  actions: ToastAction[];
  timeout: number;
}

/** 同时最多显示几条，超出时挤掉最旧的。 */
const MAX_VISIBLE = 4;

const state = ref<Toast[]>([]);
let seq = 0;

/** 只读的当前提示列表，供 ToastHost 渲染。 */
export const toasts = readonly(state);

function defaultTimeout(tone: ToastTone, lines: string[], actions: ToastAction[]): number {
  // 带链接或内容较长的提示会被人读，交给用户自己关；短提示自动消失。
  if (actions.length || lines.length > 2) return 0;
  return tone === "error" ? 8000 : 4500;
}

/**
 * 弹出一条提示。同标题、同语气的提示只保留一条（原地刷新），
 * 这样自动保存失败这类重复事件不会刷出一屏。
 */
export function toast(input: ToastInput): number {
  const tone = input.tone ?? "info";
  const lines = (input.lines ?? []).filter((line) => line.trim().length > 0);
  const actions = input.actions ?? [];
  const timeout = input.timeout ?? defaultTimeout(tone, lines, actions);
  const duplicate = state.value.findIndex((item) => item.title === input.title && item.tone === tone);
  if (duplicate >= 0) state.value.splice(duplicate, 1);
  const item: Toast = { id: ++seq, title: input.title, tone, lines, actions, timeout };
  state.value.unshift(item);
  if (state.value.length > MAX_VISIBLE) state.value.length = MAX_VISIBLE;
  return item.id;
}

export function dismissToast(id: number): void {
  state.value = state.value.filter((item) => item.id !== id);
}

export function clearToasts(): void {
  state.value = [];
}
