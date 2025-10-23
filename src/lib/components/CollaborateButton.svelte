<svelte:options tag="collaborate-button" />

<script lang="ts">
  /**
   * IMPORTS
   */
  import { onMount, createEventDispatcher } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import {
    startCollaborativeSessionWithNode,
    type CollabSession,
  } from "../collab/session";
  import { DiscoveryClient } from "../collab/discovery";
  import { getSharedLibp2p } from "../collab/sharedNode";

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

  let showPanel = false;
  let discovery: DiscoveryClient | null = null;
  let discoveredPeers: { id: string; name: string }[] = [];
  let invites: { from: { id: string; name: string }; topic: string }[] = [];
  let collabSession: CollabSession | null = null;
  let userName: string | null = null;

  const dispatch = createEventDispatcher();

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

  function secretTopic() {
    return `icp.session.${crypto.getRandomValues(new Uint32Array(1))[0].toString(16)}`;
  }

  // Adjective + Animal generator
  function generateUserName() {
    const adjectives = [
      "brave",
      "clever",
      "swift",
      "calm",
      "bright",
      "gentle",
      "mighty",
      "silent",
      "sunny",
      "wild",
      "bold",
      "happy",
      "fuzzy",
      "lucky",
      "quick",
      "shiny",
      "witty",
      "zesty",
      "spry",
      "quirky",
    ];
    const animals = [
      "otter",
      "fox",
      "tiger",
      "panda",
      "eagle",
      "whale",
      "lynx",
      "wolf",
      "sparrow",
      "dolphin",
      "bear",
      "falcon",
      "owl",
      "leopard",
      "seal",
      "koala",
      "yak",
      "ibis",
      "bison",
      "orca",
    ];
    const a = adjectives[Math.floor(Math.random() * adjectives.length)];
    const b = animals[Math.floor(Math.random() * animals.length)];
    return `${a}-${b}`;
  }

  function slugify(s: string) {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64);
  }

  // Build slide-specific discovery topic: title + date (dd/mm/yyyy) + slide number
  function getDiscoveryTopic() {
    const title = document?.title || "slides";
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, "0");
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const yyyy = String(now.getFullYear());
    let slideNum = "0";
    const anyWin: any = window as any;
    if (anyWin?.Reveal?.getIndices) {
      const idx = anyWin.Reveal.getIndices();
      const h = idx?.h ?? 0;
      const v = idx?.v ?? 0;
      slideNum = `${h}${v ? "-" + v : ""}`;
    }
    const topic = `icp.disco.${slugify(title)}.${dd}-${mm}-${yyyy}.slide-${slideNum}`;
    return topic;
  }

  async function ensureDiscovery() {
    if (discovery) return;
    if (!userName) {
      userName = generateUserName();
    }
    const discoTopic = getDiscoveryTopic();
    discovery = new DiscoveryClient(discoTopic);
    await discovery.start(
      userName!,
      (peers) => {
        discoveredPeers = peers;
      },
      (from, topic) => {
        invites = [{ from, topic }, ...invites];
      }
    );
  }

  async function connectToPeer(peerId: string) {
    if (!editor) {
      alert("Editor not ready");
      return;
    }
    await ensureDiscovery();
    const topic = secretTopic();
    await discovery!.invite(peerId, topic);
    await startSession(topic);
  }

  async function acceptInvite(inviteIdx: number) {
    const invite = invites[inviteIdx];
    invites.splice(inviteIdx, 1);
    await startSession(invite.topic);
  }

  async function declineInvite(inviteIdx: number) {
    invites.splice(inviteIdx, 1);
  }

  async function startSession(topic: string) {
    if (!editor) return;
    const node = await getSharedLibp2p();
    const color = generateRandomColor();
    collabSession = await startCollaborativeSessionWithNode({
      editor,
      topic,
      userInfo: {
        name: userName ?? `User-${Math.floor(Math.random() * 1000)}`,
        color,
      },
      onPeersChanged: (names) => (peerCount = names.length),
      onStatus: () => {},
      node,
    });
    isCollaborating = true;
    sessionTopic = topic;
    dispatch("collaborationStarted", { topic });
  }

  async function leaveSession() {
    await collabSession?.end();
    collabSession = null;
    isCollaborating = false;
    sessionTopic = null;
    peerCount = 0;
  }

  async function togglePanel() {
    showPanel = !showPanel;
    if (showPanel) {
      await ensureDiscovery();
    }
  }

  async function toggleCollaboration() {
    await togglePanel();
  }

  // Check status periodically to update peer count
  onMount(() => {
    const interval = setInterval(() => {
      if (isCollaborating) {
        // Do nothing
      }
    }, 2000);
    return () => {
      clearInterval(interval);
      discovery?.stop();
      collabSession?.end();
    };
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
  <div
    style="position: relative; left: ${type == 'vertical'
      ? 'calc(100% - min(3vw, 6vh))'
      : '0'}; top: 0;"
  >
    <div style="position: absolute;">
      <svg
        style="height: min(2.75vw, 5.5vh); cursor: pointer;"
        fill={theme == "dark" ? "white" : "black"}
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        height="24"
        width="24"
        on:click|stopPropagation={togglePanel}
      >
        <path
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
        />
      </svg>
      {#if isCollaborating ? peerCount > 0 : discoveredPeers.length > 0}
        <span
          style="position: absolute; top: -5px; right: -5px; background-color: #ff4081; 
                 color: white; border-radius: 50%; width: 20px; height: 20px; 
                 display: flex; justify-content: center; align-items: center; 
                 font-size: 12px; font-weight: bold;"
        >
          {isCollaborating ? peerCount : discoveredPeers.length}
        </span>
      {/if}
    </div>
  </div>
</button>

{#if showPanel}
  <div
    style="position: absolute; 
           top: min(3vw, 6vh); 
           right: ${type == 'vertical'
      ? 'calc(var(--output-height) + min(3vw, 6vh))'
      : 'min(3vw, 6vh)'};
           background-color: ${theme == 'dark'
      ? 'rgba(0,0,0,0.85)'
      : 'rgba(255,255,255,0.95)'}; 
           color: ${theme == 'dark' ? 'white' : 'black'};
           padding: 10px; 
           border-radius: 6px; 
           font-size: 12px;
           z-index: 99;
           min-width: 240px;
           box-shadow: 0 2px 10px rgba(0,0,0,0.2);"
    on:click|stopPropagation
  >
    <div style="font-weight: bold; margin-bottom: 6px;">Discovery</div>
    <div style="margin-bottom: 8px;">
      You are: {userName ?? "Anonymous"}
      {#if !discovery}<button
          on:click={ensureDiscovery}
          style="margin-left:8px;">Join</button
        >{/if}
    </div>

    <div
      style="max-height: 160px; overflow: auto; border-top: 1px solid ${theme ==
      'dark'
        ? '#333'
        : '#ddd'}; padding-top: 6px;"
    >
      {#if discoveredPeers.length === 0}
        <div style="opacity: 0.7;">No peers online</div>
      {:else}
        {#each discoveredPeers as p}
          <div
            style="display: flex; align-items: center; justify-content: space-between; padding: 4px 0;"
          >
            <span
              style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60%;"
              >{p.name}</span
            >
            <button
              on:click={() => connectToPeer(p.id)}
              style="font-size: 11px;">Connect</button
            >
          </div>
        {/each}
      {/if}
    </div>

    {#if invites.length > 0}
      <div
        style="margin-top: 8px; border-top: 1px solid ${theme == 'dark'
          ? '#333'
          : '#ddd'}; padding-top: 6px;"
      >
        <div style="font-weight: bold; margin-bottom: 4px;">Invitations</div>
        {#each invites as inv, i}
          <div
            style="display:flex; align-items:center; justify-content: space-between; margin-bottom: 4px;"
          >
            <span>From {inv.from.name}</span>
            <div>
              <button
                on:click={() => acceptInvite(i)}
                style="margin-right:4px; font-size: 11px;">Accept</button
              >
              <button on:click={() => declineInvite(i)} style="font-size: 11px;"
                >Decline</button
              >
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if isCollaborating && sessionTopic}
      <div
        style="margin-top: 8px; border-top: 1px solid ${theme == 'dark'
          ? '#333'
          : '#ddd'}; padding-top: 6px;"
      >
        <div>Session: {sessionTopic}</div>
        <div style="margin-top: 6px;">
          <button on:click={leaveSession} style="font-size: 11px;"
            >Leave session</button
          >
        </div>
      </div>
    {/if}
  </div>
{/if}

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
