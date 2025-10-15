import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  encodeAwarenessUpdate,
  applyAwarenessUpdate,
} from "y-protocols/awareness";
import { yCollab } from "y-codemirror.next";
import { fromString, toString } from "uint8arrays";
// Import only what we absolutely need
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { basicSetup } from "codemirror";
import {
  syntaxHighlighting,
  defaultHighlightStyle,
} from "@codemirror/language";

// Custom Yjs provider using libp2p pubsub
class Libp2pProvider {
  constructor(ydoc, libp2pNode, topic) {
    this.ydoc = ydoc;
    this.libp2p = libp2pNode;
    this.topic = topic;
    this.awareness = new Awareness(ydoc);
    this.connected = false;
    this.synced = false;
    this.messageQueue = []; // Uint8Array payloads waiting for peers
    this.clientId = Math.floor(Math.random() * 100000000);

    console.log(`LibP2P provider created with client ID: ${this.clientId}`);

    // Subscribe to the topic
    this.libp2p.services.pubsub.subscribe(topic);
    console.log(`Provider subscribed to topic: ${topic}`);

    // Announce our presence to the topic
    this.announcePresence();

    // Listen for incoming messages
    this.messageHandler = (event) => {
      if (event.detail.topic === this.topic) {
        this.handleMessage(event.detail);
      }
    };

    this.libp2p.services.pubsub.addEventListener(
      "message",
      this.messageHandler
    );

    // Broadcast Yjs updates
    this.ydoc.on("update", this.broadcastUpdate.bind(this));

    // Broadcast awareness updates
    this.awareness.on("update", this.broadcastAwareness.bind(this));

    // Set up periodic sync to ensure consistency
    this.syncInterval = setInterval(() => {
      this.syncState();
    }, 10000); // sync every 10 seconds

    // Handle subscription changes to detect peers
    this.libp2p.services.pubsub.addEventListener(
      "subscription-change",
      this.handleSubscriptionChange.bind(this)
    );

    this.connected = true;
    console.log("Libp2pProvider initialized");

    // Immediately request sync from any existing peers
    setTimeout(() => this.requestSync(), 500);
  }

  get hasPeers() {
    try {
      return this.libp2p.services.pubsub.getSubscribers(this.topic).length > 0;
    } catch {
      return false;
    }
  }

  async publishSafe(encoded) {
    try {
      await this.libp2p.services.pubsub.publish(this.topic, encoded);
      return true;
    } catch (e) {
      const noPeers =
        typeof e?.message === "string" &&
        e.message.includes("NoPeersSubscribedToTopic");
      if (noPeers) {
        // Queue and flush later
        this.messageQueue.push(encoded);
        return false;
      }
      throw e;
    }
  }

  async flushQueue() {
    if (!this.hasPeers || this.messageQueue.length === 0) return;
    const pending = this.messageQueue.splice(0, this.messageQueue.length);
    for (const payload of pending) {
      try {
        await this.libp2p.services.pubsub.publish(this.topic, payload);
      } catch (e) {
        // Put back if still no peers, otherwise drop on unexpected error
        const noPeers =
          typeof e?.message === "string" &&
          e.message.includes("NoPeersSubscribedToTopic");
        if (noPeers) {
          this.messageQueue.push(payload);
          break;
        }
      }
    }
  }

  async announcePresence() {
    try {
      const message = {
        type: "yjs-presence",
        clientId: this.clientId,
        timestamp: Date.now(),
      };

      await this.publishSafe(fromString(JSON.stringify(message)));

      console.log(
        `Announced presence with client ID ${this.clientId} to topic ${this.topic}`
      );
    } catch (error) {
      console.error("Failed to announce presence:", error);
    }
  }

  handleSubscriptionChange(event) {
    const { peerId, subscriptions } = event.detail;

    // Check if peer subscribed to our editing topic
    const sub = subscriptions.find(
      (s) => s.topic === this.topic && s.subscribe === true
    );

    if (sub) {
      console.log(
        `Peer ${peerId} subscribed to our editor topic - sending sync request`
      );
      this.requestSync();
      // Now that at least one peer is here, flush queued messages
      this.flushQueue();
    }
  }

