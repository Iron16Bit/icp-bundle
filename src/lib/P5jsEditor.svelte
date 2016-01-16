<svelte:options tag="p5-editor" />

<script lang="ts">
  export let theme: "light" | "dark" = "light";
  export let id = "";
  export let save = false;
  export let downloadable = false;
  export let code = "";

  import BaseEditor from "./BaseEditor.svelte";
  import { onMount } from "svelte";
  import { javascript } from "@codemirror/lang-javascript";
  import p5 from "p5";

  let editorContent = "";
  let contentLoaded = false;
  let slotWrapper: HTMLDivElement;

  onMount(() => {
    setTimeout(() => {
      const slot = slotWrapper.querySelector("slot");
      if (slot) {
        const nodes = slot.assignedNodes({ flatten: true });
        editorContent = nodes
          .map((node) => node.textContent)
          .join("")
          .trim();
      }

      if (editorContent.length > 0 && code.length > 0) {
        throw new Error(
          "Both slot content and the 'code' prop are initialized. Please provide only one."
        );
      }

      contentLoaded = true;
    }, 0);
  });
</script>

<!-- <slot> used to take tag content -->
<div
  bind:this={slotWrapper}
  style="position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: hidden; opacity: 0; pointer-events: none;"
>
  <slot />
</div>

<!-- Once the content has been loaded, create base-editor -->
{#if contentLoaded}
  <base-editor
    syntax={javascript()}
    type="vertical"
    theme={localStorage.getItem("icp-default-theme") || theme}
    code={contentLoaded ? editorContent || code : ""}
    {id}
    {downloadable}
    save={save && id != ""}
    webworker={null}
    language="p5"
    modules={{
      p5: p5,
    }}
  />
{/if}
