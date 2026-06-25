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
  import { computed, ref, type PropType } from 'vue';
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
  } from '@/forge/index.ts';
  import Button from '@/components/ui/Button.vue';

  const props = defineProps({
    pattern: {
      type: Object as PropType<PatternData | null>,
      default: null,
    },
  });
  const emit = defineEmits<{ changed: [] }>();

  //----------------------------------
  // View geometry
  //----------------------------------
  const PAD = { l: 30, r: 10, t: 10, b: 20 };
  const VIEW_H = 220;
  const LANE_COLORS = ['#e8a04e', '#4ec9b0'];

  //----------------------------------
  // State
  //----------------------------------
  const trackIndex = ref(0);
  const rangeFrom = ref<number | null>(null);
  const rangeTo = ref<number | null>(null);
  const pendingEnd = ref(false);

  const effectId = ref(EFFECTS[0].id);
  const placeNotes = ref(true);
  const seed = ref(1);

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
    const ls = selectedEffect.value.lanes;
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
    <div class="toolbar">
      <label>
        Track
        <select v-model.number="trackIndex">
          <option v-for="n in numTracks" :key="n" :value="n - 1">{{ n }}</option>
        </select>
      </label>
      <span class="range-readout"
        >Range: <strong>{{ rangeLabel }}</strong></span
      >
      <Button @click="selectWholeTrack"><sup>Sel</sup> Whole Track</Button>
      <span class="hint">click two steps to set a range</span>
    </div>

    <!-- Line-graph view of the two FX lanes -->
    <svg class="graph" :viewBox="`0 0 ${viewW} ${VIEW_H}`" :style="{ width: viewW + 'px' }" preserveAspectRatio="none">
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

    <div class="legend">
      <span><i :style="{ background: LANE_COLORS[0] }" /> Lane 1: {{ laneLegend(0) }}</span>
      <span><i :style="{ background: LANE_COLORS[1] }" /> Lane 2: {{ laneLegend(1) }}</span>
    </div>

    <div class="builders">
      <!-- Preset effects -->
      <section>
        <h4>Drop an effect</h4>
        <div class="row">
          <select v-model="effectId">
            <option v-for="e in EFFECTS" :key="e.id" :value="e.id">{{ e.name }}</option>
          </select>
          <span class="lanes">{{ effectLaneLabel }}</span>
        </div>
        <p class="desc">{{ selectedEffect.description }}</p>
        <div class="row">
          <Button @click="dropEffect"><sup>Drop</sup> into {{ rangeLabel }}</Button>
          <label class="check"><input type="checkbox" v-model="placeNotes" /> place notes</label>
        </div>
      </section>

      <!-- Custom builder -->
      <section>
        <h4>
          Build a custom effect <small>({{ customLaneCount }}/{{ MAX_FX_LANES }} lanes)</small>
        </h4>
        <div class="row">
          <span class="lane-tag" :style="{ color: LANE_COLORS[0] }">Lane 1</span>
          <select v-model="lane1Fx">
            <option v-for="f in AUTOMATABLE_FX" :key="f.symbol" :value="f.symbol">{{ f.symbol }} · {{ f.name }}</option>
          </select>
          <select v-model="lane1Curve">
            <option v-for="c in CURVES" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="row">
          <label class="check"><input type="checkbox" v-model="lane2On" :disabled="MAX_FX_LANES < 2" /></label>
          <span class="lane-tag" :style="{ color: LANE_COLORS[1] }">Lane 2</span>
          <select v-model="lane2Fx" :disabled="!lane2On">
            <option v-for="f in AUTOMATABLE_FX" :key="f.symbol" :value="f.symbol">{{ f.symbol }} · {{ f.name }}</option>
          </select>
          <select v-model="lane2Curve" :disabled="!lane2On">
            <option v-for="c in CURVES" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </div>
        <div class="row">
          <Button @click="applyCustom"><sup>Apply</sup> to {{ rangeLabel }}</Button>
          <Button @click="clearFx"><sup>Clear</sup> FX</Button>
        </div>
      </section>
    </div>
  </div>
</template>

<style lang="scss">
  div.fx-graph {
    --fxg-border: var(--pattern-overlay-accent-color, #555);
    width: 100%;
    max-width: calc((124px * 8) + 36px + (3px * 7));
    color: var(--pattern-step-note-color, #ddd);
    font-size: 12px;

    .toolbar,
    .legend,
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .toolbar {
      margin-bottom: 6px;
      flex-wrap: wrap;
    }
    .hint {
      opacity: 0.5;
    }
    .range-readout strong {
      color: #fff;
    }

    select,
    input[type='checkbox'] {
      font-family: inherit;
      font-size: 12px;
    }
    select {
      height: 26px;
      padding: 0 6px;
      border: 1px solid var(--fxg-border);
      border-radius: 4px;
      background: var(--pattern-step-bg-color, #1b1b1b);
      color: inherit;
    }

    svg.graph {
      display: block;
      height: 220px;
      max-width: 100%;
      background: var(--pattern-step-bg-color, #161616);
      border: 1px solid var(--fxg-border);
      border-radius: 6px;

      .range-band {
        fill: rgba(255, 255, 255, 0.07);
      }
      .beat {
        stroke: rgba(255, 255, 255, 0.08);
        stroke-width: 1;
      }
      .axis {
        stroke: rgba(255, 255, 255, 0.25);
        stroke-width: 1;
      }
      .axis-label {
        fill: rgba(255, 255, 255, 0.35);
        font-size: 9px;
      }
      .curve {
        fill: none;
        stroke-width: 1.5;
      }
      .hit {
        fill: transparent;
        cursor: pointer;
        &:hover {
          fill: rgba(255, 255, 255, 0.05);
        }
      }
    }

    .legend {
      margin: 6px 0 12px;
      opacity: 0.85;
      i {
        display: inline-block;
        width: 10px;
        height: 10px;
        border-radius: 2px;
        margin-right: 4px;
        vertical-align: middle;
      }
    }

    .builders {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
    }
    @media (max-width: 720px) {
      .builders {
        grid-template-columns: 1fr;
      }
    }
    section {
      border: 1px solid var(--fxg-border);
      border-radius: 6px;
      padding: 10px 12px;
      h4 {
        margin: 0 0 8px;
        font-size: 13px;
        small {
          opacity: 0.6;
          font-weight: normal;
        }
      }
      .row {
        margin: 6px 0;
        flex-wrap: wrap;
      }
      .desc {
        margin: 4px 0 8px;
        opacity: 0.6;
        min-height: 2.4em;
      }
      .lanes {
        font-family: monospace;
        opacity: 0.8;
      }
      .lane-tag {
        font-weight: bold;
        min-width: 44px;
      }
      .check {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        opacity: 0.8;
      }
    }
  }
</style>