  async requestSync() {
    try {
      const message = {
        type: "yjs-sync-request",
        clientId: this.clientId,
        timestamp: Date.now(),
      };

      await this.publishSafe(fromString(JSON.stringify(message)));

      console.log("Requested document sync from peers");
    } catch (error) {
      console.error("Failed to request sync:", error);
    }
  }

  async syncState() {
    if (!this.synced) {
      console.log("Performing periodic sync...");
      this.requestSync();
    }

    // Also re-broadcast awareness data periodically
    this.broadcastAwareness();
  }

  async broadcastUpdate(update, origin) {
    if (origin === this) return; // Don't broadcast our own updates back

    try {
      const message = {
        type: "yjs-update",
        update: Array.from(update),
        clientId: this.clientId,
        timestamp: Date.now(),
      };

      await this.publishSafe(fromString(JSON.stringify(message)));

      console.log(`Broadcasted document update (${update.length} bytes)`);
    } catch (error) {
      console.error("Failed to broadcast Yjs update:", error);
    }
  }

  async broadcastAwareness() {
    try {
      // Use the imported encodeAwarenessUpdate
      const awarenessUpdate = encodeAwarenessUpdate(
        this.awareness,
        Array.from(this.awareness.getStates().keys())
      );

      const message = {
        type: "yjs-awareness",
        update: Array.from(awarenessUpdate),
        clientId: this.clientId,
        timestamp: Date.now(),
      };

      await this.publishSafe(fromString(JSON.stringify(message)));

      console.log(
        `Broadcasted awareness update (${awarenessUpdate.length} bytes)`
      );
    } catch (error) {
      console.error("Failed to broadcast awareness:", error);
    }
  }

  async sendDocumentState(targetClientId) {
    try {
      // Create a full document state update
      const state = Y.encodeStateAsUpdate(this.ydoc);

      const message = {
        type: "yjs-sync",
        state: Array.from(state),
        clientId: this.clientId,
        targetClientId: targetClientId,
        timestamp: Date.now(),
      };

      await this.publishSafe(fromString(JSON.stringify(message)));

      console.log(
        `Sent full document state to client ${targetClientId} (${state.length} bytes)`
      );
    } catch (error) {
      console.error("Failed to send document state:", error);
    }
  }

  handleMessage(detail) {
    try {
      const messageStr = toString(detail.data);
      const message = JSON.parse(messageStr);

      // Don't process our own messages
      if (message.clientId === this.clientId) {
        return;
      }

      switch (message.type) {
        case "yjs-update":
          console.log(
            `Received document update from client ${message.clientId}`
          );
          const update = new Uint8Array(message.update);
          Y.applyUpdate(this.ydoc, update, this);
          break;

        case "yjs-awareness":
          console.log(
            `Received awareness update from client ${message.clientId}`
          );
          const awarenessUpdate = new Uint8Array(message.update);
          // Use imported applyAwarenessUpdate
          applyAwarenessUpdate(this.awareness, awarenessUpdate, this);
          break;

        case "yjs-sync-request":
          console.log(`Received sync request from client ${message.clientId}`);
          this.sendDocumentState(message.clientId);
          break;

        case "yjs-sync":
          if (
            !message.targetClientId ||
            message.targetClientId === this.clientId
          ) {
            console.log(
              `Received full document state from client ${message.clientId}`
            );
            const state = new Uint8Array(message.state);
            Y.applyUpdate(this.ydoc, state, this);
            this.synced = true;
            this.emit("synced", [this.ydoc]);
          }
          break;

        case "yjs-presence":
          console.log(`Detected peer with client ID ${message.clientId}`);
          // If we're the first one here (smaller ID), we should send them our state
          if (this.clientId < message.clientId) {
            setTimeout(() => this.sendDocumentState(message.clientId), 500);
          }
          break;
      }
    } catch (error) {
      console.error("Failed to handle message:", error);
    }
  }

  emit(eventName, args) {
    // Simple event emitter implementation
    if (eventName === "synced" && typeof this.onSynced === "function") {
      this.onSynced(...args);
    }
  }

  on(eventName, callback) {
    // Simple event subscription
    if (eventName === "synced") {
      this.onSynced = callback;
    }
  }

