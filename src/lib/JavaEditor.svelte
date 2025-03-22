<svelte:options tag="java-editor" />

<script lang="ts">
    export let type: "normal" | "vertical" = "normal";
    export let theme: "light" | "dark" = "light";
    export let id = "";
    export let save = false;
    export let downloadable = false;
    export let requestimport = "false";

    import BaseEditor from "./BaseEditor.svelte";
    import JavaWorker from "../modules/workers/java/javaWorker?url";
    import RunWorker from "../modules/workers/java/javaRunWorker?url";
    import TeaWorker from "../modules/workers/java/javaTeaWorker?url";
    import { onMount } from "svelte";
    import { java } from "@codemirror/lang-java";

    let webworker: SharedWorker;
    let teaworker: SharedWorker;

    function createWorker(): void {
        webworker = new SharedWorker(JavaWorker, { name: "JavaWorker" });
        webworker.port.start();

        teaworker = new SharedWorker(TeaWorker, {
            name: "JavaTeaWorker",
        });

        const workerrun = new SharedWorker(RunWorker, {
            name: "JavaRunWorker",
        });

        webworker.port.postMessage(
            {
                worker: "runworker",
                port: workerrun.port,
            },
            [workerrun.port]
        );

        webworker.port.postMessage(
            {
                worker: "teaworker",
                port: teaworker.port,
                offline: false,
            },
            [teaworker.port]
        );
    }

    if (requestimport == "true") {
        function handleImportLanguage(event) {
        if (event.detail.language == "java") {
            if (
            window.confirm("You will need to import up to 12.3 MB. Is that ok?")
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
            const element = document.querySelector('java-editor');
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
        syntax={java()}
        {type}
        theme={localStorage.getItem("icp-default-theme") || theme}
        code={editorContent}
        {webworker}
        {id}
        {downloadable}
        save={save && id != ""}
        language="java"
    />
{/if}