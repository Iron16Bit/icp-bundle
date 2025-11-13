import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { encodeAwarenessUpdate, applyAwarenessUpdate } from "y-protocols/awareness";
import { fromString, toString } from "uint8arrays";
import { createLibp2p, Libp2p } from "libp2p";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { webRTC } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { dcutr } from "@libp2p/dcutr";
import { identify } from "@libp2p/identify";
import { multiaddr } from "@multiformats/multiaddr";
import { DEFAULT_RELAY } from "./constants";

type ProviderMessage =
  | { type: "yjs-update"; update: number[]; clientId: number; timestamp: number }
  | { type: "yjs-awareness"; update: number[]; clientId: number; timestamp: number }
  | { type: "yjs-sync-request"; clientId: number; timestamp: number }
  | { type: "yjs-sync-response"; state: number[]; clientId: number; timestamp: number }
  | { type: "yjs-presence"; clientId: number; timestamp: number };

function getFallbackIceServers() {
  console.log("Using fallback ICE servers");
  return {
    iceServers: [
      {
        urls: "stun:stun.l.google.com:19302",
      },
      {
        urls: "turn:global.relay.metered.ca:443",
        username: "4589fdae907c33bd2c118a53",
        credential: "valgBS8UTclPlsM1",
      },
      {
        urls: "turn:global.relay.metered.ca:443?transport=tcp",
        username: "4589fdae907c33bd2c118a53",
        credential: "valgBS8UTclPlsM1",
      },
    ],
  };
}

async function fetchTURNCredentials() {
  try {
    console.log("Fetching TURN credentials from Metered API");
    const response = await fetch(
      "https://icp_turn.metered.live/api/v1/turn/credentials?apiKey=babf119b8f1a317bbe88e33eedc8ca8cd20a"
    );

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json();
    console.log("Retrieved TURN credentials from Metered API");

    if (!Array.isArray(data) || data.length === 0) {
      console.warn("API returned unexpected format or empty array");
      return getFallbackIceServers();
    }

    // Filter to only use the most reliable servers (limit to 3-4 servers)
    const filteredServers = data.filter((server: any, index: number) => {
      // Keep STUN servers and limit TURN servers
      if (server.urls.startsWith("stun:")) return true;
      if (server.urls.startsWith("turn:") && index < 4) return true;
      return false;
    });

    console.log(`Using ${filteredServers.length} ICE servers from API`);
    return { iceServers: filteredServers };
  } catch (error) {
    console.error("Error fetching TURN credentials:", error);
    return getFallbackIceServers();
  }
}

export class Libp2pProvider {
  public readonly ydoc: Y.Doc;
  public readonly awareness: Awareness;
  public readonly topic: string;
  public readonly libp2p: Libp2p;

  private messageHandler: (event: CustomEvent) => void;
  private subscribed = false;
  private connected = false;
  private synced = false;
  private messageQueue: Uint8Array[] = [];
  private clientId: number;
  private syncInterval: NodeJS.Timeout | null = null;
  private _boundDocUpdate?: (u: Uint8Array, o: any) => void;
  private _boundAwarenessUpdate?: (...args: any[]) => void;
  private ownsLibp2p: boolean;
  private discoveredPeers = new Set<string>();
  private relayPeerId: string | null = null; // NEW: Track relay peer ID

  constructor(ydoc: Y.Doc, libp2p: Libp2p, topic: string, awareness?: Awareness, ownsLibp2p = false) {
    this.ydoc = ydoc;
    this.libp2p = libp2p;
    this.topic = topic;
    this.awareness = awareness || new Awareness(ydoc);
    this.clientId = Math.floor(Math.random() * 100000000);
    this.ownsLibp2p = ownsLibp2p;

    console.log(`LibP2P provider created with client ID: ${this.clientId}`);

    // Setup message handler
    this.messageHandler = (event: any) => {
      if (event.detail?.topic === this.topic) {
        this.handleMessage(event.detail);
      }
    };
  }

