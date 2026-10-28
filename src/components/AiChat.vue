<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, toRaw, watch } from "vue";
import { AiError } from "../ai/deepseek";
import { askResumeAssistant, summarizeChanges, type AiTurn } from "../ai/resumeAssistant";
import { isAiReady, type AiSettings } from "../ai/settings";
import type { BossResumeDocument } from "../domain/types";

const props = defineProps<{ resume: BossResumeDocument; settings: AiSettings }>();
const emit = defineEmits<{ apply: [resume: BossResumeDocument]; openSettings: [] }>();

interface ChatEntry {
  id: number;
  role: "user" | "assistant" | "error";
  content: string;
  changes?: string[];
  /** AI 改动前的简历，用于撤销这一轮。 */
  before?: BossResumeDocument;
  undone?: boolean;
}

const SUGGESTIONS = [
  "帮我润色整份简历，突出可量化成果",
  "根据下面的岗位 JD 优化简历：",
  "把工作经历改写成分点描述，动词开头",
  "写一段 300 字以内的个人优势",
];

const entries = ref<ChatEntry[]>([]);
const input = ref("");
const busy = ref(false);
const listEl = ref<HTMLElement>();
let controller: AbortController | undefined;
let seq = 0;

const ready = computed(() => isAiReady(props.settings));

/** 切换到另一份简历时清空对话，避免把上一份的上下文带过去。 */
watch(() => props.resume.localId, () => {
  controller?.abort();
  entries.value = [];
});
onBeforeUnmount(() => controller?.abort());

function push(entry: Omit<ChatEntry, "id">): void {
  entries.value.push({ id: ++seq, ...entry });
  void nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: "smooth" }));
}

function history(): AiTurn[] {
  return entries.value
    .filter((entry): entry is ChatEntry & { role: AiTurn["role"] } => entry.role !== "error")
    .map(({ role, content }) => ({ role, content }));
}

async function send(text = input.value): Promise<void> {
  const prompt = text.trim();
  if (!prompt || busy.value || !ready.value) return;
  const past = history();
  push({ role: "user", content: prompt });
  input.value = "";
  busy.value = true;
  controller = new AbortController();
  const before = structuredClone(toRaw(props.resume));
  try {
    const result = await askResumeAssistant(props.settings, before, past, prompt, controller.signal);
    if (result.resume) {
      emit("apply", result.resume);
      push({ role: "assistant", content: result.reply, changes: summarizeChanges(result.changes), before });
    } else {
      push({ role: "assistant", content: result.reply });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") push({ role: "error", content: "已停止" });
    else push({ role: "error", content: error instanceof AiError ? error.message : "AI 请求失败，请重试" });
  } finally {
    busy.value = false;
    controller = undefined;
  }
}

/** 撤销某一轮：回到那一轮之前的简历，之后各轮的改动一并失效。 */
function undo(entry: ChatEntry): void {
  if (!entry.before || busy.value) return;
  emit("apply", structuredClone(entry.before));
  const index = entries.value.indexOf(entry);
  for (const later of entries.value.slice(index)) if (later.before) later.undone = true;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    void send();
  }
}

function useSuggestion(text: string): void {
  if (text.endsWith("：")) input.value = `${text}\n`;
  else void send(text);
}
</script>

<template>
  <section class="ai-chat" aria-label="AI 编辑简历">
    <header class="ai-chat-head">
      <div>
        <h2>AI 编辑</h2>
        <p>说出你的要求，AI 会直接修改整份简历，每一轮都可以撤销。</p>
      </div>
      <button class="button button--quiet" type="button" @click="emit('openSettings')">{{ ready ? settings.model : "未配置" }} · 设置</button>
    </header>

    <div v-if="!ready" class="ai-empty">
      <p>还没有配置 AI 接口。填写 DeepSeek 的 API Key 后即可使用。</p>
      <button class="button button--accent" type="button" @click="emit('openSettings')">去配置</button>
    </div>

    <template v-else>
      <div ref="listEl" class="ai-messages" aria-live="polite">
        <div v-if="!entries.length" class="ai-empty">
          <p>可以试试：</p>
          <div class="ai-suggestions">
            <button v-for="text in SUGGESTIONS" :key="text" class="ai-suggestion" type="button" @click="useSuggestion(text)">{{ text }}</button>
          </div>
        </div>
        <div v-for="entry in entries" :key="entry.id" class="ai-msg" :class="`ai-msg--${entry.role}`">
          <p>{{ entry.content }}</p>
          <div v-if="entry.changes?.length" class="ai-changes">
            <span v-for="change in entry.changes" :key="change" class="ai-change">{{ change }}</span>
            <span v-if="entry.undone" class="ai-undone">已撤销</span>
            <button v-else class="ai-undo" type="button" :disabled="busy" @click="undo(entry)">撤销这次修改</button>
          </div>
        </div>
        <div v-if="busy" class="ai-msg ai-msg--assistant ai-msg--pending"><p>AI 正在修改简历…</p></div>
      </div>

      <form class="ai-input" @submit.prevent="send()">
        <textarea v-model="input" rows="3" placeholder="例如：按这个 JD 改写第 1 段工作经历……（Enter 发送，Shift+Enter 换行）" :disabled="busy" @keydown="onKeydown" />
        <button v-if="busy" class="button button--outline" type="button" @click="controller?.abort()">停止</button>
        <button v-else class="button button--accent" type="submit" :disabled="!input.trim()">发送</button>
      </form>
    </template>
  </section>
</template>
