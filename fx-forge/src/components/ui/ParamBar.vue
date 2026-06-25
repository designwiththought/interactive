<script setup lang="ts">
  //---------------------------------------------------
  //
  //  ParamBar — a Polyend-style parameter bar
  //
  //  A full-width row of tall vertical faders with a footer of label/value cells
  //  and hairline dividers, modeled on the Tracker's Instrument Parameters
  //  screen. Drag or scroll a column to set its value; bipolar params fill from
  //  a centre line; the column being edited is outlined.
  //
  //---------------------------------------------------
  interface Param {
    id: string;
    label: string;
    min: number;
    max: number;
    step?: number;
    unit?: string;
  }

  import { ref } from 'vue';

  defineProps<{ params: Param[] }>();
  const model = defineModel<Record<string, number>>({ default: () => ({}) });
  const activeId = ref<string | null>(null);

  function valOf(p: Param) {
    return model.value[p.id] ?? 0;
  }
  function pct(p: Param) {
    const t = (valOf(p) - p.min) / (p.max - p.min || 1);
    return Math.max(0, Math.min(1, t)) * 100;
  }
  function fillStyle(p: Param) {
    const pc = pct(p);
    if (p.min < 0) {
      return pc >= 50 ? { bottom: '50%', height: pc - 50 + '%' } : { bottom: pc + '%', height: 50 - pc + '%' };
    }
    return { bottom: '0%', height: pc + '%' };
  }
  function disp(p: Param) {
    const v = Math.round(valOf(p));
    return p.min < 0 && v > 0 ? `+${v}` : `${v}`;
  }

  function setFrom(p: Param, el: HTMLElement, clientY: number) {
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
    const step = p.step ?? 1;
    let v = p.min + t * (p.max - p.min);
    v = Math.round(v / step) * step;
    model.value = { ...model.value, [p.id]: Math.max(p.min, Math.min(p.max, v)) };
  }
  function onDown(e: PointerEvent, p: Param) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    activeId.value = p.id;
    setFrom(p, el, e.clientY);
  }
  function onMove(e: PointerEvent, p: Param) {
    if (e.buttons === 1) setFrom(p, e.currentTarget as HTMLElement, e.clientY);
  }
  function onUp() {
    activeId.value = null;
  }
  function onWheel(e: WheelEvent, p: Param) {
    e.preventDefault();
    const step = p.step ?? 1;
    const v = valOf(p) + (e.deltaY < 0 ? step : -step);
    model.value = { ...model.value, [p.id]: Math.max(p.min, Math.min(p.max, v)) };
  }
</script>

<template>
  <div class="param-bar">
    <div class="pb-wells">
      <div
        v-for="p in params"
        :key="p.id"
        class="pb-well"
        :class="{ active: activeId === p.id }"
        @pointerdown="(e) => onDown(e, p)"
        @pointermove="(e) => onMove(e, p)"
        @pointerup="onUp"
        @wheel="(e) => onWheel(e, p)"
      >
        <div v-if="p.min < 0" class="pb-center" />
        <div class="pb-fill" :style="fillStyle(p)" />
      </div>
    </div>
    <div class="pb-footer">
      <div v-for="p in params" :key="p.id" class="pb-cell">
        <span class="pb-label">{{ p.label }}</span>
        <span class="pb-val"
          >{{ disp(p) }}<i v-if="p.unit"> {{ p.unit }}</i></span
        >
      </div>
    </div>
  </div>
</template>

<style lang="scss">
  .param-bar {
    user-select: none;

    // Narrow portrait columns, left-aligned — not stretched to full width.
    --pb-col: 88px;
    --pb-gap: 6px;

    .pb-wells {
      display: flex;
      gap: var(--pb-gap);
    }
    .pb-well {
      position: relative;
      width: var(--pb-col);
      height: 170px;
      background: #0c0d0e;
      border: 1px solid #2e2f31;
      border-radius: 4px;
      overflow: hidden;
      cursor: ns-resize;
      touch-action: none;

      &.active {
        border-color: var(--pattern-step-recording-color);
      }
    }
    .pb-fill {
      position: absolute;
      left: 0;
      right: 0;
      background: #f1f1f1;
    }
    .pb-center {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 50%;
      height: 1px;
      background: rgba(255, 255, 255, 0.45);
    }

    .pb-footer {
      display: flex;
      gap: var(--pb-gap);
      margin-top: 4px;
    }
    .pb-cell {
      position: relative;
      width: var(--pb-col);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 3px;
      padding: 6px 0;
      text-align: center;

      &:not(:last-child)::after {
        content: '';
        position: absolute;
        right: calc(var(--pb-gap) / -2);
        top: 10%;
        height: 80%;
        width: 1px;
        background: #2a2b2d;
      }
      .pb-label {
        font-size: 11px;
        color: var(--pattern-step-label-color);
      }
      .pb-val {
        font-size: 13px;
        color: #fff;
        i {
          font-style: normal;
          opacity: 0.5;
        }
      }
    }
  }
</style>
