<script setup lang="ts">
  //---------------------------------------------------
  //
  //  FxGraph — line-graph view of a track's FX + effect builder
  //
  //  An alternate way of viewing a track: the two FX lanes drawn as automation
  //  curves over the steps. You select a step range, then either drop a preset
  //  audio effect (Tape Stop, Riser…) or build a custom one by assigning a
  //  curve to each FX lane — always within the 2-FX-per-step hardware budget.
  //
  //---------------------------------------------------
  import { computed, ref, watch, type PropType } from 'vue';
  import type { PatternData } from '@polyend/tracker-lib';
  import {
    EFFECTS,
    EFFECTS_BY_ID,
    CURVES,
    AUTOMATABLE_FX,
    MAX_FX_LANES,
    applyEffect,
    applyCurve,
    clearRange,
    laneSeries,
    defaultParams,
  } from '@/forge/index.ts';
  import Button from '@/components/ui/Button.vue';
  import Slider from '@/components/ui/Slider.vue';

  const props = defineProps({
    pattern: {
      type: Object as PropType<PatternData | null>,
      default: null,
    },
    playStep: {
      type: Number,
      default: -1,
    },
  });
  const emit = defineEmits<{ changed: [] }>();

  //----------------------------------
  // View geometry
  //----------------------------------
  const PAD = { l: 30, r: 10, t: 10, b: 20 };
  const VIEW_H = 170; // matches the rendered graph height (px) to avoid vertical distortion
  // Monochrome white graph, matching the sampler. Lane 2 is a dimmer white so
  // the two lanes stay distinguishable.
  const LANE_COLORS = ['#ffffff', 'rgba(255,255,255,0.5)'];

  //----------------------------------
  // State
  //----------------------------------
  const trackIndex = ref(0);
  const rangeFrom = ref<number | null>(null);
  const rangeTo = ref<number | null>(null);
  const pendingEnd = ref(false);

  const CUSTOM = 'custom';
  const NONE = 'none';
  const effectId = ref(EFFECTS[0].id);
  const effectParams = ref<Record<string, number>>(defaultParams(EFFECTS[0]));
  const seed = ref(1);

  // Reset knobs to the new effect's defaults whenever a preset is chosen.
  watch(effectId, (id) => {
    if (id !== CUSTOM) effectParams.value = defaultParams(EFFECTS_BY_ID[id]);
  });

  const lane1Fx = ref('L'); // Low-pass
  const lane1Curve = ref('ramp-up');
  const lane2Fx = ref(NONE); // None = lane 2 off
  const lane2Curve = ref('ramp-down');

  //----------------------------------
  // Derived
  //----------------------------------
  const track = computed(() => props.pattern?.tracks[trackIndex.value] ?? null);
  const numTracks = computed(() => props.pattern?.tracks.length ?? 0);
  const numSteps = computed(() => (track.value ? track.value.length + 1 : 0));
  const viewW = computed(() => Math.max(480, numSteps.value * 26));

  const series = computed(() => {
    if (!props.pattern) return [[], []];
    return [laneSeries(props.pattern, trackIndex.value, 0), laneSeries(props.pattern, trackIndex.value, 1)];
  });

  const effectiveRange = computed(() => ({
    from: rangeFrom.value ?? 0,
    to: rangeTo.value ?? Math.max(0, numSteps.value - 1),
  }));
  const rangeLabel = computed(() =>
    rangeFrom.value == null ? 'whole track' : `steps ${effectiveRange.value.from + 1}–${effectiveRange.value.to + 1}`,
  );

  const isCustom = computed(() => effectId.value === CUSTOM);
  const selectedEffect = computed(() => EFFECTS_BY_ID[effectId.value] ?? null);
  // Effect selector options: the presets, then Custom.
  const effectOptions = computed(() => [
    ...EFFECTS.map((e) => ({ id: e.id, name: e.name })),
    { id: CUSTOM, name: 'Custom' },
  ]);
  // Lane-2 FX dropdown gains a leading "None" entry (replaces the enable checkbox).
  const lane2Options = computed(() => [{ symbol: NONE, name: 'None' }, ...AUTOMATABLE_FX]);

  const customLaneCount = computed(() => (lane2Fx.value === NONE ? 1 : 2));
  const laneBudget = computed(() => {
    if (isCustom.value) {
      const fx = lane2Fx.value === NONE ? lane1Fx.value : `${lane1Fx.value} + ${lane2Fx.value}`;
      return `${fx} · ${customLaneCount.value}/${MAX_FX_LANES} FX`;
    }
    const ls = selectedEffect.value!.lanes(effectParams.value);
    return `${ls.map((l) => l.fx).join(' + ')} · ${ls.length}/${MAX_FX_LANES} FX`;
  });
  const effectDesc = computed(() =>
    isCustom.value ? 'Build your own from an FX and a curve per lane.' : (selectedEffect.value?.description ?? ''),
  );

  //----------------------------------
  // SVG mapping
  //----------------------------------
  const xOf = (step: number) =>
    PAD.l + (numSteps.value <= 1 ? 0 : (step / (numSteps.value - 1)) * (viewW.value - PAD.l - PAD.r));
  const yOf = (norm: number) => PAD.t + (1 - norm) * (VIEW_H - PAD.t - PAD.b);
  const stepW = computed(() => (numSteps.value <= 1 ? 20 : (viewW.value - PAD.l - PAD.r) / (numSteps.value - 1)));

  // Contiguous runs of non-empty points per lane (so gaps break the line).
  function runsFor(laneIdx: number): { x: number; y: number; step: number; symbol: string; display: number }[][] {
    const pts = series.value[laneIdx];
    const runs: { x: number; y: number; step: number; symbol: string; display: number }[][] = [];
    let current: { x: number; y: number; step: number; symbol: string; display: number }[] = [];
    for (const p of pts) {
      if (p.norm == null) {
        if (current.length) runs.push(current);
        current = [];
      } else {
        current.push({ x: xOf(p.step), y: yOf(p.norm), step: p.step, symbol: p.symbol, display: p.display ?? 0 });
      }
    }
    if (current.length) runs.push(current);
    return runs;
  }
  const lane0Runs = computed(() => runsFor(0));
  const lane1Runs = computed(() => runsFor(1));
  const polyline = (run: { x: number; y: number }[]) => run.map((p) => `${p.x},${p.y}`).join(' ');

  const beatLines = computed(() => {
    const lines: number[] = [];
    for (let s = 0; s < numSteps.value; s += 4) lines.push(xOf(s));
    return lines;
  });

  const laneLegend = (laneIdx: number) => {
    const syms = [...new Set(series.value[laneIdx].filter((p) => p.symbol !== '-').map((p) => p.symbol))];
    return syms.length ? syms.join(' ') : '—';
  };

  //----------------------------------
  // Range selection (two clicks)
  //----------------------------------
  function onStepClick(step: number) {
    if (!pendingEnd.value) {
      rangeFrom.value = step;
      rangeTo.value = step;
      pendingEnd.value = true;
    } else {
      const a = rangeFrom.value ?? step;
      rangeFrom.value = Math.min(a, step);
      rangeTo.value = Math.max(a, step);
      pendingEnd.value = false;
    }
  }
  function selectWholeTrack() {
    rangeFrom.value = null;
    rangeTo.value = null;
    pendingEnd.value = false;
  }

  //----------------------------------
  // Apply
  //----------------------------------
  // The single Drop action — applies the preset effect or the custom build.
  function handleDrop() {
    if (!props.pattern) return;
    if (isCustom.value) applyCustom();
    else
      applyEffect(props.pattern, effectId.value, {
        track: trackIndex.value,
        range: effectiveRange.value,
        seed: seed.value,
        withNotes: true,
        params: { ...effectParams.value },
      });
    emit('changed');
  }

  function applyCustom() {
    if (!props.pattern) return;
    clearRange(props.pattern, trackIndex.value, effectiveRange.value);
    applyCurve(props.pattern, {
      track: trackIndex.value,
      range: effectiveRange.value,
      fx: lane1Fx.value,
      curveId: lane1Curve.value,
      lane: 0,
      withNotes: true,
      seed: seed.value,
    });
    if (lane2Fx.value !== NONE && MAX_FX_LANES > 1) {
      applyCurve(props.pattern, {
        track: trackIndex.value,
        range: effectiveRange.value,
        fx: lane2Fx.value,
        curveId: lane2Curve.value,
        lane: 1,
        seed: seed.value,
      });
    }
  }

  function clearFx() {
    if (!props.pattern) return;
    clearRange(props.pattern, trackIndex.value, effectiveRange.value);
    emit('changed');
  }
