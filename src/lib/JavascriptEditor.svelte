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

    onMount(() => {
        webworker = new JavascriptWorker();
    });

    let editorContent = "";
    let contentLoaded = false;

    onMount(() => {
        console.log("onMount!!!!")
        // When mounting the editor, get code in the <slot>
        setTimeout(() => {
            const element = document.querySelector('javascript-editor');
            if (element) {
                editorContent = element.textContent.trim();
                console.log("Editor content: ", editorContent)
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
        syntax={javascript()}
        {type}
        theme={localStorage.getItem("icp-default-theme") || theme}
        code={editorContent}
        {webworker}
        {id}
        {downloadable}
        save={save && id != ""}
        language="javascript"
        on:recreateworker={(event) => {
            webworker = new JavascriptWorker();
        }}
    />
{/if}