  static async create(ydoc: Y.Doc, topic: string, relayAddr?: string, awareness?: Awareness) {
    const iceServersConfig = await fetchTURNCredentials();
    console.log("TURN credentials for libp2p:", iceServersConfig);

    const node = await createLibp2p({
      addresses: {
        listen: ["/p2p-circuit", "/webrtc"],
      },
      transports: [
        webSockets({ filter: filters.all }),
        webRTC({
          rtcConfiguration: {
            ...iceServersConfig,
            iceCandidatePoolSize: 4,
            bundlePolicy: "max-bundle",
            rtcpMuxPolicy: "require",
          },
        }),
        circuitRelayTransport({
          // Add this configuration to prioritize direct connections
          discoverRelays: 1,
        }),
      ],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      connectionGater: {
        denyDialMultiaddr: () => false,
      },
      connectionManager: {
        // Add connection manager settings
        maxConnections: 100,
        minConnections: 0,
        // Ensure we don't keep relay connections when direct ones are available
        autoDial: true,
      },
      services: {
        pubsub: gossipsub({
          allowPublishToZeroPeers: true,
          emitSelf: false,
          gossipIncoming: true,
          canRelayMessage: true,
        }),
        identify: identify(),
        dcutr: dcutr({
          // Ensure DCUtR is properly configured
          timeout: 30000, // 30 seconds to establish direct connection
        }),
      },
    });

    console.log(`LibP2P node created with PeerId: ${node.peerId.toString()}`);

    // Connect to relay
    const relay = relayAddr || DEFAULT_RELAY;
    let relayPeerId: string | null = null;
    try {
      console.log(`Attempting to dial relay at: ${relay}`);
      const connection = await node.dial(multiaddr(relay));
      console.log("Connected to relay server:", connection.remoteAddr.toString());
      
      // Extract relay peer ID
      relayPeerId = connection.remotePeer.toString();
      console.log(`Relay Peer ID: ${relayPeerId}`);
      
      // Add connection monitoring to see when DCUtR upgrades happen
      node.addEventListener('connection:open', (evt) => {
        const conn = evt.detail;
        console.log(`Connection opened to ${conn.remotePeer.toString()}`);
        console.log(`Connection type: ${conn.transports[0]}`);
      });
      
      node.addEventListener('connection:close', (evt) => {
        const conn = evt.detail;
        console.log(`Connection closed to ${conn.remotePeer.toString()}`);
      });
    } catch (e) {
      console.error("Relay dial failed:", e);
    }

    const provider = new Libp2pProvider(ydoc, node, topic, awareness, true);
    provider.relayPeerId = relayPeerId; // Store relay peer ID
    return provider;
  }

  get hasPeers(): boolean {
    try {
      return this.libp2p.services.pubsub.getSubscribers(this.topic).length > 0;
    } catch {
      return false;
    }
  }

  async publishSafe(encoded: Uint8Array): Promise<boolean> {
    try {
      await this.libp2p.services.pubsub.publish(this.topic, encoded);
      return true;
    } catch (e: any) {
      const noPeers =
        typeof e?.message === "string" &&
        (e.message.includes("NoPeersSubscribedToTopic") ||
         e.message.includes("PublishError.NoPeersSubscribedToTopic"));
      
      if (noPeers) {
        // Queue message for later
        this.messageQueue.push(encoded);
        return false;
      }
      console.error("Publish error:", e);
      throw e;
    }
  }

  async flushQueue() {
    if (!this.hasPeers || this.messageQueue.length === 0) return;
    
    console.log(`Flushing ${this.messageQueue.length} queued messages`);
    const pending = this.messageQueue.splice(0, this.messageQueue.length);
    
    for (const payload of pending) {
      try {
        await this.libp2p.services.pubsub.publish(this.topic, payload);
      } catch (e: any) {
        // Put back if still no peers, otherwise drop on unexpected error
        const noPeers = typeof e?.message === "string" &&
          (e.message.includes("NoPeersSubscribedToTopic") ||
           e.message.includes("PublishError.NoPeersSubscribedToTopic"));
        
        if (noPeers) {
          this.messageQueue.push(payload);
          break; // Stop trying if we still have no peers
        } else {
          console.warn("Failed to publish queued message:", e);
        }
      }
    }
  }

