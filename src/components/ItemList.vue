<script setup lang="ts" generic="T extends { localId: string }">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import Sortable from "sortablejs";

/**
 * 条目型模块的通用编辑器（对齐 CV 项目 SectionEditor）：一条一卡，单击从底部升起编辑页，整卡可拖拽排序。
 * 直接改写传入数组（与 StringList 一致）：顺序即数组顺序，编辑器的 deep watch 负责自动保存。
 * 各模块的表单字段通过 #form 插槽提供。
 */
const props = defineProps<{
  items: T[];
  eyebrow: string;
  heading: string;
  hint: string;
  addLabel: string;
  emptyText: string;
  /** 卡片标题：用条目自己的内容，不能是「工作经历 1」这种类型名。 */
  title: (item: T) => string;
  meta: (item: T) => string;
  create: () => T;
  /** 第 index 条未通过校验的问题，来自 validateResume，用于卡片上的「待完善」标记。 */
  issuesOf: (index: number) => string[];
}>();

defineSlots<{ form(props: { item: T }): unknown }>();

/** 超过该像素位移才视为拖拽；单击时的手抖不会开拖，也不会被吞掉。 */
const DRAG_DISTANCE_PX = 10;

const editingId = ref<string>();
const pendingRemoval = ref<T>();
const sheetBody = ref<HTMLElement>();
const listEl = ref<HTMLElement>();
/** 拖完松手也会触发 pointerup，用短抑制窗口区分「拖排序」和「点开编辑」。 */
const suppressOpen = ref(false);
let pressPoint: { id: string; x: number; y: number } | undefined;
let sortable: Sortable | undefined;

const editing = computed(() => props.items.find((item) => item.localId === editingId.value));

function open(item: T): void {
  if (suppressOpen.value) return;
  editingId.value = item.localId;
  void nextTick(() => sheetBody.value?.scrollTo({ top: 0 }));
}

function close(): void {
  editingId.value = undefined;
}

function add(): void {
  const item = props.create();
  props.items.push(item);
  open(item);
}

function onPointerDown(event: PointerEvent, item: T): void {
  if (event.button !== 0) return;
  pressPoint = { id: item.localId, x: event.clientX, y: event.clientY };
}

function onPointerUp(event: PointerEvent, item: T): void {
  const start = pressPoint;
  pressPoint = undefined;
  if (!start || start.id !== item.localId || suppressOpen.value) return;
  if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > DRAG_DISTANCE_PX) return;
  open(item);
}

function cancelPress(): void {
  pressPoint = undefined;
}

/**
 * sortablejs 直接搬动了 DOM，而列表 DOM 归 Vue 管：先把节点放回原位，
 * 再改数组让 Vue 按新顺序重排，否则两边的节点顺序会对不上。
 */
function onSortEnd(event: Sortable.SortableEvent): void {
  window.setTimeout(() => (suppressOpen.value = false), 120);
  const { oldIndex, newIndex, item, from } = event;
  if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return;
  from.removeChild(item);
  from.insertBefore(item, from.children[oldIndex] ?? null);
  const [moved] = props.items.splice(oldIndex, 1);
  props.items.splice(newIndex, 0, moved);
}

/**
 * forceFallback：不用 HTML5 原生拖放，改用鼠标事件模拟，与 CV 项目一致。
 * fallbackOnBody：跟随鼠标的克隆挂到 body，否则会被 .editor-content 的 overflow 裁掉。
 * filter：排除删除按钮，按删除不会开拖。
 */
function mountSortable(el: HTMLElement): void {
  sortable = Sortable.create(el, {
    animation: 200,
    ghostClass: "item-ghost",
    fallbackClass: "item-fallback",
    filter: ".item-del",
    preventOnFilter: false,
    forceFallback: true,
    fallbackOnBody: true,
    fallbackTolerance: DRAG_DISTANCE_PX,
    onStart: () => {
      suppressOpen.value = true;
      pressPoint = undefined;
    },
    onEnd: onSortEnd,
  });
}

