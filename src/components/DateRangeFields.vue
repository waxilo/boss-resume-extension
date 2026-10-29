<script setup lang="ts">
import { computed } from "vue";

/**
 * 条目表单里的「起止时间」：两个月份输入 + 结束时间的「至今」开关。
 * 打开至今时结束时间显示为「至今」，endDate 保留但不再参与校验和上传
 * （都由 isCurrent 判断），关掉后能直接回到原来的月份，不用重选。
 */
const props = withDefaults(
  defineProps<{ startDate?: string; endDate?: string; isCurrent?: boolean; startRequired?: boolean }>(),
  { startRequired: false },
);

const emit = defineEmits<{
  "update:startDate": [value: string];
  "update:endDate": [value: string | undefined];
  "update:isCurrent": [value: boolean | undefined];
}>();

const startLabel = computed(() => (props.startRequired ? "开始时间 *" : "开始时间"));

function onStart(event: Event): void {
  emit("update:startDate", (event.target as HTMLInputElement).value);
}

function onEnd(event: Event): void {
  const value = (event.target as HTMLInputElement).value;
  emit("update:endDate", value ? value : undefined);
}

function toggle(): void {
  emit("update:isCurrent", props.isCurrent ? undefined : true);
}
</script>

<template>
  <label class="field">
    <span>{{ startLabel }}</span>
    <input type="month" :value="startDate ?? ''" @input="onStart" />
  </label>
  <div class="field">
    <span>结束时间</span>
    <div class="date-now">
      <input v-if="!isCurrent" type="month" :value="endDate ?? ''" aria-label="结束时间" @input="onEnd" />
      <span v-else class="date-now__value">至今</span>
      <button
        type="button"
        class="date-now__toggle"
        :class="{ 'is-on': isCurrent }"
        :aria-pressed="Boolean(isCurrent)"
        :title="isCurrent ? '改回具体结束时间' : '结束时间填「至今」'"
        @click="toggle"
      >
        {{ isCurrent ? "取消至今" : "选至今" }}
      </button>
    </div>
  </div>
</template>