  async announcePresence() {
    const message: ProviderMessage = {
      type: "yjs-presence",
      clientId: this.clientId,
      timestamp: Date.now(),
    };

    await this.publishSafe(fromString(JSON.stringify(message)));
    console.log("Announced presence to topic");
  }

  private publish(msg: any) {
    try {
      const data = new TextEncoder().encode(JSON.stringify(msg));
      this.libp2p.services.pubsub.publish(this.topic, data);
    } catch (e) {
      console.error("Failed to publish message", e, msg);
    }
  }

  async requestSync() {
    const message: ProviderMessage = {
      type: "yjs-sync-request",
      clientId: this.clientId,
      timestamp: Date.now(),
    };

    await this.publishSafe(fromString(JSON.stringify(message)));
    console.log("Requested sync from peers");
  }

  async syncState() {
    if (!this.hasPeers) return;

    const state = Y.encodeStateAsUpdate(this.ydoc);
    const message: ProviderMessage = {
      type: "yjs-sync-response",
      state: Array.from(state),
      clientId: this.clientId,
      timestamp: Date.now(),
    };

    await this.publishSafe(fromString(JSON.stringify(message)));
    console.log("Broadcasted full state sync");
  }

  async broadcastUpdate(update: Uint8Array, origin: any) {
    if (origin === this) return; // Don't broadcast updates that we applied from remote
    try {
      const message: ProviderMessage = {
        type: "yjs-update",
        update: Array.from(update),
        clientId: this.clientId,
        timestamp: Date.now(),
      };
      await this.publishSafe(fromString(JSON.stringify(message)));
      console.log(`Broadcasted Yjs update (${update.length} bytes)`);
    } catch (error) {
      console.error("Failed to broadcast Yjs update:", error);
    }
  }

  async broadcastAwareness() {
    try {
      const awarenessUpdate = encodeAwarenessUpdate(
        this.awareness,
        Array.from(this.awareness.getStates().keys())
      );

      const message: ProviderMessage = {
        type: "yjs-awareness",
        update: Array.from(awarenessUpdate),
        clientId: this.clientId,
        timestamp: Date.now(),
      };

      await this.publishSafe(fromString(JSON.stringify(message)));
      console.log(`Broadcasted awareness update (${awarenessUpdate.length} bytes)`);
    } catch (error) {
      console.error("Failed to broadcast awareness:", error);
    }
  }

  async sendDocumentState(targetClientId: number) {
    const state = Y.encodeStateAsUpdate(this.ydoc);
    const message: ProviderMessage = {
      type: "yjs-sync-response",
      state: Array.from(state),
      clientId: this.clientId,
      timestamp: Date.now(),
    };

    await this.publishSafe(fromString(JSON.stringify(message)));
    console.log(`Sent full document state to client ${targetClientId} (${state.length} bytes)`);
  }

  handleMessage(detail: any) {
    try {
      const dataStr = toString(detail.data);
      const message = JSON.parse(dataStr) as ProviderMessage;

      // Ignore own messages
      if (message.clientId === this.clientId) {
        return;
      }

      console.log(`Received message type: ${message.type} from client ${message.clientId}`);

      switch (message.type) {
        case "yjs-update": {
          const update = new Uint8Array(message.update);
          Y.applyUpdate(this.ydoc, update, this);
          console.log(`Applied Yjs update (${update.length} bytes)`);
          break;
        }

        case "yjs-awareness": {
          const update = new Uint8Array(message.update);
          applyAwarenessUpdate(this.awareness, update, this);
          console.log(`Applied awareness update (${update.length} bytes)`);
          break;
        }

        case "yjs-sync-request": {
          console.log(`Sync requested by client ${message.clientId}`);
          setTimeout(() => this.sendDocumentState(message.clientId), 500);
          break;
        }

        case "yjs-sync-response": {
          const state = new Uint8Array(message.state);
          Y.applyUpdate(this.ydoc, state, this);
          this.synced = true;
          console.log(`Applied sync response (${state.length} bytes)`);
          break;
        }

        case "yjs-presence": {
          console.log(`Peer ${message.clientId} announced presence`);
          this.flushQueue();
          break;
        }
      }
    } catch (error) {
      console.error("Failed to handle message:", error);
    }
  }

