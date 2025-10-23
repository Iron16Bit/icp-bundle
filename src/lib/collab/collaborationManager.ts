import * as Y from "yjs";
import { EditorView } from "@codemirror/view";
import { Compartment, StateEffect } from "@codemirror/state";
import { yCollab } from "y-codemirror.next";
import { CollabSession } from "./session";
import { startCollaborativeSession } from "./session";

export class CollaborationManager {
  private ydoc: Y.Doc | null = null;
  private ytext: Y.Text | null = null;
  private session: CollabSession | null = null;
  private collabCompartment = new Compartment();
  private editor: EditorView | null = null;
  private isCollaborating = false;

  constructor() {}

  /**
   * Start collaboration on an editor
   */
  async startCollaboration(editor: EditorView, topic: string, userInfo?: {name?: string, color?: string}) {
    if (this.isCollaborating) return;
    
    this.editor = editor;
    
    try {
      // Start the collaborative session
      this.session = await startCollaborativeSession({
        editor,
        topic,
        userInfo,
        onPeersChanged: (peers) => {
          console.log("Connected peers:", peers);
        },
        onStatus: (status) => {
          console.log("Collaboration status:", status);
        }
      });
      
      this.isCollaborating = true;
      console.log("Collaboration started on topic:", topic);
      return true;
    } catch (error) {
      console.error("Failed to start collaboration:", error);
      this.stopCollaboration();
      return false;
    }
  }

  /**
   * Stop collaboration
   */
  async stopCollaboration() {
    if (!this.isCollaborating || !this.session) return;

    try {
      await this.session.end();
      this.isCollaborating = false;
      console.log("Collaboration stopped");
      return true;
    } catch (error) {
      console.error("Error stopping collaboration:", error);
      return false;
    } finally {
      this.session = null;
    }
  }

  /**
   * Get the current collaboration status
   */
  getStatus() {
    return {
      isCollaborating: this.isCollaborating,
      peers: this.isCollaborating ? this.session?.getPeers() || [] : []
    };
  }
}

export const collaborationManager = new CollaborationManager();