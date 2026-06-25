<script setup lang="ts">
  //---------------------------------------------------
  //
  //  Imports
  //
  //---------------------------------------------------
  import PatternEditor from '@/components/PatternEditor.vue';

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

  //---------------------------------------------------
  //
  //  Computed Properties
  //
  //---------------------------------------------------
  /*
  const totalResponses = computed(() => {
    return null;
  });
  */

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
  // onMounted(async () => {});
  // onBeforeUpdate(() => {});
  // onUpdated(() => {});
  // onActivated(() => {});
  // onDeactivated(() => {});
  // onBeforeUnmount(() => {});
  // onUnmounted(() => {});

  //---------------------------------------------------
  //
  //  Methods
  //
  //---------------------------------------------------

  //---------------------------------------------------
  //
  //  Expose
  //
  //---------------------------------------------------
  // defineExpose({});
</script>

<template>
  <PatternEditor />
</template>

<style lang="scss">
  @use '@/assets/scss/app';
  body {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 15px;
    justify-content: flex-start;
    align-items: center;
    height: 100vh;
    width: 100%;

    & > div.actions {
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 16px;
      margin: 0 auto;

      & > div.group {
        display: inline-flex;
        align-items: center;
        gap: 8px;

        &.separator {
          position: relative;
          top: 1px;
          width: 1px;
          height: 100%;
          background: #fff;
          opacity: 0.2;
        }

        & > button {
          & > input {
            visibility: hidden;
            width: 0;
            height: 0;
          }
        }
      }
    }
  }
</style>