  async start() {
    if (this.subscribed) return;

    await this.libp2p.services.pubsub.subscribe(this.topic);
    console.log(`Provider subscribed to topic: ${this.topic}`);

    await this.announcePresence();

    // Add connection monitoring
    this.logConnectionTypes();
    setInterval(() => this.logConnectionTypes(), 10000);

    // **MODIFIED: Listen for ALL messages on this topic**
    this.libp2p.services.pubsub.addEventListener("message", (async (event: CustomEvent) => {
      if (event.detail?.topic !== this.topic) return;
      
      try {
        const msgStr = toString(event.detail.data);
        const msg = JSON.parse(msgStr);
        
        console.log(`📨 [Provider] Received message type: ${msg.type}`);
        
        // Handle relay discovery messages FIRST, before regular message handler
        if (msg.type === 'relay-discovery') {
          console.log(`📡 [Provider] Relay discovery with ${msg.peers?.length || 0} peers`);
          
          if (!msg.peers || !Array.isArray(msg.peers)) {
            console.warn('[Provider] Invalid relay discovery message format');
            return;
          }
          
          for (const peer of msg.peers) {
            const peerId = peer.peerId;
            
            if (!peerId) {
              console.warn('[Provider] Peer missing peerId');
              continue;
            }
            
            // Skip ourselves and the relay
            if (peerId === this.libp2p.peerId.toString()) {
              console.log('[Provider] Skipping self');
              continue;
            }
            if (this.relayPeerId && peerId === this.relayPeerId) {
              console.log('[Provider] Skipping relay');
              continue;
            }
            
            // Check if already connected
            const connections = this.libp2p.getConnections().filter(
              conn => conn.remotePeer.toString() === peerId
            );
            if (connections.length > 0) {
              console.log(`[Provider] Already connected to ${peerId.slice(0, 8)}`);
              continue;
            }
            
            // Dial using the circuit relay address provided
            if (peer.multiaddrs && peer.multiaddrs.length > 0) {
              const circuitAddr = peer.multiaddrs[0];
              console.log(`🔌 [Provider] Dialing ${peerId.slice(0, 8)} via: ${circuitAddr}`);
              
              try {
                await this.libp2p.dial(multiaddr(circuitAddr));
                console.log(`✅ [Provider] Connected to ${peerId.slice(0, 8)}`);
              } catch (err) {
                console.warn(`❌ [Provider] Failed to dial ${peerId.slice(0, 8)}:`, err);
              }
            } else {
              console.warn(`[Provider] No multiaddrs for peer ${peerId.slice(0, 8)}`);
            }
          }
          return; // Don't process as regular message
        }
        
        // Pass to regular message handler for Yjs messages
        this.handleMessage(event.detail);
        
      } catch (err) {
        console.error('[Provider] Error processing message:', err);
      }
    }) as any);

    // Listen for peers joining
    this.libp2p.services.pubsub.addEventListener("subscription-change", (async (event: CustomEvent) => {
      const { peerId, subscriptions } = event.detail;
      const sub = subscriptions.find((s) => s.topic === this.topic && s.subscribe === true);
      
      if (sub) {
        const peerIdStr = peerId.toString();
        
        // Skip relay and ourselves
        if (this.relayPeerId && peerIdStr === this.relayPeerId) {
          return;
        }
        
        if (peerIdStr === this.libp2p.peerId.toString()) {
          return;
        }
        
        console.log(`Peer ${peerIdStr.slice(0, 8)} subscribed to ${this.topic}`);
        
        if (!this.discoveredPeers.has(peerIdStr)) {
          this.discoveredPeers.add(peerIdStr);
          await this.connectToPeer(peerIdStr);
        }
        
        this.requestSync();
        this.flushQueue();
      }
    }) as any);

    // Broadcast Yjs updates
    this._boundDocUpdate = this.broadcastUpdate.bind(this);
    this.ydoc.on("update", this._boundDocUpdate);

    // Broadcast awareness updates
    this._boundAwarenessUpdate = this.broadcastAwareness.bind(this);
    this.awareness.on("update", this._boundAwarenessUpdate as any);

    // Set up periodic sync
    this.syncInterval = setInterval(() => {
      this.syncState();
      const subscribers = this.libp2p.services.pubsub.getSubscribers(this.topic);
      console.log(`Current subscribers to ${this.topic}: ${subscribers.length}`);
      subscribers.forEach((peer) => console.log(`- Peer: ${peer.toString()}`));
    }, 10000);

    this.connected = true;
    this.subscribed = true;

    setTimeout(() => {
      this.requestSync();
    }, 1000);
  }

