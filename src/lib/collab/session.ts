import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { yCollab } from "y-codemirror.next";
import { Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Libp2pProvider } from "./libp2pProvider";

export type CollabSession = {
  end: () => Promise<void>;
  getPeers: () => string[];
  getLibp2p: () => any;
};

type StartOpts = {
  editor: EditorView;
  topic: string;
  relayAddr?: string;
  userInfo?: { name?: string; color?: string };
  onPeersChanged?: (peerNames: string[]) => void;
  onStatus?: (s: string) => void;
};

export async function startCollaborativeSession(opts: StartOpts): Promise<CollabSession> {
  const { editor, topic, relayAddr, userInfo, onPeersChanged, onStatus } = opts;

  onStatus?.("Connecting...");

  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("codemirror");
  const awareness = new Awareness(ydoc);

  const provider = await Libp2pProvider.create(ydoc, topic, relayAddr);
  await provider.start();

  const localUser = {
    name: userInfo?.name || `User-${Math.floor(Math.random() * 1000)}`,
    color: userInfo?.color || randomColor(),
  };
  provider.awareness.setLocalStateField("user", localUser);

  const awarenessListener = () => {
    const states = Array.from(provider.awareness.getStates().values()) as any[];
    const names = states
      .map((s) => s?.user?.name)
      .filter(Boolean);

    // Log detailed awareness info
    if (names.length > 0) {
      console.log(`Collaborators: ${names.length} peer(s) connected`);
      states.forEach((state: any, index) => {
        if (state?.user) {
          console.log(`- Peer: ${state.user.name} (${state.user.color})`);
        }
      });
    }

    onPeersChanged?.(names);
  };
  provider.awareness.on("change", awarenessListener);
  awarenessListener();

  // Seed initial content with awareness-based tie-breaker
  setTimeout(() => {
    const states = provider.awareness.getStates();
    const selfId = provider.awareness.clientID;
    const ids = Array.from(states.keys());
    const others = ids.filter((id) => id !== selfId);
    const shouldSeed = others.length === 0 || selfId === Math.min(...ids);

    if (shouldSeed && ytext.length === 0) {
      const current = editor.state.doc.toString();
      if (current) {
        ydoc.transact(() => {
          ytext.insert(0, current);
        });
        console.log("Seeded initial editor content");
      }
    } else {
      console.log("Skipping seed (another peer will/has seeded)");
    }
  }, 400);

  // Bind Yjs to CodeMirror editor
  const collabCompartment = new Compartment();
  editor.dispatch({
    effects: StateEffect.appendConfig.of(
      collabCompartment.of([
        yCollab(ytext, provider.awareness, { undoManager: undefined }),
        EditorView.editable.of(true),
      ])
    ),
  });

  // Log successful connection
  console.log(`Connected to collaborative session on topic: ${topic}`);
  onStatus?.("Connected");

  return {
    async end() {
      editor.dispatch({ effects: collabCompartment.reconfigure([]) });
      provider.awareness.off("change", awarenessListener);
      try {
        await provider.destroy();
      } catch {}
      try {
        ydoc.destroy();
      } catch {}
      onStatus?.("Ended");
    },
    getPeers() {
      const states = Array.from(provider.awareness.getStates().values()) as any[];
      return states.map((s) => s?.user?.name).filter(Boolean);
    },
    getLibp2p() {
      return provider.libp2p;
    },
  };
}

function randomColor() {
  return `#${Math.floor(Math.random() * 0xffffff)
    .toString(16)
    .padStart(6, "0")}`;
}