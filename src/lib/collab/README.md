# P2P Collaborative Editing

## Dependencies

- [libp2p](https://libp2p.io/): provides P2P communication;
- [Yjs](https://github.com/yjs/y-codemirror): takes care of editors synchronization for collaboration.

## File Structure

- `components/CollaborateButton.svelte`: the main UI component that users interact with to start/join/leave collaboration sessions. Once the user clicks the collaborate button a discovery topic is created, discovery is started and peers in the same topic can see eachother and start collaborating together;
- `session.ts`: initializes the collaborative editing session. It creates a Yjs document with libp2p as provider for its synchronization. The document is then bound to the CodeMirror editor to enable collaboration inside the editor;
- `collaborationManager.ts`: manages the collaborative session by starting it, ensuring only one is active at the same time and stops it;
- `discovery.ts`: handles the discovery, including the creation of a discovery client on a specific topic, presence announcement on that topic and invite sending for collaboration;
- `sharedNote.ts`: where the libp2p node is created. It is a "shared" node because the same one will be used for all editors (**NOTE:** there can only be one active collaborative session at the same time);

## Collaboration Flow

1. A user clicks the collaborate button: a discovery client is created and used to announce the user's presence on the discovery topic;
2. When a user decides to connect to another user, an invite is sent with a secret topic. If the other peer accepts, they switch to the new secret topic for collaboration;
   - The peer that **sent** the invite will share its editor content with the other peer.
3. The 2 peers are now editing together. Their editors are synchronized through Yjs using the created libp2p node as provider for the communication; 
4. When a user leaves the session, the content of the editor remains the one modified during the collaboration for both users. A user can now start a new collaboration.