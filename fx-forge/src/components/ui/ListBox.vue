<script setup lang="ts">
  //---------------------------------------------------
  //
  //  ListBox — a scrollable list of options (Tracker-style)
  //
  //  The options are visible as text; the selected one is boxed. Click to
  //  select. Mirrors the list columns on the hardware Fill screen.
  //
  //---------------------------------------------------
  import { nextTick, onMounted, ref, watch } from 'vue';

  interface Opt {
    value: string;
    label: string;
  }
  defineProps<{ options: Opt[]; disabled?: boolean }>();
  const model = defineModel<string>({ default: '' });

  // Keep the selected item in view — long lists (FX/curves) often hold the
  // current value below the fold, where it would otherwise look unselected.
  const root = ref<HTMLElement | null>(null);
  async function scrollToSelected() {
    await nextTick();
    root.value?.querySelector<HTMLElement>('.lb-item.sel')?.scrollIntoView({ block: 'nearest' });
  }
  onMounted(scrollToSelected);
  watch(model, scrollToSelected);
</script>

<template>
  <div ref="root" class="listbox" :class="{ disabled }">
    <div
      v-for="o in options"
      :key="o.value"
      class="lb-item"
      :class="{ sel: model === o.value }"
      @click="!disabled && (model = o.value)"
    >
      {{ o.label }}
    </div>
  </div>
</template>

<style lang="scss">
  .listbox {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    background: #0c0d0e;
    border: 1px solid #2e2f31;
    border-radius: 4px;
    padding: 3px;
    user-select: none;

    &.disabled {
      opacity: 0.4;
      pointer-events: none;
    }

    .lb-item {
      padding: 2px 7px;
      font-size: 12px;
      line-height: 1.5;
      color: #cfcfcf;
      white-space: nowrap;
      cursor: pointer;
      border: 1px solid transparent;
      border-radius: 3px;
      &:hover {
        background: rgba(255, 255, 255, 0.05);
      }
      // Boxed selection, like the hardware.
      &.sel {
        border-color: #fff;
        color: #fff;
      }
    }

    &::-webkit-scrollbar {
      width: 6px;
    }
    &::-webkit-scrollbar-thumb {
      background: #2e2f31;
      border-radius: 3px;
    }
  }
</style>
