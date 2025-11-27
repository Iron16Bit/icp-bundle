import { getSharedLibp2p } from "./sharedNode";
import { fromString, toString } from "uint8arrays";
import { multiaddr } from "@multiformats/multiaddr";
import type { Libp2p } from "libp2p";

type DiscoMsg =
    | { type: "disco-presence"; id: string; name: string }
    | { type: "disco-invite"; to: string; from: string; topic: string; name: string }
    | { type: "disco-left"; id: string }
    | { type: "relay-discovery"; peers: Array<{ peerId: string; multiaddrs?: string[] }> };

export class DiscoveryClient {
    private topic: string;
    private node: Libp2p | null = null;
    private name = "";
    private id = "";
    public onPeerDiscovered: ((peer: { id: string; name: string }) => void) | null = null;
    public onInviteReceived: ((invite: { from: { id: string; name: string }; topic: string }) => void) | null = null;
    private onPeersCb: (peers: { id: string; name: string }[]) => void = () => {};
    private onInviteCb: (from: { id: string; name: string }, topic: string) => void = () => {};
    private peers = new Map<string, string>();
    private presenceTimer: any = null;

    private queue: Uint8Array[] = [];
    private onSubChange = (ev: any) => {
        const { subscriptions } = ev.detail ?? {};
        const sub = subscriptions?.find((s: any) => s.topic === this.topic && s.subscribe === true);
        if (sub) {
            this.flushQueue();
            this.announcePresence().catch(() => {});
        }
    };

    constructor(node: Libp2p, topic: string) {
        this.node = node;
        this.topic = topic;
        console.log(`[Discovery] Created with topic: ${topic}`);
    }

    private onMessage = async (ev: any) => {
        const { topic, data } = ev.detail ?? {};
        if (topic !== this.topic) return;
        try {
            const msg = JSON.parse(toString(data)) as DiscoMsg;
            
            if (msg.type === "relay-discovery") {
                console.log(`[Discovery] Received relay discovery with ${msg.peers?.length || 0} peers`);
                
                if (!msg.peers || !Array.isArray(msg.peers)) {
                    console.warn('[Discovery] Invalid relay discovery format');
                    return;
                }
                
                // Dial each peer through the circuit relay
                for (const peer of msg.peers) {
                    if (!peer.peerId || peer.peerId === this.id) continue;
                    
                    console.log(`[Discovery] Attempting to dial peer ${peer.peerId.slice(0, 8)}`);
                    
                    // Check if already connected
                    const connections = this.node!.getConnections().filter(
                        conn => conn.remotePeer.toString() === peer.peerId
                    );
                    
                    if (connections.length > 0) {
                        console.log(`[Discovery] Already connected to ${peer.peerId.slice(0, 8)}`);
                        continue;
                    }
                    
                    // Try to dial using circuit relay address
                    if (peer.multiaddrs && peer.multiaddrs.length > 0) {
                        try {
                            const addr = multiaddr(peer.multiaddrs[0]);
                            await this.node!.dial(addr);
                            console.log(`[Discovery] Connected to peer ${peer.peerId.slice(0, 8)}`);
                        } catch (err) {
                            console.warn(`[Discovery] Failed to dial ${peer.peerId.slice(0, 8)}:`, err);
                        }
                    }
                }
                return;
            }
            
            if (msg.type === "disco-presence") {
                if (msg.id === this.id) return;
                this.peers.set(msg.id, msg.name);
                
                if (this.onPeersCb) {
                    this.onPeersCb(this.getPeers());
                }
                
                if (this.onPeerDiscovered) {
                    this.onPeerDiscovered({ id: msg.id, name: msg.name });
                }
            } else if (msg.type === "disco-invite") {
                if (msg.to !== this.id) return;
                const invite = { from: { id: msg.from, name: msg.name }, topic: msg.topic };
                
                if (this.onInviteCb) {
                    this.onInviteCb({ id: msg.from, name: msg.name }, msg.topic);
                }
                
                if (this.onInviteReceived) {
                    this.onInviteReceived(invite);
                }
            } else if (msg.type === "disco-left") {
                // Remove peer who explicitly left discovery
                if (msg.id && this.peers.has(msg.id)) {
                    this.peers.delete(msg.id);
                    if (this.onPeersCb) {
                        this.onPeersCb(this.getPeers());
                    }
                }
            }
        } catch (err) {
            console.error('[Discovery] Error processing message:', err);
        }
    };