  destroy() {
    if (this.messageHandler) {
      this.libp2p.services.pubsub.removeEventListener(
        "message",
        this.messageHandler
      );
    }

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    try {
      this.libp2p.services.pubsub.unsubscribe(this.topic);
      console.log(`Unsubscribed from topic ${this.topic}`);
    } catch (error) {
      console.error("Error unsubscribing from topic:", error);
    }

    this.ydoc.off("update", this.broadcastUpdate);
    this.awareness.off("update", this.broadcastAwareness);
    this.awareness.destroy();
    this.connected = false;
    this.synced = false;

    console.log("Libp2pProvider destroyed");
  }
}

/**
 * Collaborative editing manager using Yjs + CodeMirror 6 + libp2p
 */
export class CollaborativeEditor {
  constructor() {
    this.ydoc = null;
    this.ytext = null;
    this.provider = null;
    this.editorView = null;
    this.libp2pNode = null;
    this.topic = null;
    this.undoManager = null;
    this.outputElement = null;
    this.initialized = false;
  }

  /**
   * Initialize the collaborative editor
   * @param {Object} libp2pNode - The libp2p node instance
   * @param {string} topic - The topic/room name for collaboration
   * @param {HTMLElement} editorContainer - DOM element to mount the editor
   * @param {Object} userInfo - User information {name, color}
   */
  async initialize(libp2pNode, topic, editorContainer, userInfo = {}) {
    if (!libp2pNode) {
      throw new Error("libp2p node is required");
    }

    if (!topic) {
      throw new Error("Topic is required");
    }

    if (!editorContainer) {
      throw new Error("Editor container element is required");
    }

    this.libp2pNode = libp2pNode;
    this.topic = topic;

    console.log(`Initializing collaborative editor with topic: ${topic}`);
    console.log(
      `Current pubsub peers: ${libp2pNode.services.pubsub
        .getTopics()
        .join(", ")}`
    );

    // Create Yjs document and shared text
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText("codemirror");

    // Create custom libp2p provider
    console.log(`Creating Yjs provider for topic: ${topic}`);
    this.provider = new Libp2pProvider(this.ydoc, this.libp2pNode, topic);

    // Set local user awareness info for cursors/selections
    const defaultUserInfo = {
      name: userInfo.name || `User-${Math.floor(Math.random() * 1000)}`,
      color: userInfo.color || this.generateRandomColor(),
    };

    this.provider.awareness.setLocalStateField("user", defaultUserInfo);
    console.log(`Set user awareness:`, defaultUserInfo);

    // Create undo manager
    this.undoManager = new Y.UndoManager(this.ytext);

    // Create run button and output div
    this.createRunButton(editorContainer);

    // Setup CodeMirror 6 editor
    this.setupEditor(editorContainer);

    // Mark as initialized to prevent duplicate initializations
    this.initialized = true;

    // Log provider events
    this.setupProviderListeners();

    console.log("Collaborative editor initialized");

    // Register sync event handler
    this.provider.on("synced", () => {
      console.log("Document synced with remote peers");
    });

    // Initial announcements and sync requests
    setTimeout(() => {
      this.provider.announcePresence();
      this.provider.requestSync();

      // Check subscriptions
      const subscribers = this.libp2pNode.services.pubsub.getSubscribers(topic);
      console.log(`Current subscribers to ${topic}: ${subscribers.length}`);
      subscribers.forEach((peer) => console.log(`- Peer: ${peer.toString()}`));
    }, 1000);
  }

