<script setup lang="ts">
import { onBeforeUnmount, watch } from "vue";
import { dismissToast, toasts } from "../ui/toast";

/**
 * 提示的展示层：固定在右上角，叠在页面之上，不参与布局。
 * 计时在这里做（而不是在 store 里），这样鼠标悬停时可以暂停倒计时。
 */
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function stopTimer(id: number): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
}

function startTimer(id: number, ms: number): void {
  stopTimer(id);
  if (!ms) return;
  timers.set(id, setTimeout(() => dismissToast(id), ms));
}

watch(
  () => toasts.value.map((item) => item.id),
  (ids) => {
    for (const id of [...timers.keys()]) if (!ids.includes(id)) stopTimer(id);
    for (const item of toasts.value) if (!timers.has(item.id) && item.timeout) startTimer(item.id, item.timeout);
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  for (const id of [...timers.keys()]) stopTimer(id);
});
</script>

<template>
  <div class="toast-host" aria-live="polite">
    <TransitionGroup name="toast">
      <div
        v-for="item in toasts"
        :key="item.id"
        class="toast"
        :class="`toast--${item.tone}`"
        :role="item.tone === 'error' ? 'alert' : 'status'"
        @mouseenter="stopTimer(item.id)"
        @mouseleave="startTimer(item.id, item.timeout)"
      >
        <div class="toast__body">
          <strong class="toast__title">{{ item.title }}</strong>
          <p v-for="(line, index) in item.lines" :key="index" class="toast__line">{{ line }}</p>
          <div v-if="item.actions.length" class="toast__actions">
            <a v-for="action in item.actions" :key="action.href" class="text-button" :href="action.href" target="_blank" rel="noopener noreferrer">{{ action.label }}</a>
          </div>
        </div>
        <button class="toast__close" type="button" aria-label="关闭提示" @click="dismissToast(item.id)">×</button>
      </div>
    </TransitionGroup>
  </div>
</template>
