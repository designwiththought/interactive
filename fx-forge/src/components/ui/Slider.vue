<script setup lang="ts">
  //---------------------------------------------------
  //
  //  Slider — a horizontal value slider
  //
  //  Label on the left, value on the right, a white-fill bar below — the clean
  //  effect-panel style. Drag anywhere on the track to set the value; bipolar
  //  params fill from a centre tick.
  //
  //---------------------------------------------------
  import { computed, ref } from 'vue';

  const props = defineProps({
    label: { type: String, default: '' },
    min: { type: Number, default: 0 },
    max: { type: Number, default: 100 },
    step: { type: Number, default: 1 },
    unit: { type: String, default: '' },
    bipolar: { type: Boolean, default: false },
  });
  const model = defineModel<number>({ default: 0 });
  const track = ref<HTMLElement>();

  const pct = computed(() => Math.max(0, Math.min(1, (model.value - props.min) / (props.max - props.min || 1))) * 100);
  const fillStyle = computed(() => {
    if (props.bipolar) {
      const p = pct.value;
      return p >= 50 ? { left: '50%', width: p - 50 + '%' } : { left: p + '%', width: 50 - p + '%' };
    }
    return { left: '0%', width: pct.value + '%' };
  });
  const display = computed(() => {
    const v = Math.round(model.value);
    return props.bipolar && v > 0 ? `+${v}` : `${v}`;
  });

  function setFromClientX(clientX: number) {
    const el = track.value;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const step = props.step;
    let v = props.min + t * (props.max - props.min);
    v = Math.round(v / step) * step;
    model.value = Math.max(props.min, Math.min(props.max, v));
  }
  function onDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setFromClientX(e.clientX);
  }
  function onMove(e: PointerEvent) {
    if (e.buttons === 1) setFromClientX(e.clientX);
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    model.value = Math.max(props.min, Math.min(props.max, model.value + (e.deltaY < 0 ? props.step : -props.step)));
  }
</script>

<template>
  <div class="hslider">
    <div class="hs-head">
      <span class="hs-label">{{ label }}</span>
      <span class="hs-val"
        >{{ display }}<i v-if="unit"> {{ unit }}</i></span
      >
    </div>
    <div class="hs-track" ref="track" @pointerdown="onDown" @pointermove="onMove" @wheel="onWheel">
      <div v-if="bipolar" class="hs-center" />
      <div class="hs-fill" :style="fillStyle" />
    </div>
  </div>
</template>

<style lang="scss">
  .hslider {
    user-select: none;

    .hs-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      margin-bottom: 6px;
    }
    .hs-label {
      font-size: 13px;
      color: #fff;
    }
    .hs-val {
      font-size: 13px;
      color: #fff;
      i {
        font-style: normal;
        opacity: 0.5;
        margin-left: 0.35em; // space between the number and its unit (e.g. 80 BPM)
      }
    }
    .hs-track {
      position: relative;
      height: 16px;
      background: #161718;
      border-radius: 4px;
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
      cursor: pointer;
      touch-action: none;
      overflow: hidden;
    }
    .hs-fill {
      position: absolute;
      top: 0;
      bottom: 0;
      background: #f1f1f1;
    }
    .hs-center {
      position: absolute;
      top: 0;
      bottom: 0;
      left: calc(50% - 1px);
      width: 1px;
      background: rgba(255, 255, 255, 0.25);
      z-index: 1;
    }
  }
</style>
