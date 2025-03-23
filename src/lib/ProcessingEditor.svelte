<svelte:options tag="processing-editor" />

<script lang="ts">
  export let theme: "light" | "dark" = "light";
  export let id = "";
  export let save = false;
  export let downloadable = false;

  import BaseEditor from "./BaseEditor.svelte";
  import { onMount } from "svelte";
  import { java } from "@codemirror/lang-java";

  import p5 from "p5";
  import { transformProcessing } from "../modules/processing/utils";
  import * as babel from "@babel/standalone";
  import protect from "@freecodecamp/loop-protect";

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

<!-- Once the content has been loaded, create base-editor -->
{#if contentLoaded}
  <base-editor
    type="vertical"
    syntax={java()}
    theme={localStorage.getItem("icp-default-theme") || theme}
    code={editorContent}
    {id}
    {downloadable}
    save={save && id != ""}
    webworker={null}
    language="processing"
    modules={{
      p5: p5,
      transformProcessing: transformProcessing,
      babel: babel,
      protect: protect,
    }}
  />
{/if}
