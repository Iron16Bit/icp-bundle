<svelte:options tag="collaborate-button" />

<script lang="ts">
  /**
   * IMPORTS
   */
  import { onMount } from "svelte";
  import type { EditorView } from "@codemirror/view";
  import {
    startCollaborativeSessionWithNode,
    type CollabSession,
  } from "../collab/session";
  import { DiscoveryClient } from "../collab/discovery";
  import { getSharedLibp2p } from "../collab/sharedNode";
  import { DEFAULT_RELAY } from "../collab/constants";
  import { activeCollaboration } from "../../stores";
  import { get } from "svelte/store";

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
  let pendingInvites = new Set<string>();

  let showAlert = false;

  /**
   * FUNCTIONS
   */
  // Initialize userName on component mount
  onMount(() => {
    // Generate username only once when component loads
    if (!userName) {
      userName = generateUserName();
    }

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

  function formatUserName(name: string) {
    return name
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
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

  async function startDiscovery() {
    if (discovery) return;

    // Create the discovery client
    discovery = await DiscoveryClient.create(getDiscoveryTopic());

    // Set up callbacks before calling start
    discovery.onPeerDiscovered = (peer: { id: string; name: string }) => {
      if (!discoveredPeers.find((p) => p.id === peer.id)) {
        discoveredPeers = [...discoveredPeers, peer];
      }
    };

    discovery.onInviteReceived = (invite: {
      from: { id: string; name: string };
      topic: string;
    }) => {
      // Create unique key for this invite
      const inviteKey = `${invite.from.id}-${invite.topic}`;

      // Only add if we haven't seen this invite before
      if (!pendingInvites.has(inviteKey)) {
        pendingInvites.add(inviteKey);
        invites = [...invites, invite];
      }
    };

    await discovery.start(
      userName ?? "Anonymous",
      () => {}, // Empty callback since onPeerDiscovered handles it
      () => {} // Empty callback since onInviteReceived handles it
    );
  }

  async function connectToPeer(peerId: string) {
    if (!editor) {
      alert("Editor not ready");
      return;
    }
    await startDiscovery();
    const topic = secretTopic();
    await discovery!.invite(peerId, topic);
    await startSession(topic, true); // initiator
    showPanel = false;
  }

  async function acceptInvite(inviteIdx: number) {
    const invite = invites[inviteIdx];

    // Remove from pending set
    const inviteKey = `${invite.from.id}-${invite.topic}`;
    pendingInvites.delete(inviteKey);

    invites.splice(inviteIdx, 1);
    await startSession(invite.topic, false);
    showPanel = false;
  }

  async function declineInvite(inviteIdx: number) {
    const invite = invites[inviteIdx];

    // Remove from pending set
    const inviteKey = `${invite.from.id}-${invite.topic}`;
    pendingInvites.delete(inviteKey);

    invites.splice(inviteIdx, 1);
  }

  async function startSession(topic: string, isInitiator: boolean) {
    try {
      // Get the shared node
      const sharedNode = await getSharedLibp2p();

      // Start the collaboration session with the shared node
      collabSession = await startCollaborativeSessionWithNode({
        editor: editor!,
        topic,
        relayAddr: DEFAULT_RELAY,
        userInfo: {
          name: userName || "Anonymous",
          color: generateRandomColor(),
        },
        onPeersChanged: (peerNames) => (peerCount = peerNames.length),
        onStatus: (status) => console.log(status),
        node: sharedNode,
        isInitiator,
      });

      sessionTopic = topic;
      isCollaborating = true;

      // Update the store
      activeCollaboration.set({
        topic,
        isActive: true,
        peerCount: 0,
      });

      console.log(`Started collaboration session on topic: ${topic}`);
    } catch (error) {
      console.error("Failed to start session:", error);
      throw error;
    }
  }

  async function leaveSession() {
    console.log("[Collab] Leaving session...");

    // Stop the collaboration session
    await collabSession?.end();
    collabSession = null;

    // Reset all state
    isCollaborating = false;
    sessionTopic = null;
    peerCount = 0;
    discoveredPeers = [];
    invites = [];
    pendingInvites.clear();

    // Clear the store
    activeCollaboration.set(null);

    // Stop and clear discovery
    if (discovery) {
      await discovery.stop();
      discovery = null;
    }

    // Small delay to ensure cleanup completes
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Re-join discovery to become visible again
    try {
      await startDiscovery();
      console.log("[Collab] Rejoined discovery, ready to collaborate again");
    } catch (e) {
      console.error("Error restarting discovery:", e);
    }
  }

  async function togglePanel() {
    // Check if this is the first time and ask for permission
    const hasSeenCollabAlert = localStorage.getItem(
      "icp-collab-first-click"
    );
    if (!hasSeenCollabAlert) {
      const accepted = confirm("You are going to activate P2P Collaborative Editing. Do you want to proceed?");
      if (accepted) {
        localStorage.setItem("icp-collab-first-click", "true");
        showPanel = true;
      }
      return;
    }

    // If already collaborating from THIS editor, leave the session
    if (isCollaborating && sessionTopic) {
      await leaveSession();
      showPanel = false; // Close the panel after leaving
      return;
    }

    // If collaborating from another editor, show alert
    const activeCollab = get(activeCollaboration);
    if (
      activeCollab &&
      activeCollab.topic !== sessionTopic &&
      activeCollab.isActive
    ) {
      showAlert = true;
      return;
    }

    // Otherwise, toggle the panel
    showPanel = !showPanel;
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
  class="collaborate-btn"
  class:active={isCollaborating}
  data-theme={theme}
  title={isCollaborating ? "Leave collaboration" : "Start collaboration"}
  style={`position: absolute; right: ${
    type == "vertical"
      ? "calc(var(--output-height) + min(0.5vw, 1vh))"
      : "min(0.5vw, 1vh)"
  }; top: calc(min(2.5vw, 5vh) + min(2vw, 4vh) + min(1vw, 2vh));`}
>
  <!-- Show different icon when collaborating -->
  {#if isCollaborating}
    <svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
      />
    </svg>
  {:else}
    <svg class="icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
      />
    </svg>
  {/if}
</button>

{#if showPanel}
  <!-- Modal overlay for peer discovery -->
  <div class="modal-overlay" on:click={() => (showPanel = false)}>
    <div class="collab-modal" data-theme={theme} on:click|stopPropagation>
      <!-- Header -->
      <div class="modal-header">
        <h3>Collaboration</h3>
        <button class="close-btn" on:click={() => (showPanel = false)}>
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              fill="currentColor"
              d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
        </button>
      </div>

      <!-- User identity -->
      <div class="user-identity">
        <div class="user-avatar">
          <svg viewBox="0 0 24 24" width="20" height="20">
            <path
              fill="currentColor"
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
            />
          </svg>
        </div>
        <div class="user-info">
          <div class="user-label">You are</div>
          <div class="user-name">{formatUserName(userName ?? "Anonymous")}</div>
        </div>
        {#if !discovery}
          <button class="btn-primary" on:click={startDiscovery}
            >Join Discovery</button
          >
        {/if}
      </div>

      <!-- Available peers -->
      {#if !isCollaborating}
        <div class="section">
          <div class="section-title">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="currentColor"
                d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"
              />
            </svg>
            Available Peers
          </div>
          <div class="peers-list">
            {#if discoveredPeers.length === 0}
              <div class="empty-state">
                <svg viewBox="0 0 24 24" width="32" height="32">
                  <path
                    fill="currentColor"
                    opacity="0.3"
                    d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"
                  />
                </svg>
                <div>No peers online</div>
              </div>
            {:else}
              {#each discoveredPeers as p}
                <div class="peer-item">
                  <div class="peer-avatar">
                    {formatUserName(p.name)
                      .split(" ")
                      .map((w) => w[0])
                      .join("")}
                  </div>
                  <div class="peer-name">{formatUserName(p.name)}</div>
                  <button
                    class="btn-secondary"
                    on:click={() => connectToPeer(p.id)}
                  >
                    Connect
                  </button>
                </div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}

      <!-- Invitations -->
      {#if invites.length > 0}
        <div class="section">
          <div class="section-title">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="currentColor"
                d="M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"
              />
            </svg>
            Invitations
          </div>
          <div class="invites-list">
            {#each invites as inv, i}
              <div class="invite-item">
                <div class="invite-info">
                  <div class="invite-from">
                    From {formatUserName(inv.from.name)}
                  </div>
                  <div class="invite-topic">{inv.topic}</div>
                </div>
                <div class="invite-actions">
                  <button class="btn-accept" on:click={() => acceptInvite(i)}>
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path
                        fill="currentColor"
                        d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                      />
                    </svg>
                    Accept
                  </button>
                  <button class="btn-decline" on:click={() => declineInvite(i)}>
                    <svg viewBox="0 0 24 24" width="16" height="16">
                      <path
                        fill="currentColor"
                        d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                      />
                    </svg>
                    Decline
                  </button>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Active session -->
      {#if isCollaborating && sessionTopic}
        <div class="section active-session">
          <div class="section-title">
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="currentColor"
                d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
              />
            </svg>
            Active Session
          </div>
          <div class="session-info">
            <div class="session-detail">
              <span class="detail-label">Session ID:</span>
              <span class="detail-value">{sessionTopic.slice(0, 20)}...</span>
            </div>
            <!-- Removed Connected Peers display -->
          </div>
          <button class="btn-danger" on:click={leaveSession}>
            <svg viewBox="0 0 24 24" width="16" height="16">
              <path
                fill="currentColor"
                d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z"
              />
            </svg>
            Leave Session
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if showAlert}
  <div class="modal-overlay" on:click={() => (showAlert = false)}>
    <div class="alert-modal" data-theme={theme} on:click|stopPropagation>
      <svg viewBox="0 0 24 24" width="48" height="48" class="alert-icon">
        <path
          fill="currentColor"
          d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"
        />
      </svg>
      <h3>Active Collaboration</h3>
      <p>
        Another collaboration is already active in a different editor. Please
        end that session first.
      </p>
      <button class="btn-primary" on:click={() => (showAlert = false)}
        >OK</button
      >
    </div>
  </div>
{/if}

<!-- Modal and Button styles -->

<style>
  /* Collaborate Button */
  .collaborate-btn {
    position: relative;
    width: min(1.8vw, 3.6vh);
    height: min(1.8vw, 3.6vh);
    border: none;
    border-radius: 8px;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 99;
    cursor: pointer;
    transition: all 0.2s ease;
    padding: 0;
    background: transparent;
  }

  .collaborate-btn[data-theme="dark"] {
    background: rgba(255, 255, 255, 0.08);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .collaborate-btn[data-theme="light"] {
    background: rgba(0, 0, 0, 0.04);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }

  .collaborate-btn:hover {
    transform: translateY(-1px);
  }

  .collaborate-btn[data-theme="dark"]:hover {
    background: rgba(255, 255, 255, 0.12);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .collaborate-btn[data-theme="light"]:hover {
    background: rgba(0, 0, 0, 0.06);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  .collaborate-btn.active {
    background: #4caf50 !important;
    box-shadow:
      0 0 0 3px rgba(76, 175, 80, 0.3),
      0 4px 12px rgba(0, 0, 0, 0.2) !important;
  }

  .collaborate-btn .icon {
    width: 65%;
    height: 65%;
  }

  .collaborate-btn[data-theme="dark"] .icon {
    fill: white;
  }

  .collaborate-btn[data-theme="light"] .icon {
    fill: #333;
  }

  .collaborate-btn.active .icon {
    fill: white !important;
  }

  .badge {
    position: absolute;
    top: -4px;
    right: -4px;
    background: #f44336;
    color: white;
    border-radius: 50%;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    font-weight: 600;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
  }

  /* Modal Overlay */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 9999;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* Collaboration Modal */
  .collab-modal {
    position: relative;
    padding: 0;
    border-radius: 12px;
    font-size: 14px;
    min-width: 400px;
    max-width: 500px;
    max-height: 80vh;
    overflow: hidden;
    animation: slideUp 0.3s ease;
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .collab-modal[data-theme="dark"] {
    background: #2a2e33;
    color: #e4e6eb;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  }

  .collab-modal[data-theme="light"] {
    background: #ffffff;
    color: #1c1e21;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  }

  /* Modal Header */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-bottom: 1px solid;
  }

  .collab-modal[data-theme="dark"] .modal-header {
    border-color: rgba(255, 255, 255, 0.1);
  }

  .collab-modal[data-theme="light"] .modal-header {
    border-color: rgba(0, 0, 0, 0.08);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
  }

  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s;
  }

  .collab-modal[data-theme="dark"] .close-btn {
    color: #b0b3b8;
  }

  .collab-modal[data-theme="light"] .close-btn {
    color: #65676b;
  }

  .collab-modal[data-theme="dark"] .close-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .collab-modal[data-theme="light"] .close-btn:hover {
    background: rgba(0, 0, 0, 0.05);
  }

  /* User Identity */
  .user-identity {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 24px;
    border-bottom: 1px solid;
  }

  .collab-modal[data-theme="dark"] .user-identity {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(255, 255, 255, 0.1);
  }

  .collab-modal[data-theme="light"] .user-identity {
    background: rgba(0, 0, 0, 0.02);
    border-color: rgba(0, 0, 0, 0.08);
  }

  .user-avatar {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .collab-modal[data-theme="dark"] .user-avatar {
    background: rgba(76, 175, 80, 0.2);
    color: #4caf50;
  }

  .collab-modal[data-theme="light"] .user-avatar {
    background: rgba(76, 175, 80, 0.15);
    color: #2e7d32;
  }

  .user-info {
    flex: 1;
  }

  .user-label {
    font-size: 12px;
    opacity: 0.7;
    margin-bottom: 2px;
  }

  .user-name {
    font-size: 15px;
    font-weight: 600;
  }

  /* Section */
  .section {
    padding: 20px 24px;
    border-bottom: 1px solid;
  }

  .collab-modal[data-theme="dark"] .section {
    border-color: rgba(255, 255, 255, 0.1);
  }

  .collab-modal[data-theme="light"] .section {
    border-color: rgba(0, 0, 0, 0.08);
  }

  .section:last-child {
    border-bottom: none;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 600;
    margin-bottom: 16px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    opacity: 0.9;
  }

  /* Peers List */
  .peers-list {
    max-height: 200px;
    overflow-y: auto;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    opacity: 0.5;
    gap: 12px;
  }

  .empty-state div {
    font-size: 13px;
  }

  .peer-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    margin-bottom: 8px;
    transition: background 0.2s;
  }

  .collab-modal[data-theme="dark"] .peer-item {
    background: rgba(255, 255, 255, 0.03);
  }

  .collab-modal[data-theme="light"] .peer-item {
    background: rgba(0, 0, 0, 0.02);
  }

  .collab-modal[data-theme="dark"] .peer-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  .collab-modal[data-theme="light"] .peer-item:hover {
    background: rgba(0, 0, 0, 0.04);
  }

  .peer-avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .collab-modal[data-theme="dark"] .peer-avatar {
    background: rgba(66, 165, 245, 0.2);
    color: #42a5f5;
  }

  .collab-modal[data-theme="light"] .peer-avatar {
    background: rgba(66, 165, 245, 0.15);
    color: #1976d2;
  }

  .peer-name {
    flex: 1;
    font-weight: 500;
  }

  /* Invites List */
  .invites-list {
    max-height: 200px;
    overflow-y: auto;
  }

  .invite-item {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    border-radius: 8px;
    margin-bottom: 12px;
  }

  .collab-modal[data-theme="dark"] .invite-item {
    background: rgba(255, 165, 0, 0.1);
    border: 1px solid rgba(255, 165, 0, 0.2);
  }

  .collab-modal[data-theme="light"] .invite-item {
    background: rgba(255, 165, 0, 0.05);
    border: 1px solid rgba(255, 165, 0, 0.15);
  }

  .invite-info {
    flex: 1;
  }

  .invite-from {
    font-weight: 600;
    margin-bottom: 4px;
  }

  .invite-topic {
    font-size: 12px;
    opacity: 0.7;
    font-family: monospace;
  }

  .invite-actions {
    display: flex;
    gap: 8px;
  }

  /* Active Session */
  .active-session {
    background: rgba(76, 175, 80, 0.05);
  }

  .session-info {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 16px;
  }

  .session-detail {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .detail-label {
    font-size: 13px;
    opacity: 0.7;
  }

  .detail-value {
    font-weight: 600;
    font-family: monospace;
    font-size: 13px;
  }

  /* Buttons */
  button {
    font-family: inherit;
    cursor: pointer;
    transition: all 0.2s ease;
    border: none;
    border-radius: 6px;
    font-weight: 500;
    font-size: 13px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }

  .btn-primary {
    padding: 8px 16px;
    background: #4caf50;
    color: white;
  }

  .btn-primary:hover {
    background: #45a049;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
  }

  .btn-secondary {
    padding: 6px 12px;
  }

  .collab-modal[data-theme="dark"] .btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #e4e6eb;
  }

  .collab-modal[data-theme="light"] .btn-secondary {
    background: rgba(0, 0, 0, 0.06);
    color: #1c1e21;
  }

  .collab-modal[data-theme="dark"] .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .collab-modal[data-theme="light"] .btn-secondary:hover {
    background: rgba(0, 0, 0, 0.1);
  }

  .btn-accept {
    padding: 6px 12px;
    background: #4caf50;
    color: white;
  }

  .btn-accept:hover {
    background: #45a049;
  }

  .btn-decline {
    padding: 6px 12px;
  }

  .collab-modal[data-theme="dark"] .btn-decline {
    background: rgba(244, 67, 54, 0.15);
    color: #ef5350;
  }

  .collab-modal[data-theme="light"] .btn-decline {
    background: rgba(244, 67, 54, 0.1);
    color: #d32f2f;
  }

  .collab-modal[data-theme="dark"] .btn-decline:hover {
    background: rgba(244, 67, 54, 0.25);
  }

  .collab-modal[data-theme="light"] .btn-decline:hover {
    background: rgba(244, 67, 54, 0.15);
  }

  .btn-danger {
    padding: 10px 16px;
    background: #f44336;
    color: white;
    width: 100%;
  }

  .btn-danger:hover {
    background: #d32f2f;
    transform: translateY(-1px);
    box-shadow: 0 2px 8px rgba(244, 67, 54, 0.3);
  }

  /* Alert Modal */
  .alert-modal {
    padding: 32px;
    border-radius: 12px;
    text-align: center;
    max-width: 400px;
    width: 90%;
    animation: slideUp 0.3s ease;
  }

  .alert-modal[data-theme="dark"] {
    background: #2a2e33;
    color: #e4e6eb;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  }

  .alert-modal[data-theme="light"] {
    background: #ffffff;
    color: #1c1e21;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  }

  .alert-icon {
    color: #ff9800;
    margin-bottom: 16px;
  }

  .alert-modal h3 {
    margin: 0 0 12px 0;
    font-size: 20px;
    font-weight: 600;
  }

  .alert-modal p {
    margin: 0 0 24px 0;
    opacity: 0.8;
    line-height: 1.5;
  }

  /* Scrollbar */
  .peers-list::-webkit-scrollbar,
  .invites-list::-webkit-scrollbar {
    width: 6px;
  }

  .peers-list::-webkit-scrollbar-track,
  .invites-list::-webkit-scrollbar-track {
    background: transparent;
  }

  .collab-modal[data-theme="dark"] .peers-list::-webkit-scrollbar-thumb,
  .collab-modal[data-theme="dark"] .invites-list::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
  }

  .collab-modal[data-theme="light"] .peers-list::-webkit-scrollbar-thumb,
  .collab-modal[data-theme="light"] .invites-list::-webkit-scrollbar-thumb {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 3px;
  }

  @media screen and (max-width: 768px) {
    .collab-modal {
      min-width: 90vw;
      max-width: 90vw;
    }
  }
</style>
