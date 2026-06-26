<script setup lang="ts">
  //---------------------------------------------------
  //
  //  Imports
  //
  //---------------------------------------------------
  import { computed, nextTick, onBeforeUnmount, ref, useTemplateRef } from 'vue';
  import Tracker, { PatternData, PatternFX } from '@polyend/tracker-lib';
  import {
    AttributeListItem,
    CursorIndex,
    EffectList,
    InstrumentList,
    NoteToMidiMap,
    StepProperty,
  } from '@/types/pattern-editor.ts';
  import {
    ALL_KEYCODES,
    ALL_ARROW_KEYCODES,
    ALL_STEP_ATTRIBUTE_KEYCODES,
    ALL_OCTAVE_KEYCODES,
    ALL_NOTE_KEYCODES,
    ALL_NUMBER_KEYCODES,
    OperatorKeyCodes,
    ArrowKeyCodes,
    KeyboardEvents,
    NoteKeyCodes,
  } from '@/objects/keyboard.ts';
  import Step from '@/components/pattern-editor/Step.vue';
  import Button from '@/components/ui/Button.vue';
  import ModalPatternCreate from '@/components/modals/ModalPatternCreate.vue';
  import VueComp from '@/utils/vuecomp.ts';
  import FxGraph from '@/components/FxGraph.vue';
  import { PRESETS, applyRecipe, getPreset } from '@/forge/index.ts';
  import { PatternPreview } from '@/audio/preview.ts';

  //---------------------------------------------------
  //
  //  Properties
  //
  //---------------------------------------------------
  // const props = defineProps({});

  //---------------------------------------------------
  //
  //  Emits
  //
  //---------------------------------------------------
  // const emit = defineEmits([]);

  //---------------------------------------------------
  //
  //  Data Model
  //
  //---------------------------------------------------
  const patternContainer = ref<HTMLDivElement | null>(null);
  const activeIndex = ref<CursorIndex>({ x: 0, y: 0 });
  const activeStep = ref<InstanceType<typeof Step> | null>(null);
  const steps = useTemplateRef('steps');

  //----------------------------------
  // Overlay variables
  //----------------------------------
  const overlayContainer = ref<HTMLDivElement | null>(null);
  const overlayVisible = ref<boolean>(false);
  const overlayAttributesList = ref<AttributeListItem[]>([]);
  const overlayTitle = ref<string | null>(null);
  const overlayAttrIndex = ref<number>(0);

  //----------------------------------
  // State variables
  //----------------------------------
  const patternData = ref<PatternData | null>(null);
  let recMode: boolean;
  let activeStepProperty: StepProperty = StepProperty.NOTE;

  //----------------------------------
  // Forge (generative FX) variables
  //----------------------------------
  const forgePresets = PRESETS;
  const forgePresetId = ref<string>(PRESETS[0].id);
  const forgeSeed = ref<number>(1);
  const forgePreset = computed(() => getPreset(forgePresetId.value));
  const showGraph = ref<boolean>(false);

  //----------------------------------
  // Audio preview variables
  //----------------------------------
  let preview: PatternPreview | null = null;
  const isPlaying = ref<boolean>(false);
  const previewBpm = ref<number>(130);
  const playStep = ref<number>(-1);
  const sampleName = ref<string>('default blip');

  //----------------------------------
  // Keyboard variables
  //----------------------------------
  let activeKeyDown: string | null = null;
  let incUpdateTimer: number | undefined = undefined;
  let keyInputTimer: number | undefined = undefined;

  //----------------------------------
  // Value variables
  //----------------------------------
  const noteInput: number = 12;
  let valueInput: string = '';
  let currentOctave: number = 4;
  let currentInstrument: number = 0;

  const incrementSlow = 1;
  const incrementFast = 10;

  //----------------------------------
  // Constants
  //----------------------------------
  const STEP_HEIGHT = 18;
  const INITIAL_REPEAT_DELAY = 175;
  const SCROLL_THRESHOLD_FACTOR = 2.75;

  //---------------------------------------------------
  //
  //  Computed Properties
  //
  //---------------------------------------------------
  const tracks = computed(() => patternData.value?.tracks ?? []);

  const numTracks = computed(() => tracks.value.length);

  const numSteps = computed(() => {
    if (tracks.value.length > 0) {
      return tracks.value[0].length + 1;
    }
    return 0;
  });

  const trackData = computed(() =>
    tracks.value.map((track) => ({
      ...track,
      steps: track.steps.slice(0, track.length + 1),
    })),
  );

  //---------------------------------------------------
  //
  //  Watch Properties
  //
  //---------------------------------------------------
  // watch(value, (newval, oldval) => { console.log(newval, oldval); });

  //---------------------------------------------------
  //
  //  Vue Lifecycle
  //
  //---------------------------------------------------
  // onBeforeMount(() => {});
  // onMounted(() => {});
  // onBeforeUpdate(() => {});
  // onUpdated(() => {});
  // onActivated(() => {});
  // onDeactivated(() => {});
  onBeforeUnmount(() => {
    removeInteractions();
    preview?.dispose();
  });
  // onUnmounted(() => {});

  //---------------------------------------------------
  //
  //  Methods
  //
  //---------------------------------------------------
  async function addInteractions() {
    const container = patternContainer.value as HTMLDivElement;
    if (!container) return;

    // @ts-expect-error ts being a bit annoying
    if (navigator.keyboard) {
      // @ts-expect-error same here
      await navigator.keyboard.lock(ALL_KEYCODES);
    } else {
      console.log('unable to lock');
    }

    container.addEventListener(KeyboardEvents.KEY_DOWN, handleKeyboardEvents);
    container.addEventListener(KeyboardEvents.KEY_UP, handleKeyboardEvents);
    container.focus();

    nextTick(() => {
      activateStep(activeIndex.value);
    });
  }

  function removeInteractions() {
    activeKeyDown = null;
    overlayVisible.value = false;

    const container = patternContainer.value as HTMLDivElement;
    if (!container) return;

    container.removeEventListener(KeyboardEvents.KEY_DOWN, handleKeyboardEvents);
    container.removeEventListener(KeyboardEvents.KEY_UP, handleKeyboardEvents);
  }

  //----------------------------------
  // UI Overlay Methods
  //----------------------------------
  function overlayOpen() {
    const stepProperty = activeStepProperty;
    const visible = overlayVisible.value;
    if (recMode && activeKeyDown && !visible) {
      if (stepProperty == StepProperty.INSTRUMENT) {
        overlayTitle.value = 'Instruments';
        overlayAttributesList.value = InstrumentList;
        overlayAttrIndex.value = 0;

        const stepData = getCurrentStepData();
        if (stepData) {
          overlayAttrIndex.value = stepData.instrument;
        }
        overlayVisible.value = true;
      } else if (stepProperty == StepProperty.FX1 || stepProperty == StepProperty.FX2) {
        overlayTitle.value = 'Fx';
        overlayAttributesList.value = EffectList;

        const stepData = getCurrentStepData();
        if (stepData) {
          if (stepProperty === StepProperty.FX1) {
            overlayAttrIndex.value = stepData.fx[0].type.index;
          }
          if (stepProperty === StepProperty.FX2) {
            overlayAttrIndex.value = stepData.fx[1].type.index;
          }
        } else {
          overlayAttrIndex.value = 0;
        }

        overlayVisible.value = true;
      }
    }
  }

  function overlayClose() {
    const values = overlayAttributesList.value;
    const attribute = values.find((a) => a.index === overlayAttrIndex.value);
    if (attribute) {
      const fxCopy = structuredClone(PatternFX[attribute.index]);
      const stepData = getCurrentStepData();
      if (activeStepProperty == StepProperty.INSTRUMENT) {
        stepData.note = stepData.note === -1 ? noteInput : stepData.note;
        stepData.instrument = overlayAttrIndex.value;
        currentInstrument = stepData.instrument;
      } else if (activeStepProperty === StepProperty.FX1) {
        stepData.fx[0] = { type: fxCopy, value: fxCopy.default };
      } else if (activeStepProperty === StepProperty.FX2) {
        stepData.fx[1] = { type: fxCopy, value: fxCopy.default };
      }
    }

    overlayTitle.value = null;
    overlayAttributesList.value = [];
    overlayAttrIndex.value = 0;
    overlayVisible.value = false;
  }

  function overlayNavigate(keycode: string) {
    const values = overlayAttributesList.value;
    const currentIndex = values.findIndex((a) => a.index === overlayAttrIndex.value);
    let newIndex = currentIndex;

    switch (keycode) {
      case ArrowKeyCodes.ArrowUp:
        newIndex -= incrementSlow;
        break;
      case ArrowKeyCodes.ArrowDown:
        newIndex += incrementSlow;
        break;
      case ArrowKeyCodes.ArrowLeft:
        newIndex -= incrementFast;
        break;
      case ArrowKeyCodes.ArrowRight:
        newIndex += incrementFast;
        break;
    }

    const maxIndex = values.length - 1;
    if (newIndex < 0 && currentIndex !== 0) {
      newIndex = 0;
    } else if (newIndex < 0 && currentIndex === 0) {
      newIndex = values.length - 1;
    } else if (newIndex > maxIndex && currentIndex !== maxIndex) {
      newIndex = maxIndex;
    } else if (newIndex > maxIndex && currentIndex === maxIndex) {
      newIndex = 0;
    }
    overlayAttrIndex.value = values[newIndex].index;
    const container = overlayContainer.value as HTMLDivElement;
    if (container) {
      const threshold = Math.floor(maxIndex / SCROLL_THRESHOLD_FACTOR);
      const scrollTop = (newIndex - threshold) * STEP_HEIGHT;
      container.scrollTop = newIndex >= threshold ? scrollTop : 0;
    }
  }

  //----------------------------------
  // Navigation Methods
  //----------------------------------
  function updateCursor(newIndex: CursorIndex) {
    const index = { ...newIndex };
    const container = patternContainer.value as HTMLDivElement;
    const totalTracks = numTracks.value - 1;
    const totalSteps = numSteps.value - 1;

    if (index.x < 0) {
      index.x = 0;
    }
    if (index.x > totalTracks) {
      index.x = totalTracks;
    }
    if (index.y > totalSteps) {
      index.y = 0;
    }
    if (index.y < 0) {
      index.y = totalSteps;
    }

    if (container) {
      container.scrollTop = index.y * STEP_HEIGHT;
      if (index.x > numTracks.value / 2 - 1) {
        container.scrollLeft = container.scrollWidth;
      } else {
        container.scrollLeft = 0;
      }
    }

    activateStep(index);
  }

  //----------------------------------
  // Step State Methods
  //----------------------------------
  function activateStep(index: CursorIndex) {
    const oldStep = activeStep.value;
    if (oldStep) {
      oldStep.setActive(false);
    }

    const newStep = getStep(index);
    if (newStep) {
      activeStep.value = newStep;
      newStep.setActive(true, activeStepProperty, recMode);
      newStep.$el.focus();
    }
    activeIndex.value = index;
  }

  function updateStepState(incremental?: number, value?: number) {
    const step = activeStep.value;
    step?.updateState(activeStepProperty, recMode);

    if (incremental !== undefined || value !== undefined) {
      const inc = incremental || 0;
      const stepData = getCurrentStepData();
      if (stepData) {
        if (activeStepProperty === StepProperty.NOTE) {
          const note = stepData.note;
          const newval = value !== undefined ? value : note + inc;
          stepData.note = clampValue(newval, -4, 127);
          stepData.instrument = currentInstrument;
        } else if (activeStepProperty === StepProperty.INSTRUMENT) {
          const inst = stepData.instrument;
          const newval = value !== undefined ? value : inst + inc;
          stepData.instrument = clampValue(newval, 0, 66);
          currentInstrument = stepData.instrument;
        } else if (activeStepProperty === StepProperty.FX1) {
          const fx = stepData.fx[0];
          const newval = value !== undefined ? value : fx.value + inc;
          fx.value = clampValue(newval, fx.type.min, fx.type.max);
        } else if (activeStepProperty === StepProperty.FX2) {
          const fx = stepData.fx[1];
          const newval = value !== undefined ? value : fx.value + inc;
          fx.value = clampValue(newval, fx.type.min, fx.type.max);
        }
      }
    }
  }

  function deleteStepState() {
    const stepData = getCurrentStepData();
    if (stepData) {
      stepData.note = -1;
      stepData.instrument = 0;
      stepData.fx[0].value = 0;
      stepData.fx[0].type = structuredClone(PatternFX[0]);
      stepData.fx[1].value = 0;
      stepData.fx[1].type = structuredClone(PatternFX[0]);
    }
  }

  function getStep(index?: CursorIndex) {
    const idx = index || (activeIndex.value as CursorIndex);
    if (idx) {
      const x = idx.x > 0 ? idx.x * numSteps.value : 0;
      return (steps.value || [])[x + idx.y];
    }
    return null;
  }

  function getCurrentStepData() {
    const index = activeIndex.value;
    return trackData.value?.[index.x]?.steps?.[index.y] || null;
  }

  //----------------------------------
  // Helper Methods
  //----------------------------------
  const clampValue = (value: number, min: number, max: number): number => {
    return Math.min(Math.max(value, min), max);
  };

  //----------------------------------
  // Event Handlers
  //----------------------------------
  function handleKeyboardEvents(evt: KeyboardEvent) {
    if (evt.type === KeyboardEvents.KEY_DOWN) return handleKeyDown(evt);
    if (evt.type === KeyboardEvents.KEY_UP) return handleKeyUp(evt);
  }

  function handleKeyDown(evt: KeyboardEvent) {
    if (!ALL_KEYCODES.includes(evt.code)) return;
    const isArrowPress = ALL_ARROW_KEYCODES.includes(evt.code);
    const activeKeyDownIsStepAttr = activeKeyDown !== null && ALL_STEP_ATTRIBUTE_KEYCODES.includes(activeKeyDown);

    evt.preventDefault();
    evt.stopPropagation();

    if (
      isArrowPress &&
      (!recMode || (recMode && !activeKeyDownIsStepAttr)) &&
      (!recMode || (recMode && !evt.ctrlKey))
    ) {
      const index = activeIndex.value;
      switch (evt.code) {
        case ArrowKeyCodes.ArrowUp:
          updateCursor({ ...index, y: index.y - 1 });
          break;
        case ArrowKeyCodes.ArrowDown:
          updateCursor({ ...index, y: index.y + 1 });
          break;
        case ArrowKeyCodes.ArrowLeft:
          updateCursor({ ...index, x: index.x - 1 });
          break;
        case ArrowKeyCodes.ArrowRight:
          updateCursor({ ...index, x: index.x + 1 });
          break;
      }
    } else if (recMode) {
      if (evt.ctrlKey) {
        handleValueChangeByArrows(evt.code);
      } else if (ALL_NUMBER_KEYCODES.includes(evt.code)) {
        handleValueChangeByKeys(evt.key);
      } else if (ALL_NOTE_KEYCODES.includes(evt.code)) {
        handleNoteChange(evt.code);
      }
    }

    if (ALL_STEP_ATTRIBUTE_KEYCODES.includes(evt.code)) {
      const index = parseInt(evt.code.replace('F', ''), 10) - 1;
      const stepProperties = Object.values(StepProperty);
      activeStepProperty = stepProperties[index] || null;
      updateStepState();
    }

    if (!isArrowPress && (activeKeyDown === null || activeKeyDown !== evt.code)) {
      activeKeyDown = evt.code;
    }
    if (activeKeyDownIsStepAttr) {
      if (!overlayVisible.value) {
        overlayOpen();
      } else {
        overlayNavigate(evt.code);
      }
    }
  }

  function handleKeyUp(evt: KeyboardEvent) {
    if (evt.code === OperatorKeyCodes.Escape) {
      recMode = !recMode;
      updateStepState();
    }

    if (recMode && evt.code === OperatorKeyCodes.Delete) {
      deleteStepState();
    }

    if (incUpdateTimer !== undefined) {
      clearInterval(incUpdateTimer);
      incUpdateTimer = undefined;
    }

    if (activeKeyDown === evt.code) {
      activeKeyDown = null;
      overlayClose();
    }
  }

  function handleValueChangeByArrows(code: string) {
    if (incUpdateTimer === undefined) {
      let incremental = 0;
      switch (code) {
        case ArrowKeyCodes.ArrowUp:
          incremental = incrementSlow;
          break;
        case ArrowKeyCodes.ArrowDown:
          incremental = -incrementSlow;
          break;
        case ArrowKeyCodes.ArrowLeft:
          incremental = activeStepProperty === StepProperty.NOTE ? -12 : -incrementFast;
          break;
        case ArrowKeyCodes.ArrowRight:
          incremental = activeStepProperty === StepProperty.NOTE ? 12 : incrementFast;
          break;
      }

      if (incremental !== 0) {
        updateStepState(incremental);
        let speed = INITIAL_REPEAT_DELAY;
        const loop = () => {
          updateStepState(incremental);
          speed = Math.max(25, speed - 25);
          incUpdateTimer = window.setTimeout(loop, speed);
        };
        incUpdateTimer = window.setTimeout(loop, speed);
      }
    }
  }

  function handleValueChangeByKeys(value: string) {
    window.clearTimeout(keyInputTimer);
    valueInput += value;
    updateStepState(undefined, parseInt(valueInput, 10));
    keyInputTimer = window.setTimeout(() => {
      valueInput = '';
    }, 300);
  }

  function handleNoteChange(code: string) {
    if (ALL_OCTAVE_KEYCODES.includes(code)) {
      switch (code) {
        case NoteKeyCodes.OctaveUp:
          currentOctave += 1;
          break;
        case NoteKeyCodes.OctaveDown:
          currentOctave -= 1;
          break;
      }
      currentOctave = clampValue(currentOctave, 0, 10);
      return;
    }

    const noteName = Object.keys(NoteKeyCodes).find((key) => NoteKeyCodes[key] === code);
    if (noteName) {
      const baseMidiNote = NoteToMidiMap[noteName];
      const value = baseMidiNote + currentOctave * 12 - 12;
      updateStepState(undefined, value);
    }
  }

  function handlePatternCreate() {
    VueComp.create(ModalPatternCreate, document.body, {
      onCreate: (data: { tracks: number; steps: number }) => {
        const { tracks, steps } = data;
        removeInteractions();
        patternData.value = Tracker.createPattern(tracks, steps);
        nextTick(async () => {
          await addInteractions();
        });
      },
    });
  }

  async function handlePatternInput(file: File) {
    if (file) {
      removeInteractions();
      patternData.value = await Tracker.readPattern(file);
      nextTick(async () => {
        await addInteractions();
      });
    }
  }

  async function handlePatternOutput() {
    const pattern = patternData.value;
    if (pattern) {
      await Tracker.writePattern(pattern);
    }
  }

  //----------------------------------
  // Forge Methods
  //----------------------------------
  // Populate the pattern's FX columns to create the selected effect.
  // Deterministic for a given (preset, seed); "Re-roll" just bumps the seed.
  function handleForge(reroll = false) {
    removeInteractions();
    if (!patternData.value) {
      patternData.value = Tracker.createPattern(8, 16);
    }
    if (reroll) {
      forgeSeed.value = (forgeSeed.value % 65535) + 1;
    }
    applyRecipe(patternData.value, forgePreset.value.build(), { seed: forgeSeed.value });
    refreshAfterMutation();
  }

  // Reassign the top-level ref so the trackData computed re-renders, then
  // (re)attach the grid's keyboard interactions.
  function refreshAfterMutation() {
    if (patternData.value) {
      patternData.value = { ...patternData.value };
    }
    nextTick(async () => {
      if (!showGraph.value) await addInteractions();
    });
  }

  // The graph view mutated the pattern in place — refresh both views.
  function onGraphChanged() {
    refreshAfterMutation();
  }

  function toggleGraph() {
    showGraph.value = !showGraph.value;
    if (showGraph.value) {
      removeInteractions();
    } else {
      nextTick(async () => {
        await addInteractions();
      });
    }
  }

  //----------------------------------
  // Audio preview Methods
  //----------------------------------
  async function togglePlay() {
    if (!preview) preview = new PatternPreview();
    if (isPlaying.value) {
      preview.stop();
      isPlaying.value = false;
      playStep.value = -1;
      return;
    }
    if (!patternData.value) return;
    isPlaying.value = true;
    await preview.play(patternData.value, {
      bpm: previewBpm.value,
      onStep: (s) => (playStep.value = s),
      onStop: () => {
        isPlaying.value = false;
        playStep.value = -1;
      },
    });
  }

  async function handleSampleLoad(file: File) {
    if (!file) return;
    if (!preview) preview = new PatternPreview();
    const buf = await file.arrayBuffer();
    await preview.setSample(buf);
    sampleName.value = file.name;
  }

  //---------------------------------------------------
  //
  //  Expose
  //
  //---------------------------------------------------
  // defineExpose({});
