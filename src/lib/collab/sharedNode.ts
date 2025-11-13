import { createLibp2p, type Libp2p } from "libp2p";
import { gossipsub } from "@chainsafe/libp2p-gossipsub";
import { noise } from "@chainsafe/libp2p-noise";
import { yamux } from "@chainsafe/libp2p-yamux";
import { webRTC } from "@libp2p/webrtc";
import { webSockets } from "@libp2p/websockets";
import * as filters from "@libp2p/websockets/filters";
import { circuitRelayTransport } from "@libp2p/circuit-relay-v2";
import { identify } from "@libp2p/identify";
import { dcutr } from "@libp2p/dcutr";
import { multiaddr } from "@multiformats/multiaddr";
import { DEFAULT_RELAY } from "./constants";

let sharedNode: Libp2p | null = null;

// Reuse the TURN credential fetching logic
async function fetchTURNCredentials() {
  try {
    console.log("Fetching TURN credentials for shared node");
    const response = await fetch(
      "https://icp_turn.metered.live/api/v1/turn/credentials?apiKey=babf119b8f1a317bbe88e33eedc8ca8cd20a"
    );

    if (!response.ok) {
      throw new Error(`API returned status ${response.status}`);
    }

    const data = await response.json();
    const filteredServers = data.filter((server: any, index: number) => {
      if (server.urls.startsWith("stun:")) return true;
      if (server.urls.startsWith("turn:") && index < 4) return true;
      return false;
    });

    return { iceServers: filteredServers };
  } catch (error) {
    console.error("Error fetching TURN credentials:", error);
    return {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        {
          urls: "turn:global.relay.metered.ca:443",
          username: "4589fdae907c33bd2c118a53",
          credential: "valgBS8UTclPlsM1",
        },
      ],
    };
  }
}

export async function getSharedLibp2p(): Promise<Libp2p> {
    if (sharedNode) return sharedNode;

    // Fetch TURN credentials before creating the node
    const iceServersConfig = await fetchTURNCredentials();
    console.log("[sharedNode] Using ICE servers:", iceServersConfig);

    sharedNode = await createLibp2p({
        addresses: { listen: ["/webrtc", "/p2p-circuit"] },
        transports: [
            webRTC({
                rtcConfiguration: {
                    ...iceServersConfig,
                    iceCandidatePoolSize: 4,
                    bundlePolicy: "max-bundle",
                    rtcpMuxPolicy: "require",
                },
            }),
            webSockets({ filter: filters.all }),
            circuitRelayTransport({
                discoverRelays: 1,
            }),
        ],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        connectionManager: {
            maxConnections: 100,
            minConnections: 0,
            autoDial: true,
        },
        services: {
            pubsub: gossipsub({
                allowPublishToZeroPeers: true,
                emitSelf: false,
                canRelayMessage: true,
                doPX: true,
                gossipsubIWantFollowupMs: 3000,
            }),
            identify: identify(),
            dcutr: dcutr({
                timeout: 30000,
            }),
        },
    });

    // Monitor connection upgrades
    sharedNode.addEventListener('connection:open', (evt) => {
        const conn = evt.detail;
        const isRelay = conn.remoteAddr.toString().includes('/p2p-circuit');
        const isWebRTC = conn.remoteAddr.toString().includes('/webrtc');
        console.log(`[sharedNode] Connection opened to ${conn.remotePeer.toString().slice(0, 8)}`);
        console.log(`[sharedNode] Type: ${isRelay ? 'RELAY' : isWebRTC ? 'WebRTC' : 'OTHER'} - ${conn.remoteAddr.toString()}`);
        
        // If it's a direct connection (relay with webrtc), log success
        if (isRelay && isWebRTC) {
            console.log(`[sharedNode] Direct WebRTC connection established via DCUtR!`);
        }
    });

    sharedNode.addEventListener('connection:close', (evt) => {
        const conn = evt.detail;
        console.log(`[sharedNode] Connection closed to ${conn.remotePeer.toString().slice(0, 8)}`);
    });

    try {
        await sharedNode.dial(multiaddr(DEFAULT_RELAY));
        console.log("[sharedNode] Connected to relay:", DEFAULT_RELAY);
    } catch (e) {
        console.warn("[sharedNode] Relay dial failed:", e);
    }

    return sharedNode;
}