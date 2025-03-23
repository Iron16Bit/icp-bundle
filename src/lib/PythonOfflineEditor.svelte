<svelte:options tag="python-editor" />

<script lang="ts">
  export let type: "normal" | "vertical" = "normal";
  export let theme: "light" | "dark" = "light";
  export let id = "";
  export let save = false;
  export let requestimport = "false";
  export let downloadable = false;

  import { python } from "@codemirror/lang-python";
  import { onMount } from "svelte";

  let webworker: SharedWorker;

  function createWorker(): void {
    let baseUrl =
      document.location.protocol +
      "//" +
      document.location.host +
      document.location.pathname;
    baseUrl = baseUrl.substring(0, baseUrl.lastIndexOf("/"));
    baseUrl += "/utils/python/pyodide/";

    webworker = new SharedWorker(baseUrl + "pythonWorkerBundle.iife.js", {
      name: "PythonWorker",
    });
    webworker.port.start();

    webworker.port.postMessage({
      type: "init",
      baseUrl: baseUrl,
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
    syntax={python()}
    {type}
    theme={localStorage.getItem("icp-default-theme") || theme}
    code={editorContent}
    {webworker}
    {id}
    {downloadable}
    save={save && id != ""}
    offline={true}
    language="python"
  />
{/if}
