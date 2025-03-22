<svelte:options tag="python-editor" />

<script lang="ts">
  export let type: "normal" | "vertical" = "normal";
  export let theme: "light" | "dark" = "light";
  export let id = "";
  export let save = false;
  export let downloadable = false;
  export let requestimport = "false";

  import BaseEditor from "./BaseEditor.svelte";
  import PythonWorker from "../modules/workers/pythonWorker?url";
  import { onMount } from "svelte";
  import { python } from "@codemirror/lang-python";

  let webworker: SharedWorker;

  function createWorker(): void {
    webworker = new SharedWorker(PythonWorker, {
      name: "PythonWorker",
    });
    webworker.port.start();

    webworker.port.postMessage({
      type: "init",
    });
  }

  if (requestimport == "true") {
    function handleImportLanguage(event) {
    if (event.detail.language == "python") {
        if (
        window.confirm("You will need to import up to 21.3 MB. Is that ok?")
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
          const element = document.querySelector('python-editor');
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
    syntax={python()}
    {type}
    theme={localStorage.getItem("icp-default-theme") || theme}
    code={editorContent}
    {webworker}
    {id}
    {downloadable}
    save={save && id != ""}
    language="python"
  />
{/if}