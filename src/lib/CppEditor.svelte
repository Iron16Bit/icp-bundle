<svelte:options tag="cpp-editor" />

<script lang="ts">
  export let type: "normal" | "vertical" = "normal";
  export let theme: "light" | "dark" = "light";
  export let id = "";
  export let save = false;
  export let downloadable = false;
  export let requestimport = "false";

  import BaseEditor from "./BaseEditor.svelte";
  import CppWorker from "../modules/workers/cpp/cppWorkerBundle.iife.js?url";
  import { onMount } from "svelte";
  import { cpp } from "@codemirror/lang-cpp";

  let webworker: SharedWorker;

  function createWorker(): void {
    webworker = new SharedWorker(CppWorker, {
      name: "CppWorker",
    });
    webworker.port.start();

    let baseUrl = "https://lucademenego99.github.io/icp-bundle/base/utils/cpp/";
    webworker.port.postMessage({ type: "init", baseUrl });
  }

  if (requestimport == "true") {
    function handleImportLanguage(event) {
    if (event.detail.language == "cpp") {
        if (
        window.confirm("You will need to import up to 58.1 MB. Is that ok?")
        ) {
        createWorker();
        }
    }
    }

    window.addEventListener("importLanguage", handleImportLanguage);
  } else {
      onMount(() => {
      createWorker();
      });
  }

  let editorContent = "";
  let contentLoaded = false;

  onMount(() => {
      // When mounting the editor, get code in the <slot>
      setTimeout(() => {
          const element = document.querySelector('cpp-editor');
          if (element) {
              editorContent = element.textContent.trim();
              // Mark content as loaded and ready to create base-editor
              contentLoaded = true;
          }
      }, 0);
  });
</script>

<!-- <slot> used to take tag content -->
<div style="position: absolute; top: 0; left: 0; width: 0; height: 0; overflow: hidden; opacity: 0; pointer-events: none;">
  <slot />
</div>

<!-- Once the content has been loaded, create base-editor -->
{#if contentLoaded}
  <base-editor
    syntax={cpp()}
    {type}
    theme={localStorage.getItem("icp-default-theme") || theme}
    code={editorContent}
    {webworker}
    {id}
    {downloadable}
    save={save && id != ""}
    language="cpp"
  />
{/if}