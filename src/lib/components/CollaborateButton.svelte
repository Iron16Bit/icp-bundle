<svelte:options tag="collaborate-button" />

<script lang="ts">
  /**
   * IMPORTS
   */
  import { onMount, createEventDispatcher } from "svelte";
  import { collaborationManager } from "../collab/collaborationManager";
  import type { EditorView } from "@codemirror/view";

  /**
   * PROPS
   */
  export let type: "normal" | "vertical" = "normal";
  export let theme: "light" | "dark" = "light";
  export let editor: EditorView | null = null;

  /**
   * ELEMENTS
   */
  let ref: HTMLElement;
  let isCollaborating = false;
  let peerCount = 0;
  let collaborateButtonContainer: HTMLElement;
  let sessionTopic: string | null = null;

  const dispatch = createEventDispatcher();

  // Generate a random room name if needed
  function generateSessionId() {
    return "session-" + Math.random().toString(36).substring(2, 10);
  }

  async function toggleCollaboration() {
    if (!editor) {
      alert("Editor not ready for collaboration");
      return;
    }

    if (isCollaborating) {
      await collaborationManager.stopCollaboration();
      isCollaborating = false;
      sessionTopic = null;
      peerCount = 0;
    } else {
      // Prompt for session name (or generate one)
      let topic = prompt(
        "Enter a session name or leave blank to generate one:",
        ""
      );
      if (topic === null) return; // User cancelled

      if (!topic.trim()) {
        topic = generateSessionId();
      }

      // Get user name
      let userName = prompt(
        "Enter your name:",
        `User-${Math.floor(Math.random() * 1000)}`
      );
      if (userName === null) return; // User cancelled
      if (!userName.trim())
        userName = `User-${Math.floor(Math.random() * 1000)}`;

      const success = await collaborationManager.startCollaboration(
        editor,
        topic.trim(),
        {
          name: userName,
          color: generateRandomColor(),
        }
      );

      if (success) {
        isCollaborating = true;
        sessionTopic = topic;
        dispatch("collaborationStarted", { topic });
      }
    }
  }

  function generateRandomColor() {
    const colors = [
      "#ff6b6b",
      "#4ecdc4",
      "#45b7d1",
      "#f9ca24",
      "#6c5ce7",
      "#fd79a8",
      "#00b894",
      "#fdcb6e",
    ];
    return colors[Math.floor(Math.random() * colors.length)];
  }

  // Check status periodically to update peer count
  onMount(() => {
    const interval = setInterval(() => {
      if (isCollaborating) {
        const status = collaborationManager.getStatus();
        peerCount = status.peers.length;
      }
    }, 2000);

    return () => clearInterval(interval);
  });
</script>

<!-- Collaborate button -->
<button
  bind:this={collaborateButtonContainer}
  on:click={toggleCollaboration}
  style={`position: absolute; right: ${
    type == "vertical"
      ? "calc(var(--output-height) + min(3vw, 6vh))"
      : "min(3vw, 6vh)"
  }; top: min(0.5vw, 1vh); width: min(2.75vw, 5.5vh); height: min(2.75vw, 5.5vh); border: 0px; border-radius: 0.4em; display: flex; justify-content: center; align-items: center; z-index: 99; background-color: ${
    isCollaborating ? "#4CAF50" : "transparent"
  }; cursor: pointer;`}
>
  <div style="position: relative;">
    <svg
      style="height: 100%;"
      fill={theme == "dark" ? "white" : "black"}
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      height="24"
      width="24"
    >
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
      />
    </svg>
    {#if isCollaborating && peerCount > 0}
      <span
        style="position: absolute; top: -5px; right: -5px; background-color: #ff4081; 
               color: white; border-radius: 50%; width: 20px; height: 20px; 
               display: flex; justify-content: center; align-items: center; 
               font-size: 12px; font-weight: bold;"
      >
        {peerCount}
      </span>
    {/if}
  </div>
</button>

{#if isCollaborating && sessionTopic}
  <div
    style="position: absolute; 
           top: min(3vw, 6vh); 
           right: ${type == 'vertical'
      ? 'calc(var(--output-height) + min(3vw, 6vh))'
      : 'min(3vw, 6vh)'};
           background-color: rgba(0,0,0,0.7); 
           color: white; 
           padding: 5px 10px; 
           border-radius: 4px; 
           font-size: 12px;
           z-index: 99;"
  >
    Session: {sessionTopic}
  </div>
{/if}
