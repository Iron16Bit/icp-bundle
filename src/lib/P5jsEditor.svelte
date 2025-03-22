<svelte:options tag="p5-editor" />

<script lang="ts">
    export let theme: "light" | "dark" = "light";
    export let id = "";
    export let save = false;
    export let downloadable = false;

    import BaseEditor from "./BaseEditor.svelte";
    import { onMount } from "svelte";
    import { javascript } from "@codemirror/lang-javascript";
    import p5 from "p5";

    let editorContent = "";
    let contentLoaded = false;

    onMount(() => {
        // When mounting the editor, get code in the <slot>
        setTimeout(() => {
            const element = document.querySelector('p5-editor');
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
        syntax={javascript()}
        type="vertical"
        theme={localStorage.getItem("icp-default-theme") || theme}
        code={editorContent}
        {id}
        {downloadable}
        save={save && id != ""}
        webworker={null}
        language="p5"
        modules={{
            "p5": p5
        }}
    />
{/if}