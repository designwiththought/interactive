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
  import ParamBar from '@/components/ui/ParamBar.vue';

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

  const effectId = ref(EFFECTS[0].id);
  const effectParams = ref<Record<string, number>>(defaultParams(EFFECTS[0]));
  const placeNotes = ref(true);
  const seed = ref(1);

  // Reset knobs to the new effect's defaults whenever the effect changes.
  watch(effectId, (id) => {
    effectParams.value = defaultParams(EFFECTS_BY_ID[id]);
  });

  const lane1Fx = ref('L'); // Low-pass
  const lane1Curve = ref('ramp-up');
  const lane2On = ref(false);
  const lane2Fx = ref('V'); // Volume
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

  const selectedEffect = computed(() => EFFECTS_BY_ID[effectId.value]);
  const effectLaneLabel = computed(() => {
    const ls = selectedEffect.value.lanes(effectParams.value);
    return `${ls.map((l) => l.fx).join(' + ')}  (${ls.length}/${MAX_FX_LANES} lanes)`;
  });
  const customLaneCount = computed(() => 1 + (lane2On.value ? 1 : 0));

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
  function dropEffect() {
    if (!props.pattern) return;
    applyEffect(props.pattern, effectId.value, {
      track: trackIndex.value,
      range: effectiveRange.value,
      seed: seed.value,
      withNotes: placeNotes.value,
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
      withNotes: placeNotes.value,
      seed: seed.value,
    });
    if (lane2On.value && MAX_FX_LANES > 1) {
      applyCurve(props.pattern, {
        track: trackIndex.value,
        range: effectiveRange.value,
        fx: lane2Fx.value,
        curveId: lane2Curve.value,
        lane: 1,
        seed: seed.value,
      });
    }
    emit('changed');
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

    <!-- Effect selector (full width, above the graph + params) -->
    <div class="fxg-line effect-head">
      <span class="fxg-label">Effect</span>
      <select v-model="effectId">
        <option v-for="e in EFFECTS" :key="e.id" :value="e.id">{{ e.name }}</option>
      </select>
      <span class="budget">{{ effectLaneLabel }}</span>
      <span class="desc">{{ selectedEffect.description }}</span>
    </div>

    <!-- Graph (left) sits beside the effect parameters (right) -->
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
      <div class="fxg-params-col">
        <ParamBar :params="selectedEffect.params" v-model="effectParams" />
      </div>
    </div>

    <div class="fxg-line drop-row">
      <Button small @click="dropEffect"><sup>Drop</sup> into {{ rangeLabel }}</Button>
      <label class="check"><input type="checkbox" v-model="placeNotes" /> place notes</label>
    </div>

    <!-- Custom builder: one compact row -->
    <div class="fxg-custom">
      <span class="fxg-label">Custom · {{ customLaneCount }}/{{ MAX_FX_LANES }}</span>
      <span class="lane-tag" :style="{ color: LANE_COLORS[0] }">L1</span>
      <select v-model="lane1Fx">
        <option v-for="f in AUTOMATABLE_FX" :key="f.symbol" :value="f.symbol">{{ f.symbol }} · {{ f.name }}</option>
      </select>
      <select v-model="lane1Curve">
        <option v-for="c in CURVES" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <label class="check"><input type="checkbox" v-model="lane2On" :disabled="MAX_FX_LANES < 2" /></label>
      <span class="lane-tag" :style="{ color: LANE_COLORS[1] }">L2</span>
      <select v-model="lane2Fx" :disabled="!lane2On">
        <option v-for="f in AUTOMATABLE_FX" :key="f.symbol" :value="f.symbol">{{ f.symbol }} · {{ f.name }}</option>
      </select>
      <select v-model="lane2Curve" :disabled="!lane2On">
        <option v-for="c in CURVES" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <Button small @click="applyCustom"><sup>Apply</sup> to {{ rangeLabel }}</Button>
      <Button small @click="clearFx"><sup>Clear</sup> FX</Button>
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
      height: 170px; // matches the parameter-bar fader wells
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

    .fxg-line {
      margin: 8px 0;
      flex-wrap: wrap;
    }
    .desc {
      opacity: 0.5;
      line-height: 1.35;
    }
    .budget {
      font-family: monospace;
      font-size: 11px;
      color: var(--pattern-step-label-color);
    }
    .lane-tag {
      font-weight: bold;
    }
    .check {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      opacity: 0.65;
    }

    .effect-head {
      margin: 4px 0 8px;
    }

    // Graph (left, fills the width) beside the effect parameters (right). The
    // graph height matches the fader wells so they read as one row.
    .fxg-main {
      display: flex;
      align-items: flex-start;
      gap: 20px;
    }
    .fxg-graph-col {
      flex: 1;
      min-width: 0;
    }
    .fxg-params-col {
      flex: 0 0 auto;
    }
    .drop-row {
      margin-top: 12px;
    }
    @media (max-width: 720px) {
      .fxg-main {
        flex-direction: column;
      }
      .fxg-params-col {
        width: 100%;
      }
    }

    // Custom builder: one calm row, divided from the effect block by a hairline.
    .fxg-custom {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
      padding-top: 14px;
      border-top: 1px solid #1c1c1c;
    }
  }
</style>
