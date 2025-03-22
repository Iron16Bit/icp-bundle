<svelte:options tag="standardml-editor" />

<script lang="ts">
    export let type: "normal" | "vertical" = "normal";
    export let theme: "light" | "dark" = "light";
    export let id = "";
    export let save = false;
    export let downloadable = false;

    import BaseEditor from "./BaseEditor.svelte";
    import { onMount } from "svelte";
    import MLWorker from "../modules/workers/mlWorker?worker&inline";
    import { StreamLanguage } from "@codemirror/language";
    import { sml } from "@codemirror/legacy-modes/mode/mllike";

    let webworker: Worker;

    onMount(() => {
        webworker = new MLWorker();
    });

    let editorContent = "";
    let contentLoaded = false;

    onMount(() => {
        // When mounting the editor, get code in the <slot>
        setTimeout(() => {
            const element = document.querySelector('standardml-editor');
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
        syntax={StreamLanguage.define(sml)}
        {type}
        theme={localStorage.getItem("icp-default-theme") || theme}
        code={editorContent}
        {webworker}
        {id}
        {downloadable}
        save={save && id != ""}
        language="ml"
        on:recreateworker={(event) => {
            webworker = new MLWorker();
        }}
    />
{/if}