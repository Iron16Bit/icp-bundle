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

  // Create provider with libp2p and start it first
  const provider = await Libp2pProvider.create(ydoc, topic, relayAddr, awareness);
  await provider.start();

  // Now set local awareness so it actually gets broadcast
  awareness.setLocalState({
    user: userInfo ?? {},
    selection: null,
  });

  // Track if we received any remote Y updates (to avoid local seeding)
  let receivedRemote = false;
  const onYUpdate = (_u: Uint8Array, origin: any) => {
    if (origin === provider) receivedRemote = true;
  };
  ydoc.on("update", onYUpdate);

  // Optional: notify peers changed when awareness updates
  awareness.on("update", () => {
    onPeersChanged?.(provider.getPeerNames());
  });
  onStatus?.("Connected");

  // Capture initial content, then clear the CM doc before binding yCollab
  const initialContent = editor.state.doc.toString();
  if (initialContent.length > 0) {
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: "" }
    });
  }

  // Proper UndoManager
  const undoManager = new Y.UndoManager(ytext);

  // Attach yCollab
  const compartment = new Compartment();
  editor.dispatch({
    effects: StateEffect.appendConfig.of([
      compartment.of([
        yCollab(ytext, awareness, { undoManager })
      ])
    ])
  });

  // Seed only if:
  // - We didn’t receive remote state
  // - The shared text is still empty
  // - After a stabilization window we’re either alone or the elected leader
  setTimeout(async () => {
    // Longer grace period to collect awareness/presence from others
    const ELECTION_EXTRA_WAIT_MS = 500;

    if (ytext.length > 0 || receivedRemote) return;

    // Allow more time for any in-flight sync
    await new Promise(r => setTimeout(r, ELECTION_EXTRA_WAIT_MS));
    if (ytext.length > 0 || receivedRemote) return;

    const states = awareness.getStates();
    const selfId = awareness.clientID;
    const ids = Array.from(states.keys());

    // Compute “alone” and “leader” after stabilization
    const others = ids.filter((id) => id !== selfId);
    const alone = (others.length === 0) && (provider?.hasPeers === false);
    const leader = ids.length === 0 || selfId === Math.min(...ids);

    if (!(alone || leader)) return;

    ydoc.transact(() => {
      if (ytext.length === 0) {
        ytext.insert(0, initialContent);
      }
    }, "seed");
  }, 2500);

  return {
    end: async () => {
      editor.dispatch({ effects: StateEffect.reconfigure.of([]) });
      ydoc.off("update", onYUpdate);
      await provider?.destroy?.();
      undoManager.destroy();
      ydoc.destroy();
    },
    getPeers: () => provider?.getPeerNames?.() ?? [],
    getLibp2p: () => provider?.getLibp2p?.(),
  };
}