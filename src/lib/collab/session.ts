import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { yCollab } from "y-codemirror.next";
import { Compartment, StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { Libp2pProvider } from "./libp2pProvider";
import type { Libp2p } from "libp2p";

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

  // Set local awareness so it actually gets broadcast
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

  setTimeout(async () => {
    const ELECTION_EXTRA_WAIT_MS = 500;

    if (ytext.length > 0 || receivedRemote) return;

    await new Promise(r => setTimeout(r, ELECTION_EXTRA_WAIT_MS));
    if (ytext.length > 0 || receivedRemote) return;

    const states = awareness.getStates();
    const selfId = awareness.clientID;
    const ids = Array.from(states.keys());

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

export async function startCollaborativeSessionWithNode(
  opts: StartOpts & { node: Libp2p; isInitiator?: boolean }
): Promise<CollabSession> {
  const { editor, topic, relayAddr, userInfo, onPeersChanged, onStatus, node, isInitiator } = opts;
  onStatus?.("Connecting...");
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText("codemirror");
  const awareness = new Awareness(ydoc);

  // Reuse the existing libp2p node
  const provider = new Libp2pProvider(ydoc, node, topic, awareness);
  await provider.start();

  awareness.setLocalState({ user: userInfo ?? {}, selection: null });

  let receivedRemote = false;
  const onYUpdate = (_u: Uint8Array, origin: any) => { if (origin === provider) receivedRemote = true; };
  ydoc.on("update", onYUpdate);

  awareness.on("update", () => onPeersChanged?.(provider.getPeerNames()));
  onStatus?.("Connected");

  const initialContent = editor.state.doc.toString();
  if (isInitiator) {
    // Initiator peer: share your editor content
    ydoc.transact(() => {
      if (ytext.length === 0 && initialContent.length > 0) {
        ytext.insert(0, initialContent);
      }
    }, "seed");
  } else {
    // Joining peer: clear editor and wait for sync
    if (initialContent.length > 0) {
      editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: "" } });
    }
  }

  const undoManager = new Y.UndoManager(ytext);
  const compartment = new Compartment();
  editor.dispatch({
    effects: StateEffect.appendConfig.of([compartment.of([yCollab(ytext, awareness, { undoManager })])]),
  });

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