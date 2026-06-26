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
  import ListBox from '@/components/ui/ListBox.vue';

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
  const emit = defineEmits<{ changed: []; exit: [] }>();

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

  // Option lists for the scrollable ListBoxes ({ value, label }).
  const effectListOptions = computed(() => [
    ...EFFECTS.map((e) => ({ value: e.id, label: e.name })),
    { value: CUSTOM, label: 'Custom' },
  ]);
  const fxListOptions = computed(() =>
    AUTOMATABLE_FX.map((f) => ({ value: f.symbol, label: `${f.symbol} · ${f.name}` })),
  );
  const lane2ListOptions = computed(() => [{ value: NONE, label: 'None' }, ...fxListOptions.value]);
  const curveListOptions = computed(() => CURVES.map((c) => ({ value: c.id, label: c.name })));

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

  // Node positions as percentages of the graph box (for the crisp HTML squares).
  const nodePoints = computed(() => {
    const out: {
      key: string;
      lane: number;
      step: number;
      left: number;
      top: number;
      symbol: string;
      display: number;
    }[] = [];
    [lane0Runs.value, lane1Runs.value].forEach((runs, lane) => {
      for (const run of runs) {
        for (const p of run) {
          out.push({
            key: `${lane}-${p.step}`,
            lane,
            step: p.step,
            left: (p.x / viewW.value) * 100,
            top: (p.y / VIEW_H) * 100,
            symbol: p.symbol,
            display: p.display,
          });
        }
      }
    });
    return out;
  });

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
  // Apply the preset effect or the custom build to the range.
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

  // Fill — commit the FX, then leave the effects view. Cancel — just leave.
  function handleFill() {
    handleDrop();
    emit('exit');
  }
  function handleCancel() {
    emit('exit');
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

          <!-- lane curves (nodes are drawn as HTML squares in the overlay below) -->
          <polyline
            v-for="(run, i) in lane0Runs"
            :key="`l0r${i}`"
            :points="polyline(run)"
            :stroke="LANE_COLORS[0]"
            class="curve"
          />
          <polyline
            v-for="(run, i) in lane1Runs"
            :key="`l1r${i}`"
            :points="polyline(run)"
            :stroke="LANE_COLORS[1]"
            class="curve"
          />

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

        <!-- Nodes as crisp white squares (HTML, so the SVG stretch can't distort them) -->
        <div class="nodes-layer">
          <div
            v-for="n in nodePoints"
            :key="n.key"
            class="node-sq"
            :class="{ sel: isSelected(n.lane, n.step), dim: n.lane === 1 }"
            :style="{ left: n.left + '%', top: n.top + '%' }"
            :title="`step ${n.step + 1} · ${n.symbol}${n.display}`"
          />
        </div>
      </div>
      <div class="fxg-legend">
        <span><i :style="{ background: LANE_COLORS[0] }" /> Lane 1 · {{ laneLegend(0) }}</span>
        <span><i :style="{ background: LANE_COLORS[1] }" /> Lane 2 · {{ laneLegend(1) }}</span>
      </div>
    </div>

    <!-- Effect editing: controls (faders/selects) on top, label/value footer below -->
    <div class="param-bar">
      <!-- FX type: a scrollable list of effects (or Custom) -->
      <div class="pcol fx-col">
        <div class="pc-control"><ListBox :options="effectListOptions" v-model="effectId" /></div>
        <div class="pc-foot"><span class="pc-label">FX Type</span></div>
      </div>

      <!-- Preset: a fader per parameter, spread across the width -->
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

      <!-- Custom: an FX + curve list per lane -->
      <template v-else>
        <div class="pcol list-col">
          <div class="pc-control"><ListBox :options="fxListOptions" v-model="lane1Fx" /></div>
          <div class="pc-foot"><span class="pc-label">Lane 1 FX</span></div>
        </div>
        <div class="pcol list-col">
          <div class="pc-control"><ListBox :options="curveListOptions" v-model="lane1Curve" /></div>
          <div class="pc-foot"><span class="pc-label">Curve</span></div>
        </div>
        <div class="pcol list-col">
          <div class="pc-control"><ListBox :options="lane2ListOptions" v-model="lane2Fx" /></div>
          <div class="pc-foot"><span class="pc-label">Lane 2 FX</span></div>
        </div>
        <div class="pcol list-col">
          <div class="pc-control">
            <ListBox :options="curveListOptions" v-model="lane2Curve" :disabled="lane2Fx === 'none'" />
          </div>
          <div class="pc-foot"><span class="pc-label">Curve</span></div>
        </div>
      </template>

      <!-- Range (info) -->
      <div class="pcol info-col">
        <div class="pc-control" />
        <div class="pc-foot">
          <span class="pc-label">Range</span><span class="pc-value">{{ rangeLabel }}</span>
        </div>
      </div>

      <!-- Cancel / Fill: footer cells (Cancel exits to the pattern, Fill commits) -->
      <div class="pcol foot-btn" @click="handleCancel">
        <div class="pc-control" />
        <div class="pc-foot"><span class="pc-label cancel">Cancel</span></div>
      </div>
      <div class="pcol foot-btn fill" @click="handleFill">
        <div class="pc-control" />
        <div class="pc-foot"><span class="pc-label fill">Fill</span></div>
      </div>
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
      .hit {
        fill: transparent;
        cursor: pointer;
        &:hover {
          fill: rgba(255, 255, 255, 0.05);
        }
      }
    }

    // Graph nodes: crisp white squares (HTML overlay, undistorted by the SVG stretch).
    .nodes-layer {
      position: absolute;
      inset: 2px; // matches the svg border so squares align with the curve
      pointer-events: none;
      overflow: hidden;
    }
    .node-sq {
      position: absolute;
      width: 7px;
      height: 7px;
      background: #fff;
      transform: translate(-50%, -50%);
      &.dim {
        background: rgba(255, 255, 255, 0.55);
      }
      &.sel {
        width: 11px;
        height: 11px;
        outline: 1.5px solid var(--pattern-step-active-color);
        outline-offset: 1px;
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
        top: 8px;
        bottom: 8px;
        width: 1px;
        background: #2a2b2d;
      }

      // Control area (list / fader) sits above the footer — fixed height so
      // long lists scroll instead of stretching the bar.
      .pc-control {
        flex: none;
        height: 132px;
        display: flex;
        align-items: stretch;
        justify-content: center;
        padding: 10px 10px 8px;
      }
      // The footer strip: parameter name + value, along the bottom.
      .pc-foot {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 2px;
        min-height: 40px;
        padding: 5px 8px 7px;
        border-top: 1px solid #1a1a1a;
      }
      .pc-label {
        font-size: 11px;
        color: var(--pattern-step-label-color);
      }
      .pc-value {
        font-size: 14px;
        color: #fff;
        white-space: nowrap;
      }

      // Column widths: list on the left, faders spread, info/actions sized.
      &.fx-col {
        flex: 0 0 160px;
      }
      &.list-col {
        flex: 1;
      }
      &.fader-col {
        flex: 1;
        cursor: ns-resize;
        .pc-control {
          padding: 12px 16px 8px;
        }
        &:hover .pc-fader,
        &.active .pc-fader {
          border-color: #3a3b3d;
        }
      }
      &.info-col {
        flex: 0 0 auto;
        min-width: 120px;
      }

      // Vertical fader: a dark well with a white fill, spread to the column width.
      .pc-fader {
        position: relative;
        width: 100%;
        max-width: 120px;
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
        z-index: 1;
      }

      // Cancel / Fill: footer-row cells (empty control above) that act as buttons.
      &.foot-btn {
        flex: 0 0 84px;
        cursor: pointer;
        .pc-foot .pc-label {
          color: #fff;
        }
        &:hover .pc-foot {
          background: rgba(255, 255, 255, 0.05);
        }
      }
    }
  }
</style>