</script>

<template>
  <div v-show="!showGraph" class="pattern-editor">
    <div ref="patternContainer" class="pattern" tabindex="0">
      <div class="track-names">
        <div><span>--</span></div>
        <div v-for="num in numTracks" :key="`title-${num}`">
          <span>Track {{ num }}</span>
        </div>
      </div>
      <div class="data">
        <div class="lane left">
          <span v-for="num in numSteps" :key="`step-${num}`" :class="{ beat: (num - 1) % 4 === 0 }">
            {{ num }}
          </span>
        </div>
        <div class="tracks">
          <div v-for="(track, x) in trackData" class="track" :key="`track-${x}`">
            <Step
              ref="steps"
              v-for="(step, y) in track.steps"
              :key="`track-${x}-step-${y}`"
              :step-data="step"
              :on-beat="y % 4 === 0"
            />
          </div>
        </div>
        <div class="lane right" />
      </div>
    </div>
    <div v-if="overlayVisible" ref="overlayContainer" class="overlay">
      <h3>{{ overlayTitle }}</h3>
      <ul>
        <li
          v-for="(attr, aidx) in overlayAttributesList"
          :key="`attr-${aidx}`"
          :data-index="attr.index"
          :class="{ active: overlayAttrIndex === attr.index }"
        >
          <template v-if="attr.symbol">
            <span class="symbol">{{ attr.symbol }}</span>
            <span class="symbol delimiter"> - </span>
          </template>
          <span class="label">{{ attr.label }}</span>
        </li>
      </ul>
    </div>
  </div>

  <div v-if="showGraph && patternData" class="graph-view">
    <FxGraph :pattern="patternData" :play-step="playStep" @changed="onGraphChanged" />
  </div>

  <div class="actions">
    <!-- Pattern mode: pattern + generate controls -->
    <template v-if="!showGraph">
      <div class="group">
        <Button @click="handlePatternCreate"> <sup>New</sup> Pattern </Button>
        <Button type="file" mime-types=".mtp" @file="handlePatternInput"> <sup>Load</sup> Pattern </Button>
        <Button v-if="patternData" @click="handlePatternOutput"> <sup>Save</sup> Pattern </Button>
      </div>
      <div class="group separator" />
      <div class="group forge">
        <select v-model="forgePresetId" :title="forgePreset.description">
          <option v-for="p in forgePresets" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <Button @click="handleForge(false)"> <sup>Forge</sup> FX </Button>
        <Button @click="handleForge(true)"> <sup>Re-roll</sup> {{ forgeSeed }} </Button>
      </div>
      <template v-if="patternData">
        <div class="group separator" />
        <div class="group">
          <Button @click="toggleGraph"> <sup>Go to</sup> Effects </Button>
        </div>
      </template>
    </template>

    <!-- Effects mode: only the FX-relevant controls + back to pattern -->
    <template v-else>
      <div class="group">
        <Button @click="toggleGraph"> <sup>Back to</sup> Pattern </Button>
      </div>
      <div class="group separator" />
      <div class="group transport">
        <Button :blue="isPlaying" @click="togglePlay">
          <sup>Preview</sup> {{ isPlaying ? '■ Stop' : '▶ Play' }}
        </Button>
        <label class="bpm"
          ><sup>BPM</sup
          ><input type="number" min="20" max="400" v-model.number="previewBpm" @change="preview?.setBpm(previewBpm)"
        /></label>
        <Button type="file" mime-types="audio/*,.wav" @file="handleSampleLoad">
          <sup>Sample</sup> {{ sampleName }}
        </Button>
      </div>
      <div class="group separator" />
      <div class="group">
        <Button @click="handlePatternOutput"> <sup>Save</sup> Pattern </Button>
      </div>
    </template>
  </div>