  /**
   * Create run button and output area
   * @param {HTMLElement} container - The container element
   */
  createRunButton(container) {
    const parentElement = container.parentElement;

    // Create run container
    const runContainer = document.createElement("div");
    runContainer.style.marginTop = "10px";
    runContainer.style.display = "flex";
    runContainer.style.flexDirection = "column";
    runContainer.style.gap = "10px";

    // Create run button
    const runButton = document.createElement("button");
    runButton.textContent = "Run Code";
    runButton.style.padding = "8px 16px";
    runButton.style.backgroundColor = "#4CAF50";
    runButton.style.color = "white";
    runButton.style.border = "none";
    runButton.style.borderRadius = "4px";
    runButton.style.cursor = "pointer";
    runButton.style.alignSelf = "flex-start";

    // Create output area
    const outputContainer = document.createElement("div");
    outputContainer.style.border = "1px solid #ccc";
    outputContainer.style.padding = "10px";
    outputContainer.style.backgroundColor = "#f9f9f9";
    outputContainer.style.borderRadius = "4px";
    outputContainer.style.fontFamily = "monospace";
    outputContainer.style.whiteSpace = "pre-wrap";
    outputContainer.style.minHeight = "100px";
    outputContainer.style.maxHeight = "200px";
    outputContainer.style.overflow = "auto";

    // Output header
    const outputHeader = document.createElement("div");
    outputHeader.textContent = "Output:";
    outputHeader.style.fontWeight = "bold";
    outputHeader.style.marginBottom = "5px";

    // Output content
    this.outputElement = document.createElement("div");
    this.outputElement.id = "code-output";

    // Assemble elements
    outputContainer.appendChild(outputHeader);
    outputContainer.appendChild(this.outputElement);

    runContainer.appendChild(runButton);
    runContainer.appendChild(outputContainer);

    // Insert after the editor container
    if (parentElement) {
      parentElement.appendChild(runContainer);
    }

    // Add click handler
    runButton.addEventListener("click", () => this.executeCode());
  }

  /**
   * Execute the code in the editor
   */
  executeCode() {
    if (!this.outputElement) return;

    const code = this.getContent();
    if (!code) {
      this.outputElement.textContent = "No code to run";
      return;
    }

    // Clear previous output
    this.outputElement.textContent = "";
    this.outputElement.style.color = "";

    // Save original console methods
    const originalLog = console.log;
    const originalError = console.error;
    const originalWarn = console.warn;
    const originalInfo = console.info;

    try {
      // Override console methods to capture output
      const output = [];
      console.log = (...args) => {
        output.push(args.map((arg) => this.formatOutput(arg)).join(" "));
        originalLog.apply(console, args);
      };
      console.error = (...args) => {
        output.push(
          `Error: ${args.map((arg) => this.formatOutput(arg)).join(" ")}`
        );
        originalError.apply(console, args);
      };
      console.warn = (...args) => {
        output.push(
          `Warning: ${args.map((arg) => this.formatOutput(arg)).join(" ")}`
        );
        originalWarn.apply(console, args);
      };
      console.info = (...args) => {
        output.push(
          `Info: ${args.map((arg) => this.formatOutput(arg)).join(" ")}`
        );
        originalInfo.apply(console, args);
      };

      // Execute the code
      const result = new Function(code)();

      // Display output
      if (output.length > 0) {
        this.outputElement.textContent = output.join("\n");
      } else if (result !== undefined) {
        this.outputElement.textContent = this.formatOutput(result);
      } else {
        this.outputElement.textContent =
          "Code executed successfully with no output";
      }
    } catch (error) {
      // Show error
      this.outputElement.textContent = `Error: ${error.message}`;
      this.outputElement.style.color = "red";
    } finally {
      // Restore console methods
      console.log = originalLog;
      console.error = originalError;
      console.warn = originalWarn;
      console.info = originalInfo;
    }
  }

  /**
   * Format output for display
   * @param {any} value - Value to format
   * @returns {string} Formatted string
   */
  formatOutput(value) {
    if (value === undefined) return "undefined";
    if (value === null) return "null";

    if (typeof value === "object") {
      try {
        return JSON.stringify(value, null, 2);
      } catch (e) {
        return value.toString();
      }
    }

    return String(value);
  }