watch(listEl, (el) => {
  sortable?.destroy();
  sortable = undefined;
  if (el) mountSortable(el);
});

function confirmRemove(): void {
  const target = pendingRemoval.value;
  pendingRemoval.value = undefined;
  if (!target) return;
  const index = props.items.findIndex((item) => item.localId === target.localId);
  if (index >= 0) props.items.splice(index, 1);
  if (editingId.value === target.localId) close();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  if (pendingRemoval.value) pendingRemoval.value = undefined;
  else if (editingId.value) close();
  else return;
  event.preventDefault();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  sortable?.destroy();
});

/** 条目被外部删掉（AI 编辑、重新导入）时关掉编辑页，避免空白表单。 */
watch(() => props.items.map((item) => item.localId).join(","), () => {
  if (editingId.value && !editing.value) close();
});
</script>

<template>
  <div class="section-heading section-heading--action">
    <div><p class="eyebrow">{{ eyebrow }}</p><h2>{{ heading }}</h2><p>{{ hint }}</p></div>
    <button class="button button--outline" type="button" @click="add">{{ addLabel }}</button>
  </div>
  <div v-if="!items.length" class="section-empty">{{ emptyText }}</div>
  <template v-else>
    <p class="item-total">共 {{ items.length }} 条 · 单击编辑，按住拖动可调整顺序</p>
    <div ref="listEl" class="item-list">
      <div
        v-for="(element, index) in items"
        :key="element.localId"
        class="item-card"
        :class="{ active: editingId === element.localId }"
        role="button"
        tabindex="0"
        title="单击编辑，按住拖动可排序"
        @pointerdown="onPointerDown($event, element)"
        @pointerup="onPointerUp($event, element)"
        @pointercancel="cancelPress"
        @keydown.enter.prevent="open(element)"
        @keydown.space.prevent="open(element)"
      >
        <span class="item-grip" aria-hidden="true"></span>
        <span class="item-label">
          <span class="item-title">{{ title(element) }}</span>
          <span v-if="meta(element)" class="item-meta">{{ meta(element) }}</span>
        </span>
        <em v-if="issuesOf(index).length" class="nav-issue" :title="issuesOf(index).join('\n')">待完善</em>
        <button class="item-del text-button text-button--danger" type="button" :aria-label="`删除「${title(element)}」`" @pointerdown.stop @click.stop="pendingRemoval = element">删除</button>
      </div>
    </div>
  </template>

  <!-- 挂到编辑器的 composer：盖住导航 + 表单两栏，预览不受影响（与 CV 项目一致） -->
  <Teleport defer to="[data-item-sheet-host]">
    <Transition name="sheet-up">
      <div v-if="editing" class="item-sheet" role="dialog" aria-modal="true" :aria-label="title(editing)">
        <header class="sheet-head">
          <button class="sheet-icon" type="button" title="关闭（Esc）" aria-label="关闭" @click="close">⌄</button>
          <div class="sheet-title-wrap"><h3>{{ title(editing) }}</h3><span>{{ heading }} · Esc 关闭</span></div>
          <button class="text-button text-button--danger" type="button" @click="pendingRemoval = editing">删除</button>
        </header>
        <div ref="sheetBody" class="sheet-body">
          <slot name="form" :item="editing" />
        </div>
      </div>
    </Transition>
  </Teleport>

  <div v-if="pendingRemoval" class="dialog-backdrop" @click.self="pendingRemoval = undefined">
    <section class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="item-remove-title">
      <h2 id="item-remove-title">删除{{ heading }}</h2>
      <p>删除「{{ title(pendingRemoval) }}」？删除后不可恢复。</p>
      <div class="dialog-actions">
        <button class="button button--quiet" type="button" @click="pendingRemoval = undefined">取消</button>
        <button class="button button--danger-solid" type="button" @click="confirmRemove">确认删除</button>
      </div>
    </section>
  </div>
</template>