</script>

<template>
  <div class="fx-graph">
    <div class="fxg-head">
      <span class="fxg-label">Track</span>
      <select v-model.number="trackIndex">
        <option v-for="n in numTracks" :key="n" :value="n - 1">{{ n }}</option>
      </select>
      <span class="fxg-label">Range</span>
      <strong class="range-readout">{{ rangeLabel }}</strong>
      <Button small @click="selectWholeTrack">Whole track</Button>
      <span class="hint">click two steps to set a range</span>
    </div>

    <!-- Graph (left, fills the width) + effect panel (right) -->
    <div class="fxg-main">
      <div class="fxg-graph-col">
        <svg class="graph" :viewBox="`0 0 ${viewW} ${VIEW_H}`" preserveAspectRatio="none">
          <!-- range band -->
          <rect
            v-if="numSteps"
            class="range-band"
            :x="xOf(effectiveRange.from) - stepW / 2"
            :y="PAD.t"
            :width="xOf(effectiveRange.to) - xOf(effectiveRange.from) + stepW"
            :height="VIEW_H - PAD.t - PAD.b"
          />
          <!-- beat gridlines -->
          <line
            v-for="(bx, i) in beatLines"
            :key="`b${i}`"
            class="beat"
            :x1="bx"
            :y1="PAD.t"
            :x2="bx"
            :y2="VIEW_H - PAD.b"
          />
          <!-- playhead -->
          <line
            v-if="playStep >= 0 && playStep < numSteps"
            class="playhead"
            :x1="xOf(playStep)"
            :y1="PAD.t"
            :x2="xOf(playStep)"
            :y2="VIEW_H - PAD.b"
          />
          <!-- axis baseline -->
          <line class="axis" :x1="PAD.l" :y1="VIEW_H - PAD.b" :x2="viewW - PAD.r" :y2="VIEW_H - PAD.b" />
          <text class="axis-label" :x="2" :y="PAD.t + 8">max</text>
          <text class="axis-label" :x="2" :y="VIEW_H - PAD.b">min</text>

          <!-- lane 0 -->
          <polyline
            v-for="(run, i) in lane0Runs"
            :key="`l0r${i}`"
            :points="polyline(run)"
            :stroke="LANE_COLORS[0]"
            class="curve"
          />
          <template v-for="(run, i) in lane0Runs" :key="`l0p${i}`">
            <circle v-for="p in run" :key="`l0-${p.step}`" :cx="p.x" :cy="p.y" r="2.5" :fill="LANE_COLORS[0]">
              <title>step {{ p.step + 1 }} · {{ p.symbol }}{{ p.display }}</title>
            </circle>
          </template>

          <!-- lane 1 -->
          <polyline
            v-for="(run, i) in lane1Runs"
            :key="`l1r${i}`"
            :points="polyline(run)"
            :stroke="LANE_COLORS[1]"
            class="curve"
          />
          <template v-for="(run, i) in lane1Runs" :key="`l1p${i}`">
            <circle v-for="p in run" :key="`l1-${p.step}`" :cx="p.x" :cy="p.y" r="2.5" :fill="LANE_COLORS[1]">
              <title>step {{ p.step + 1 }} · {{ p.symbol }}{{ p.display }}</title>
            </circle>
          </template>

          <!-- clickable step columns -->
          <rect
            v-for="s in numSteps"
            :key="`c${s}`"
            class="hit"
            :x="xOf(s - 1) - stepW / 2"
            :y="PAD.t"
            :width="stepW"
            :height="VIEW_H - PAD.t - PAD.b"
            @click="onStepClick(s - 1)"
          />
        </svg>
        <div class="fxg-legend">
          <span><i :style="{ background: LANE_COLORS[0] }" /> Lane 1 · {{ laneLegend(0) }}</span>
          <span><i :style="{ background: LANE_COLORS[1] }" /> Lane 2 · {{ laneLegend(1) }}</span>
        </div>
      </div>

      <!-- Effect panel: title selector, parameters, action row -->
      <div class="fx-panel">
        <select class="fp-title" v-model="effectId">
          <option v-for="o in effectOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
        <div class="fp-meta">
          <span class="budget">{{ laneBudget }}</span>
          <p class="desc">{{ effectDesc }}</p>
        </div>

        <div class="fp-body">
          <!-- Preset: parameter sliders -->
          <template v-if="!isCustom && selectedEffect">
            <Slider
              v-for="param in selectedEffect.params"
              :key="param.id"
              v-model="effectParams[param.id]"
              :label="param.label"
              :min="param.min"
              :max="param.max"
              :step="param.step ?? 1"
              :unit="param.unit ?? ''"
              :bipolar="param.min < 0"
            />
          </template>

          <!-- Custom: an FX + curve per lane -->
          <template v-else>
            <div class="fp-lane">
              <span class="fp-lane-label">Lane 1</span>
              <select v-model="lane1Fx">
                <option v-for="f in AUTOMATABLE_FX" :key="f.symbol" :value="f.symbol">
                  {{ f.symbol }} · {{ f.name }}
                </option>
              </select>
              <select v-model="lane1Curve">
                <option v-for="c in CURVES" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
            <div class="fp-lane">
              <span class="fp-lane-label">Lane 2</span>
              <select v-model="lane2Fx">
                <option v-for="f in lane2Options" :key="f.symbol" :value="f.symbol">
                  {{ f.symbol === 'none' ? 'None' : `${f.symbol} · ${f.name}` }}
                </option>
              </select>
              <select v-model="lane2Curve" :disabled="lane2Fx === 'none'">
                <option v-for="c in CURVES" :key="c.id" :value="c.id">{{ c.name }}</option>
              </select>
            </div>
          </template>
        </div>

        <div class="fp-actions">
          <span class="fp-range">{{ rangeLabel }}</span>
          <Button small @click="clearFx">Clear</Button>
          <Button small blue @click="handleDrop">Drop</Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
  div.fx-graph {
    width: 100%;
    max-width: calc((124px * 8) + 36px + (3px * 7));
    // Neutral light-gray text like the sampler — not the teal note color.
    color: #d8d8d8;
    font-size: 12px;

    .fxg-head,
    .fxg-legend,
    .fxg-line {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .fxg-head {
      margin-bottom: 8px;
      flex-wrap: wrap;
    }
    .hint {
      opacity: 0.4;
      font-size: 11px;
    }
    .range-readout {
      color: #fff;
      font-weight: normal;
    }

    svg.graph {
      display: block;
      width: 100%;
      height: 100%; // fills the column, matching the effect panel's height
      min-height: 200px;
      background: var(--pattern-step-bg-color);
      border: 2px solid #000;
      border-radius: 6px;

      .range-band {
        fill: rgba(255, 255, 255, 0.06);
      }
      .beat {
        stroke: var(--pattern-step-beat-bg-color);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .axis {
        stroke: rgba(255, 255, 255, 0.18);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .axis-label {
        fill: var(--pattern-step-label-color);
        font-size: 9px;
      }
      .curve {
        fill: none;
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
      }
      .playhead {
        stroke: var(--pattern-step-active-color);
        stroke-width: 1.5;
        vector-effect: non-scaling-stroke;
      }
      .hit {
        fill: transparent;
        cursor: pointer;
        &:hover {
          fill: rgba(255, 255, 255, 0.05);
        }
      }
    }

    .fxg-legend {
      margin: 8px 0 0;
      font-size: 11px;
      color: var(--pattern-step-label-color);
      i {
        display: inline-block;
        width: 9px;
        height: 9px;
        border-radius: 2px;
        margin-right: 5px;
        vertical-align: middle;
      }
    }

    // Graph (left, fills) beside the effect panel (right), stretched to one height.
    .fxg-main {
      display: flex;
      align-items: stretch;
      gap: 16px;
    }
    .fxg-graph-col {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }

    // Effect panel — title selector, parameter sliders, action row.
    .fx-panel {
      flex: 0 0 360px;
      display: flex;
      flex-direction: column;
      background: #0e0e0e;
      border: 2px solid #000;
      border-radius: 6px;
      overflow: hidden;

      // Light title bar with the effect selector, like the reference panel.
      .fp-title {
        appearance: none;
        -webkit-appearance: none;
        width: 100%;
        height: 34px;
        padding: 0 12px;
        border: 0;
        border-radius: 0;
        background: #d6d6d6;
        color: #111;
        font-weight: 700;
        font-size: 13px;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        cursor: pointer;
        box-shadow: none;
      }
      .fp-meta {
        padding: 10px 14px 0;
        .budget {
          font-family: monospace;
          font-size: 11px;
          color: var(--pattern-step-label-color);
        }
        .desc {
          margin: 4px 0 0;
          font-size: 11px;
          opacity: 0.5;
          line-height: 1.35;
          min-height: 2.2em;
        }
      }
      .fp-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 18px;
        padding: 14px;
      }
      .fp-lane {
        display: flex;
        align-items: center;
        gap: 8px;
        .fp-lane-label {
          min-width: 50px;
          color: #fff;
        }
        select {
          flex: 1;
          min-width: 0;
        }
      }
      .fp-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border-top: 1px solid #000;
        .fp-range {
          flex: 1;
          font-size: 11px;
          color: var(--pattern-step-label-color);
        }
      }
    }

    @media (max-width: 720px) {
      .fxg-main {
        flex-direction: column;
      }
      .fx-panel {
        flex-basis: auto;
      }
    }
  }
</style>