</template>

<style lang="scss">
  @use '@/assets/scss/fonts';

  div.pattern-editor {
    position: relative;
    background: var(--pattern-bg-color);
    // background-image: url('@/assets/svgs/logo-polyend.svg');
    background-position: center center;
    background-repeat: repeat;
    background-size: auto 10%;
    border-radius: 6px;
    box-shadow:
      0 0.5px 0 rgba(255, 255, 255, 0.15),
      0 -0.5px 0 rgba(255, 255, 0.255, 0.05);
    overflow: hidden;

    & > div.pattern {
      position: relative;
      font-size: 12px;
      width: 100vw;
      max-width: calc((124px * 8) + 36px + (3px * 7));
      height: calc((var(--pattern-step-height) * 32) + 7px);
      max-height: calc((var(--pattern-step-height) * 32) + 7px);
      overflow: hidden;
      border: 2px solid var(--pattern-bg-color);
      padding: 2px 0 5px 0;
      outline: 0;

      & > div.track-names {
        position: sticky;
        top: 0;
        display: flex;
        gap: 3px;
        z-index: 4;

        & > div {
          min-width: 124px;
          padding: 0;
          height: var(--pattern-step-height);

          & > span {
            background-color: var(--pattern-track-label-bg-color);
            color: var(--pattern-track-label-color);
            font-weight: bold;
            padding: 2px 4px;
            user-select: none;
          }

          &:first-of-type {
            max-width: 27px;
            min-width: 27px;
            width: 27px;
            height: var(--pattern-step-height);
            padding: 0;
            opacity: 0;
          }
        }
      }

      & > div.data {
        display: flex;
        width: auto;
        padding: calc(var(--pattern-step-height) * 15) 0;

        & > div.lane {
          position: sticky;
          left: 0;
          background: var(--pattern-step-bg-color);
          z-index: 3;

          &.right {
            left: auto;
            opacity: 0;
            min-width: 1px;
            overflow: hidden;
            padding: 0;
          }

          & > span {
            display: flex;
            align-items: center;
            min-width: 30px;
            height: var(--pattern-step-height);
            padding: 0 1ch;
            color: var(--pattern-step-label-color);
            border-right: 3px solid var(--pattern-bg-color);
            user-select: none;

            &.beat {
              background: var(--pattern-step-beat-bg-color);
            }
          }
        }

        & > div.tracks {
          display: flex;
          gap: 3px;

          & > div > div {
            height: var(--pattern-step-height);
          }

          & > div.track {
            min-width: 17ch;
          }
        }
      }
    }

    & > .overlay {
      position: absolute;
      top: 2px;
      right: 2px;
      border-radius: 0 6px 6px 0;
      height: calc(100% - 4px);
      min-width: 180px;
      max-height: 100%;
      overflow: hidden;
      background: var(--pattern-overlay-bg-color);
      z-index: 5;
      user-select: none;

      & > h3 {
        position: sticky;
        top: 0;
        font-size: 13px;
        padding: 0 8px;
        height: var(--pattern-step-height);
        background: var(--pattern-overlay-accent-color);
        list-style-type: none;
        color: var(--pattern-overlay-title-color);
      }

      & > ul {
        display: flex;
        flex-direction: column;
        padding: 8px 0;
        margin: 0;
        list-style-type: none;
        color: var(--pattern-overlay-accent-color);
        min-height: 100%;

        & > li {
          display: flex;
          justify-content: flex-start;
          align-items: center;
          padding: 0 16px;
          margin: 0;
          height: 18px;
          border: 2px solid transparent;
          font-size: 12px;
          color: var(--pattern-overlay-text-color);

          &.active {
            border: 2px solid var(--pattern-overlay-accent-color);
            color: var(--pattern-overlay-accent-color);
          }

          & > span {
            display: inline-block;
            &.symbol {
              min-width: 12px;
            }
          }
        }
      }
    }
  }

  // The effect (graph) view spans the full width of the app.
  div.graph-view {
    width: 100%;
  }

  // The action bar wraps to multiple rows gracefully as groups are added.
  div.actions {
    flex-wrap: wrap;
    row-gap: 10px;
  }
  // BPM reads like the other buttons: label on top, number below.
  div.actions > div.group.transport > label.bpm {
    display: inline-flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: flex-start;
    min-width: 64px;
    min-height: 48px;
    padding: 4px 8px 5px;
    background: #1e1f21;
    border: 2px solid #000;
    border-bottom-width: 3px;
    border-radius: 6px;
    box-shadow: 0 0.5px 0 rgba(255, 255, 255, 0.12);
    cursor: text;
    & > sup {
      font-size: 9px;
      vertical-align: baseline;
      color: rgba(255, 255, 255, 0.5);
    }
    & > input {
      width: 100%;
      height: auto;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      font-size: 14px;
      color: #fff;
      line-height: 1.1;
    }
  }
</style>