  /**
   * Try to establish a direct connection to a peer through the relay
   */
  private async connectToPeer(peerIdStr: string) {
    try {
      // Check if we're already connected
      const existingConns = this.libp2p.getConnections().filter(
        conn => conn.remotePeer.toString() === peerIdStr
      );
      
      if (existingConns.length > 0) {
        console.log(`Already connected to peer ${peerIdStr.slice(0, 8)}`);
        return;
      }

      // Construct a circuit relay address to reach the peer through the relay
      if (!this.relayPeerId) {
        console.warn(`Cannot dial peer ${peerIdStr.slice(0, 8)} - no relay peer ID`);
        return;
      }
      
      const circuitAddr = `/p2p/${this.relayPeerId}/p2p-circuit/p2p/${peerIdStr}`;
      
      console.log(`🔌 Attempting to dial peer ${peerIdStr.slice(0, 8)} via circuit relay`);
      console.log(`   Circuit address: ${circuitAddr}`);
      
      const connection = await this.libp2p.dial(multiaddr(circuitAddr));
      
      console.log(`✅ Connected to peer ${peerIdStr.slice(0, 8)} via relay`);
      console.log(`   Connection: ${connection.remoteAddr.toString()}`);
      console.log(`   🔄 DCUtR should now upgrade to direct WebRTC...`);
      
    } catch (error) {
      console.warn(`❌ Failed to connect to peer ${peerIdStr.slice(0, 8)}:`, error);
    }
  }

  private logConnectionTypes() {
    const connections = this.libp2p.getConnections();
    console.log(`Active connections: ${connections.length}`);
    connections.forEach(conn => {
      const isRelay = conn.remoteAddr.toString().includes('/p2p-circuit');
      const isWebRTC = conn.remoteAddr.toString().includes('/webrtc');
      console.log(`  ${conn.remotePeer.toString().slice(0, 8)}: ${isRelay ? 'RELAY' : isWebRTC ? 'WebRTC' : 'OTHER'} - ${conn.remoteAddr.toString()}`);
    });
  }

  async stop() {
    if (!this.subscribed) return;

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    if (this._boundDocUpdate) this.ydoc.off("update", this._boundDocUpdate);
    if (this._boundAwarenessUpdate) this.awareness.off("update", this._boundAwarenessUpdate as any);

    // Remove message listener properly
    this.libp2p.services.pubsub.removeEventListener("message", this.messageHandler as any);

    await this.libp2p.services.pubsub.unsubscribe(this.topic);
    this.subscribed = false;
    this.connected = false;
  }

  async destroy() {
    await this.stop();
    try {
      if (this.ownsLibp2p) {
        await this.libp2p.stop();
      }
    } catch (e) {
      console.error("Error stopping libp2p:", e);
    }
  }

  getPeerNames(): string[] {
    const peers: string[] = [];
    this.awareness.getStates().forEach((state, id) => {
      if (id !== this.awareness.clientID) {
        const name = state?.user?.name || `Peer-${id}`;
        peers.push(name);
      }
    });
    return peers;
  }

  getLibp2p() {
    return this.libp2p;
  }
}