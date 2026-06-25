<script setup lang="ts">
  //---------------------------------------------------
  //
  //  VFader — a vertical fader (level bar)
  //
  //  A dark inset well that fills from the bottom to represent its value, with a
  //  label above and the value below — drag (or scroll) to change it. Echoes the
  //  Tracker sampler's parameter bar so effect params read as a little bar-graph.
  //  Supports bipolar params (fill grows from the centre line).
  //
  //---------------------------------------------------
  import { computed, ref } from 'vue';

  const props = defineProps({
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 1 },
    label: { type: String, default: '' },
    unit: { type: String, default: '' },
    bipolar: { type: Boolean, default: false },
  });
  const model = defineModel<number>({ default: 0 });

  const well = ref<HTMLElement>();

  const pct = computed(() => {
    const t = (model.value - props.min) / (props.max - props.min || 1);
    return Math.max(0, Math.min(1, t)) * 100;
  });

  const fillStyle = computed(() => {
    if (props.bipolar) {
      const p = pct.value;
      return p >= 50 ? { bottom: '50%', height: p - 50 + '%' } : { bottom: p + '%', height: 50 - p + '%' };
    }
    return { bottom: '0%', height: pct.value + '%' };
  });
  const thumbStyle = computed(() => ({ bottom: `calc(${pct.value}% - 1px)` }));
  const display = computed(() => {
    const v = Math.round(model.value);
    return props.bipolar && v > 0 ? `+${v}` : `${v}`;
  });

  function setFromClientY(clientY: number) {
    const el = well.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, 1 - (clientY - r.top) / r.height));
    let v = props.min + t * (props.max - props.min);
    v = Math.round(v / props.step) * props.step;
    model.value = Math.max(props.min, Math.min(props.max, v));
  }

  function onPointerDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setFromClientY(e.clientY);
  }
  function onPointerMove(e: PointerEvent) {
    if (e.buttons === 1) setFromClientY(e.clientY);
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const v = model.value + (e.deltaY < 0 ? props.step : -props.step);
    model.value = Math.max(props.min, Math.min(props.max, v));
  }
</script>

<template>
  <div class="vfader">
    <div class="vf-label">{{ label }}</div>
    <div class="vf-well" ref="well" @pointerdown="onPointerDown" @pointermove="onPointerMove" @wheel="onWheel">
      <div v-if="bipolar" class="vf-center" />
      <div class="vf-fill" :style="fillStyle" />
      <div class="vf-thumb" :style="thumbStyle" />
    </div>
    <div class="vf-val">
      {{ display }}<span v-if="unit" class="vf-unit"> {{ unit }}</span>
    </div>
  </div>
</template>

<style lang="scss">
  .vfader {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    user-select: none;

    .vf-label {
      font-size: 10px;
      letter-spacing: 0.04em;
      opacity: 0.6;
      white-space: nowrap;
    }
    .vf-well {
      position: relative;
      width: 30px;
      height: 76px;
      background: var(--instrument-params-container-color, #0f0f0f);
      box-shadow: inset 0 2px 8px 3px #000;
      border-radius: 3px;
      cursor: ns-resize;
      overflow: hidden;
      touch-action: none;
    }
    .vf-fill {
      position: absolute;
      left: 0;
      right: 0;
      background: rgba(255, 255, 255, 0.82);
    }
    .vf-center {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 50%;
      height: 1px;
      background: rgba(255, 255, 255, 0.18);
    }
    .vf-thumb {
      position: absolute;
      left: 0;
      right: 0;
      height: 2px;
      background: #fff;
    }
    .vf-val {
      font-family: monospace;
      font-size: 11px;
      color: #fff;
      .vf-unit {
        opacity: 0.5;
      }
    }
  }
</style>