  /**
   * Setup CodeMirror 6 editor with Yjs binding
   * @param {HTMLElement} container - DOM container
   */
  setupEditor(container) {
    try {
      // Initial content for a new document
      const initialContent = `// Collaborative JavaScript Editor
// Start typing to collaborate in real-time!

function greet(name) {
  return \`Hello, \${name}!\`;
}

console.log(greet("World"));
`;

      const editor = new EditorView({
        state: EditorState.create({
          extensions: [
            basicSetup,
            javascript(),
            syntaxHighlighting(defaultHighlightStyle),
            // Make gutters and content use exactly the same metrics
            EditorView.theme({
              "&": { height: "100%" },
              ".cm-content, .cm-gutter": {
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                lineHeight: "1.4",
                fontSize: "14px",
              },
              ".cm-gutters": { borderRight: "1px solid #ddd" },
            }),
            yCollab(this.ytext, this.provider.awareness, {
              undoManager: this.undoManager,
            }),
          ],
        }),
        parent: container,
      });

      this.editorView = editor;

      // Seed initial content once (awareness-based tie-breaker)
      const isDocEmpty = this.ytext.toString() === "";
      if (isDocEmpty) {
        setTimeout(() => {
          const states = this.provider.awareness.getStates();
          const selfId = this.provider.awareness.clientID;
          const ids = Array.from(states.keys());
          const others = ids.filter((id) => id !== selfId);
          const shouldSeed = others.length === 0 || selfId === Math.min(...ids);
          if (shouldSeed && this.ytext.length === 0) {
            this.setContent(initialContent);
            console.log("Seeded initial editor content");
          } else {
            console.log("Skipping seed (another peer will/has seeded)");
          }
        }, 400);
      }

      console.log(
        "CodeMirror editor created with collaboration + highlighting"
      );
    } catch (error) {
      console.error("Error creating editor:", error);
      throw error;
    }
  }

  /**
   * Setup provider event listeners for debugging
   */
  setupProviderListeners() {
    // Track awareness changes
    this.provider.awareness.on("change", () => {
      const states = this.provider.awareness.getStates();
      const peerCount = states.size - 1; // Exclude self
      console.log(`Collaborators: ${peerCount} peer(s) connected`);

      // Log detailed awareness info
      if (peerCount > 0) {
        states.forEach((state, clientId) => {
          if (clientId !== this.provider.awareness.clientID && state.user) {
            console.log(
              `- Peer ${clientId}: ${state.user.name} (${state.user.color})`
            );
          }
        });
      }
    });

    // Log Yjs document updates
    this.ydoc.on("update", (update, origin) => {
      if (origin !== this.provider) {
        console.log("Document updated locally");
      } else {
        console.log("Document updated from remote peer");
      }
    });
  }

  /**
   * Generate a random color for user cursors
   * @returns {string} Hex color
   */
  generateRandomColor() {
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

  /**
   * Get connected peers info
   * @returns {Array} Array of peer info objects
   */
  getConnectedPeers() {
    const states = this.provider.awareness.getStates();
    const peers = [];

    states.forEach((state, clientId) => {
      if (clientId !== this.provider.awareness.clientID) {
        peers.push({
          clientId,
          user: state.user || { name: "Anonymous", color: "#999" },
        });
      }
    });

    return peers;
  }

  /**
   * Set the editor content (useful for initial load)
   * @param {string} content - Initial content
   */
  setContent(content) {
    if (this.ytext && content) {
      this.ydoc.transact(() => {
        this.ytext.delete(0, this.ytext.length);
        this.ytext.insert(0, content);
      });
    }
  }

  /**
   * Get current editor content
   * @returns {string} Current content
   */
  getContent() {
    return this.ytext ? this.ytext.toString() : "";
  }

  /**
   * Destroy the editor and cleanup
   */
  destroy() {
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }

    if (this.provider) {
      this.provider.destroy();
      this.provider = null;
    }

    if (this.ydoc) {
      this.ydoc.destroy();
      this.ydoc = null;
    }

    this.ytext = null;
    this.undoManager = null;
    this.initialized = false;

    // Remove the output element and run button if they exist
    if (this.outputElement && this.outputElement.parentElement) {
      const outputContainer = this.outputElement.parentElement.parentElement;
      if (outputContainer && outputContainer.parentElement) {
        outputContainer.parentElement.remove();
      }
    }

    console.log("Collaborative editor destroyed");
  }

  /**
   * Update user info (name/color)
   * @param {Object} userInfo - {name, color}
   */
  updateUserInfo(userInfo) {
    if (this.provider && this.provider.awareness) {
      this.provider.awareness.setLocalStateField("user", {
        ...this.provider.awareness.getLocalState()?.user,
        ...userInfo,
      });
    }
  }
}

/**
 * Create and initialize a collaborative editor
 * @param {Object} config - Configuration object
 * @returns {CollaborativeEditor} Editor instance
 */
export async function createCollaborativeEditor(config) {
  const { libp2pNode, topic, container, userInfo } = config;

  const editor = new CollaborativeEditor();
  await editor.initialize(libp2pNode, topic, container, userInfo);

  return editor;
}
