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

export async function getSharedLibp2p(): Promise<Libp2p> {
    if (sharedNode) return sharedNode;

    sharedNode = await createLibp2p({
        addresses: { listen: ["/p2p-circuit", "/webrtc"] },
        transports: [
        webSockets({ filter: filters.all }),
        webRTC(),
        circuitRelayTransport(),
        ],
        connectionEncrypters: [noise()],
        streamMuxers: [yamux()],
        services: {
        pubsub: gossipsub({
            allowPublishToZeroPeers: true,
            emitSelf: false,
            canRelayMessage: true,
        }),
        identify: identify(),
        dcutr: dcutr(),
        },
    });

    try {
        await sharedNode.dial(multiaddr(DEFAULT_RELAY));
        console.log("[sharedNode] Connected to relay:", DEFAULT_RELAY);
    } catch (e) {
        console.warn("[sharedNode] Relay dial failed:", e);
    }

    return sharedNode;
}