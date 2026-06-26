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
  const VIEW_H = 220; // matches the rendered graph height (px) to avoid vertical distortion
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

  // Horizontal value gridlines: normalized 0..100% of each lane's FX range.
  // `y` is in viewBox units; `top` is the % down the box (for the HTML labels,
  // which sit outside the stretched SVG so they stay crisp).
  const gridLevels = computed(() =>
    [0, 25, 50, 75, 100].map((pctVal) => {
      const v = pctVal / 100;
      const y = yOf(v);
      return { value: pctVal, y, top: (y / VIEW_H) * 100 };
    }),
  );

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
    selectNodeAtStep(step); // also select this point for arrow-key editing
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

  //----------------------------------
  // Parameter cells (encoder-style: drag up/down or scroll to edit)
  //----------------------------------
  interface Param {
    id: string;
    label: string;
    min: number;
    max: number;
    step?: number;
    unit?: string;
  }
  const dragId = ref<string | null>(null);
  let dragLastY = 0;

  function paramDisplay(p: Param) {
    const v = Math.round(effectParams.value[p.id] ?? 0);
    const s = p.min < 0 && v > 0 ? `+${v}` : `${v}`;
    return p.unit ? `${s} ${p.unit}` : s;
  }
  function adjustParam(p: Param, delta: number) {
    const step = p.step ?? 1;
    let v = (effectParams.value[p.id] ?? 0) + delta;
    v = Math.round(v / step) * step;
    effectParams.value = { ...effectParams.value, [p.id]: Math.max(p.min, Math.min(p.max, v)) };
  }
  function cellDown(e: PointerEvent, p: Param) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragId.value = p.id;
    dragLastY = e.clientY;
  }
  function cellMove(e: PointerEvent, p: Param) {
    if (e.buttons !== 1 || dragId.value !== p.id) return;
    const dy = dragLastY - e.clientY; // drag up = increase
    dragLastY = e.clientY;
    adjustParam(p, (dy * (p.max - p.min)) / 180);
  }
  function cellUp() {
    dragId.value = null;
  }
  function cellWheel(e: WheelEvent, p: Param) {
    e.preventDefault();
    adjustParam(p, (e.deltaY < 0 ? 1 : -1) * (p.step ?? 1));
  }

  // Vertical fill (0..100% from the bottom; bipolar fills from the centre).
  function paramFill(p: Param) {
    const t = Math.max(0, Math.min(1, ((effectParams.value[p.id] ?? 0) - p.min) / (p.max - p.min || 1)));
    const pc = t * 100;
    if (p.min < 0)
      return pc >= 50 ? { bottom: '50%', height: pc - 50 + '%' } : { bottom: pc + '%', height: 50 - pc + '%' };
    return { bottom: '0%', height: pc + '%' };
  }

  //----------------------------------
  // Graph node editing (focus the graph, then arrow keys)
  //   Left/Right — move between nodes (points in time)
  //   Up/Down    — change the selected point's value (Shift = ×10)
  //----------------------------------
  const selectedIdx = ref(-1);
  const nodeList = computed(() => {
    const out: { lane: number; step: number }[] = [];
    for (let lane = 0; lane < 2; lane++) {
      for (const p of series.value[lane]) if (p.raw != null) out.push({ lane, step: p.step });
    }
    out.sort((a, b) => a.step - b.step || a.lane - b.lane);
    return out;
  });
  const selectedNode = computed(() => (selectedIdx.value >= 0 ? (nodeList.value[selectedIdx.value] ?? null) : null));
  function isSelected(lane: number, step: number) {
    const n = selectedNode.value;
    return !!n && n.lane === lane && n.step === step;
  }
  function adjustNode(delta: number) {
    const n = selectedNode.value;
    const fx = props.pattern?.tracks[trackIndex.value]?.steps[n?.step ?? -1]?.fx[n?.lane ?? 0];
    if (!n || !fx) return;
    fx.value = Math.max(fx.type.min, Math.min(fx.type.max, fx.value + delta));
    emit('changed');
  }
  function selectNodeAtStep(step: number) {
    const idx = nodeList.value.findIndex((n) => n.step === step);
    if (idx >= 0) selectedIdx.value = idx;
  }
  function onGraphKey(e: KeyboardEvent) {
    const list = nodeList.value;
    if (!list.length) return;
    if (selectedIdx.value < 0) selectedIdx.value = 0;
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        selectedIdx.value = Math.max(0, selectedIdx.value - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        selectedIdx.value = Math.min(list.length - 1, selectedIdx.value + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        adjustNode(e.shiftKey ? 10 : 1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        adjustNode(e.shiftKey ? -10 : -1);
        break;
    }
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
      <span class="hint">click two steps to set a range · arrow keys move &amp; edit nodes</span>
    </div>

    <!-- Graph on top (focusable: arrow keys move between nodes and change values) -->
    <div class="fxg-graph-col">
      <div class="graph-wrap" tabindex="0" @keydown="onGraphKey">
        <!-- Y-axis value labels (HTML so they stay crisp over the stretched SVG) -->
        <div class="y-axis">
          <span v-for="lvl in gridLevels" :key="`y${lvl.value}`" :style="{ top: lvl.top + '%' }">{{ lvl.value }}</span>
        </div>
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
          <!-- horizontal value gridlines -->
          <line
            v-for="lvl in gridLevels"
            :key="`h${lvl.value}`"
            class="hgrid"
            :class="{ edge: lvl.value === 0 || lvl.value === 100 }"
            :x1="PAD.l"
            :y1="lvl.y"
            :x2="viewW - PAD.r"
            :y2="lvl.y"
          />

          <!-- lane 0 -->
          <polyline
            v-for="(run, i) in lane0Runs"
            :key="`l0r${i}`"
            :points="polyline(run)"
            :stroke="LANE_COLORS[0]"
            class="curve"
          />
          <template v-for="(run, i) in lane0Runs" :key="`l0p${i}`">
            <circle
              v-for="p in run"
              :key="`l0-${p.step}`"
              class="node"
              :class="{ sel: isSelected(0, p.step) }"
              :cx="p.x"
              :cy="p.y"
              :r="isSelected(0, p.step) ? 4.5 : 2.5"
              :fill="LANE_COLORS[0]"
            >
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
            <circle
              v-for="p in run"
              :key="`l1-${p.step}`"
              class="node"
              :class="{ sel: isSelected(1, p.step) }"
              :cx="p.x"
              :cy="p.y"
              :r="isSelected(1, p.step) ? 4.5 : 2.5"
              :fill="LANE_COLORS[1]"
            >
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
      </div>
      <div class="fxg-legend">
        <span><i :style="{ background: LANE_COLORS[0] }" /> Lane 1 · {{ laneLegend(0) }}</span>
        <span><i :style="{ background: LANE_COLORS[1] }" /> Lane 2 · {{ laneLegend(1) }}</span>
      </div>
    </div>

    <!-- Effect editing: controls (faders/selects) on top, label/value footer below -->
    <div class="param-bar">
      <!-- FX type selector (leftmost): the effect, or "Custom" -->
      <div class="pcol select-col">
        <div class="pc-control">
          <select class="pc-select" v-model="effectId">
            <option v-for="o in effectOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
          </select>
        </div>
        <div class="pc-foot"><span class="pc-label">FX Type</span></div>
      </div>

      <!-- Preset: a fader per parameter -->
      <template v-if="!isCustom && selectedEffect">
        <div
          v-for="param in selectedEffect.params"
          :key="param.id"
          class="pcol fader-col"
          :class="{ active: dragId === param.id }"
          @pointerdown="(e) => cellDown(e, param)"
          @pointermove="(e) => cellMove(e, param)"
          @pointerup="cellUp"
          @wheel="(e) => cellWheel(e, param)"
        >
          <div class="pc-control">
            <div class="pc-fader">
              <div v-if="param.min < 0" class="pf-center" />
              <div class="pf-fill" :style="paramFill(param)" />
            </div>
          </div>
          <div class="pc-foot">
            <span class="pc-label">{{ param.label }}</span>
            <span class="pc-value">{{ paramDisplay(param) }}</span>
          </div>
        </div>
      </template>

      <!-- Custom: an FX + curve select per lane -->
      <template v-else>
        <div class="pcol select-col">
          <div class="pc-control">
            <select class="pc-select" v-model="lane1Fx">
              <option v-for="f in AUTOMATABLE_FX" :key="f.symbol" :value="f.symbol">
                {{ f.symbol }} · {{ f.name }}
              </option>
            </select>
          </div>
          <div class="pc-foot"><span class="pc-label">Lane 1 FX</span></div>
        </div>
        <div class="pcol select-col">
          <div class="pc-control">
            <select class="pc-select" v-model="lane1Curve">
              <option v-for="c in CURVES" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div class="pc-foot"><span class="pc-label">Curve</span></div>
        </div>
        <div class="pcol select-col">
          <div class="pc-control">
            <select class="pc-select" v-model="lane2Fx">
              <option v-for="f in lane2Options" :key="f.symbol" :value="f.symbol">
                {{ f.symbol === 'none' ? 'None' : `${f.symbol} · ${f.name}` }}
              </option>
            </select>
          </div>
          <div class="pc-foot"><span class="pc-label">Lane 2 FX</span></div>
        </div>
        <div class="pcol select-col" :class="{ disabled: lane2Fx === 'none' }">
          <div class="pc-control">
            <select class="pc-select" v-model="lane2Curve" :disabled="lane2Fx === 'none'">
              <option v-for="c in CURVES" :key="c.id" :value="c.id">{{ c.name }}</option>
            </select>
          </div>
          <div class="pc-foot"><span class="pc-label">Curve</span></div>
        </div>
      </template>

      <!-- Range (info, no control) -->
      <div class="pcol info-col">
        <div class="pc-control" />
        <div class="pc-foot">
          <span class="pc-label">Range</span><span class="pc-value">{{ rangeLabel }}</span>
        </div>
      </div>

      <!-- Actions -->
      <div class="pcol action-col" @click="clearFx"><span class="pc-action">Clear</span></div>
      <div class="pcol action-col drop" @click="handleDrop"><span class="pc-action">Drop</span></div>
    </div>
  </div>
</template>

<style lang="scss">
  div.fx-graph {
    width: 100%;
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

    // Graph area: the SVG fills it; Y-axis value labels overlay the left edge.
    .graph-wrap {
      position: relative;
      height: 220px;
      outline: 0;
      &:focus-visible .graph {
        border-color: var(--pattern-step-active-color);
      }
    }
    .y-axis {
      position: absolute;
      left: 0;
      top: 0;
      bottom: 0;
      width: 26px;
      pointer-events: none;
      z-index: 1;
      span {
        position: absolute;
        right: 4px;
        transform: translateY(-50%);
        font-size: 9px;
        color: var(--pattern-step-label-color);
      }
    }

    svg.graph {
      display: block;
      width: 100%;
      height: 100%; // fills the wrap, matching the effect panel's height
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
      .hgrid {
        stroke: rgba(255, 255, 255, 0.07);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
        &.edge {
          stroke: rgba(255, 255, 255, 0.16);
        }
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
      .node.sel {
        stroke: var(--pattern-step-active-color);
        stroke-width: 2;
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

    // Graph fills the width on top; its area is a fixed height.
    .fxg-graph-col {
      display: flex;
      flex-direction: column;
    }

    // Effect editing — controls (faders/selects) on top, label/value footer below.
    .param-bar {
      display: flex;
      margin-top: 12px;
      background: var(--pattern-step-bg-color);
      border: 2px solid #000;
      border-radius: 6px;
      overflow: hidden;
      user-select: none;
    }
    .pcol {
      position: relative;
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;

      // Thin divider between columns, like the hardware parameter bar.
      &:not(:last-child)::after {
        content: '';
        position: absolute;
        right: 0;
        top: 12%;
        height: 76%;
        width: 1px;
        background: #2a2b2d;
      }

      // The control area (fader / select) sits above the footer.
      .pc-control {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 12px 12px 6px;
        min-height: 84px;
      }
      // The footer: parameter name + value, centered.
      .pc-foot {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 6px 8px 9px;
      }
      .pc-label {
        font-size: 10px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: var(--pattern-step-label-color);
      }
      .pc-value {
        font-size: 14px;
        color: #fff;
        white-space: nowrap;
      }

      // Vertical fader (numeric params): a dark well with a white fill.
      &.fader-col {
        cursor: ns-resize;
        &:hover .pc-fader,
        &.active .pc-fader {
          border-color: #3a3b3d;
        }
      }
      .pc-fader {
        position: relative;
        width: 30px;
        height: 100%;
        max-height: 88px;
        background: #0c0d0e;
        border: 1px solid #2e2f31;
        border-radius: 4px;
        overflow: hidden;
      }
      .pf-fill {
        position: absolute;
        left: 0;
        right: 0;
        background: #f1f1f1;
      }
      .pf-center {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 50%;
        height: 1px;
        background: rgba(255, 255, 255, 0.4);
      }

      // Select columns (FX type / curve).
      &.select-col .pc-select {
        appearance: none;
        -webkit-appearance: none;
        max-width: 100%;
        padding: 0 16px 0 4px;
        border: 0;
        border-radius: 0;
        background: transparent
          url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="9" height="6"><path d="M0 0l4.5 6L9 0z" fill="%23aaa"/></svg>')
          no-repeat right center;
        color: #fff;
        font-size: 14px;
        text-align: center;
        cursor: pointer;
        box-shadow: none;
      }
      &.disabled {
        opacity: 0.4;
      }

      // Action columns (Clear / Drop) — full-height clickable like Cancel / Fill.
      &.action-col {
        flex: 0 0 auto;
        min-width: 88px;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        .pc-action {
          font-weight: 600;
          color: #fff;
        }
        &:hover {
          background: rgba(255, 255, 255, 0.05);
        }
      }
      &.action-col.drop {
        background: var(--pattern-step-active-color, #54cfc1);
        &::after {
          display: none;
        }
        .pc-action {
          color: #06231f;
        }
        &:hover {
          filter: brightness(1.08);
        }
      }
    }
  }
</style>
