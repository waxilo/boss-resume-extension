<script setup lang="ts">
const props = defineProps<{ label: string; items: string[] }>();

function add(event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = input.value.trim();
  if (value && !props.items.includes(value)) props.items.push(value);
  input.value = "";
}
</script>

<template>
  <div class="chip-group">
    <h3>{{ label }}</h3>
    <div class="chips">
      <span v-for="(item, index) in items" :key="`${item}-${index}`" class="chip">
        {{ item }}
        <button type="button" :aria-label="`删除${item}`" @click="items.splice(index, 1)">×</button>
      </span>
    </div>
    <input :aria-label="`添加${label}`" :placeholder="`输入后按 Enter 添加${label}`" @keydown.enter.prevent="add" />
  </div>
</template>
