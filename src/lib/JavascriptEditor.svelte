<svelte:options tag="javascript-editor" />

<script lang="ts">
  export let type: "normal" | "vertical" = "normal";
  export let theme: "light" | "dark" = "light";
  export let id = "";
  export let save = false;
  export let downloadable = false;

  import BaseEditor from "./BaseEditor.svelte";
  import { onMount } from "svelte";
  import JavascriptWorker from "../modules/workers/javascriptWorker?worker&inline";
  import { javascript } from "@codemirror/lang-javascript";

  let webworker: Worker;
  let slotWrapper: HTMLDivElement;

  let editorContent = "";
  let contentLoaded = false;

  onMount(() => {
    webworker = new JavascriptWorker();

    setTimeout(() => {
      const slot = slotWrapper.querySelector("slot");
      if (slot) {
        const nodes = slot.assignedNodes({ flatten: true });
        editorContent = nodes
          .map((node) => node.textContent)
          .join("")
          .trim();
        console.log("Editor content: ", editorContent);
        contentLoaded = true;
      }
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

{#if contentLoaded}
  <base-editor
    syntax={javascript()}
    {type}
    theme={localStorage.getItem("icp-default-theme") || theme}
    code={editorContent}
    {webworker}
    {id}
    {downloadable}
    save={save && id != ""}
    language="javascript"
    on:recreateworker={() => {
      webworker = new JavascriptWorker();
    }}
  />
{/if}
