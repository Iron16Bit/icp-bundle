import { getSharedLibp2p } from "./sharedNode";
import { fromString, toString } from "uint8arrays";

type DiscoMsg =
    | { type: "disco-presence"; id: string; name: string }
    | { type: "disco-invite"; to: string; from: string; topic: string; name: string };

export class DiscoveryClient {
    private topic: string;
    private node: any = null;
    private name = "";
    private id = "";
    private onPeersCb: (peers: { id: string; name: string }[]) => void = () => {};
    private onInviteCb: (from: { id: string; name: string }, topic: string) => void = () => {};
    private peers = new Map<string, string>();
    private presenceTimer: any = null;

    private queue: Uint8Array[] = [];
    private onSubChange = (ev: any) => {
        const { subscriptions } = ev.detail ?? {};
        const sub = subscriptions?.find((s: any) => s.topic === this.topic && s.subscribe === true);
        if (sub) {
        this.flushQueue();t
        this.announcePresence().catch(() => {});
        }
    };

    constructor(topic: string) {
        this.topic = topic || "icp.disco.v1";
    }

    private onMessage = (ev: any) => {
        const { topic, data } = ev.detail ?? {};
        if (topic !== this.topic) return;
        try {
        const msg = JSON.parse(toString(data)) as DiscoMsg;
        if (msg.type === "disco-presence") {
            if (msg.id === this.id) return;
            this.peers.set(msg.id, msg.name);
            this.onPeersCb(this.getPeers());
        } else if (msg.type === "disco-invite") {
            if (msg.to !== this.id) return;
            this.onInviteCb({ id: msg.from, name: msg.name }, msg.topic);
        }
        } catch {}
    };

    async start(
        name: string,
        onPeers: (p: { id: string; name: string }[]) => void,
        onInvite: (from: { id: string; name: string }, topic: string) => void
    ) {
        this.node = await getSharedLibp2p();
        this.name = name;
        this.id = this.node.peerId.toString();
        this.onPeersCb = onPeers;
        this.onInviteCb = onInvite;

        await this.node.services.pubsub.subscribe(this.topic);
        this.node.services.pubsub.addEventListener("message", this.onMessage);
        this.node.services.pubsub.addEventListener("subscription-change", this.onSubChange);

        setTimeout(() => this.announcePresence().catch(() => {}), 300);
        this.presenceTimer = setInterval(() => this.announcePresence().catch(() => {}), 5000);
    }

    stop() {
        if (!this.node) return;
        clearInterval(this.presenceTimer);
        this.node.services.pubsub.removeEventListener("message", this.onMessage);
        this.node.services.pubsub.removeEventListener("subscription-change", this.onSubChange);
        this.node.services.pubsub.unsubscribe(this.topic);
        this.queue = [];
        this.peers.clear();
    }

    getPeers() {
        return Array.from(this.peers.entries()).map(([id, name]) => ({ id, name }));
    }

    async invite(targetPeerId: string, topic: string) {
        const msg: DiscoMsg = { type: "disco-invite", to: targetPeerId, from: this.id, topic, name: this.name };
        await this.publishSafe(msg);
    }

    private async publishSafe(msg: DiscoMsg): Promise<boolean> {
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
        if (!this.queue.length) return;
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

    private async publish(msg: DiscoMsg) {
        await this.publishSafe(msg);
    }

    private async announcePresence() {
        await this.publishSafe({ type: "disco-presence", id: this.id, name: this.name });
    }
}