    async start(
        name: string,
        onPeers: (p: { id: string; name: string }[]) => void,
        onInvite: (from: { id: string; name: string }, topic: string) => void
    ) {
        if (!this.node) {
            this.node = await getSharedLibp2p();
        }
        this.name = name;
        this.id = this.node.peerId.toString();
        this.onPeersCb = onPeers;
        this.onInviteCb = onInvite;

        console.log(`[Discovery] Subscribing to topic: ${this.topic}`);
        await this.node.services.pubsub.subscribe(this.topic);
        this.node.services.pubsub.addEventListener("message", this.onMessage);
        this.node.services.pubsub.addEventListener("subscription-change", this.onSubChange);

        setTimeout(() => this.announcePresence().catch(() => {}), 300);
        this.presenceTimer = setInterval(() => this.announcePresence().catch(() => {}), 5000);
    }

    // Stop discovery and announce we are leaving so other peers remove us
    async stop() {
        if (!this.node) return;
        clearInterval(this.presenceTimer);
        try {
            await this.publishSafe({ type: "disco-left", id: this.id });
        } catch (e) {
            // Ignore
        }
        this.node.services.pubsub.removeEventListener("message", this.onMessage);
        this.node.services.pubsub.removeEventListener("subscription-change", this.onSubChange);
        try {
            await this.node.services.pubsub.unsubscribe(this.topic);
        } catch (e) {
            // Ignore unsubscribe errors
        }
        this.queue = [];
        this.peers.clear();
        this.onPeersCb(this.getPeers());
    }

    getPeers() {
        return Array.from(this.peers.entries()).map(([id, name]) => ({ id, name }));
    }

    async invite(targetPeerId: string, topic: string) {
        const msg: DiscoMsg = { type: "disco-invite", to: targetPeerId, from: this.id, topic, name: this.name };
        await this.publishSafe(msg);
    }

    private async publishSafe(msg: DiscoMsg): Promise<boolean> {
        if (!this.node) return false;
        const encoded = fromString(JSON.stringify(msg));
        try {
            await this.node.services.pubsub.publish(this.topic, encoded);
            return true;
        } catch (e: any) {
            const noPeers =
                typeof e?.message === "string" &&
                (e.message.includes("NoPeersSubscribedToTopic") || e.message.includes("PublishError.NoPeersSubscribedToTopic"));
            if (noPeers) {
                this.queue.push(encoded);
                return false;
            }
            throw e;
        }
    }

    private async flushQueue() {
        if (!this.node || !this.queue.length) return;
        try {
            const subs = this.node.services.pubsub.getSubscribers(this.topic) || [];
            if (subs.length === 0) return;
        } catch {
            return;
        }
        const pending = this.queue.splice(0, this.queue.length);
        for (const payload of pending) {
            try {
                await this.node.services.pubsub.publish(this.topic, payload);
            } catch (e: any) {
                const noPeers =
                    typeof e?.message === "string" &&
                    (e.message.includes("NoPeersSubscribedToTopic") || e.message.includes("PublishError.NoPeersSubscribedToTopic"));
                if (noPeers) {
                    this.queue.push(payload);
                    break;
                }
            }
        }
    }

    private async announcePresence() {
        await this.publishSafe({ type: "disco-presence", id: this.id, name: this.name });
    }

    static async create(
        discoveryTopic: string,
        relayAddr?: string
    ): Promise<DiscoveryClient> {
        console.log(`[Discovery] Creating client for topic: ${discoveryTopic}`);
        const node = await getSharedLibp2p();
        return new DiscoveryClient(node, discoveryTopic);
    }
}