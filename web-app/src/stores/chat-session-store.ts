/* eslint-disable @typescript-eslint/no-explicit-any */
import { create } from "zustand";
import type { Chat, UIMessage } from "@ai-sdk/react";
import type { ChatStatus } from "ai";
import { CustomChatTransport } from "@/lib/custom-chat-transport";
import { notifyThreadCompleted } from "@/lib/notifications";
import { useThreadNotifications } from "@/hooks/useThreadNotifications";
import { useThreadReadStatus } from "@/stores/thread-read-store";
import i18n from "@/i18n/setup";

export type SessionData = {
  tools: any[];
  pendingToolBatches: Set<symbol>;
  toolCallAbortController: AbortController | null;
  messages: UIMessage[];
  idMap: Map<string, string>;
};

export type ChatSession = {
  chat: Chat<UIMessage>;
  transport: CustomChatTransport;
  status: ChatStatus;
  title?: string;
  isStreaming: boolean;
  unsubscribers: Array<() => void>;
  data: SessionData;
};

interface ChatSessionState {
  sessions: Record<string, ChatSession>;
  activeConversationId?: string;
  setActiveConversationId: (conversationId?: string) => void;
  ensureSession: (
    sessionId: string,
    transport: CustomChatTransport,
    createChat: () => Chat<UIMessage>,
    title?: string,
  ) => Chat<UIMessage>;
  getSessionData: (sessionId: string) => SessionData;
  claimToolBatch: (sessionId: string) => { id: symbol; calls: SessionData["tools"] } | null;
  endToolBatch: (sessionId: string, batchId: symbol) => void;
  clearToolBatches: (sessionId: string) => void;
  getToolCallController: (sessionId: string) => AbortController;
  abortToolCalls: (sessionId: string) => void;
  upsertMessage: (sessionId: string, message: UIMessage) => void;
  updateStatus: (sessionId: string, status: ChatStatus) => void;
  setSessionTitle: (sessionId: string, title?: string) => void;
  removeSession: (sessionId: string) => void;
  clearSessions: () => void;
}

const STREAMING_STATUSES: ChatStatus[] = [
  'submitted',
  'streaming',
];

// Pure helper function for checking if a session is busy (for reactive use in components)
export function isSessionBusy(session: ChatSession | undefined): boolean {
  return session?.isStreaming || (session?.data?.tools?.length ?? 0) > 0 ||
    (session?.data?.pendingToolBatches.size ?? 0) > 0;
}

const createSessionData = (): SessionData => ({
  tools: [],
  pendingToolBatches: new Set(),
  toolCallAbortController: null,
  messages: [],
  idMap: new Map<string, string>(),
});

// Standalone data store for sessions that don't have a Chat yet
const standaloneData: Record<string, SessionData> = {};

export const useChatSessions = create<ChatSessionState>((set, get) => ({
  sessions: {},
  activeConversationId: undefined,
  setActiveConversationId: (conversationId) =>
    set({ activeConversationId: conversationId }),
  ensureSession: (sessionId, transport, createChat, title) => {
    // Set active immediately - prevents toast for this session during status sync
    // Only update activeConversationId if it changed (avoid unnecessary state updates during render)
    if (get().activeConversationId !== sessionId) {
      set({ activeConversationId: sessionId });
    }

    const existing = get().sessions[sessionId];
    if (existing) {
      // Keep transport and title in sync if they changed
      if (existing.transport !== transport || existing.title !== title) {
        set((state) => ({
          sessions: {
            ...state.sessions,
            [sessionId]: {
              ...existing,
              transport,
              title: title ?? existing.title,
            },
          },
        }));
      }
      return existing.chat;
    }

    const chat = createChat();
    const syncStatus = () => {
      get().updateStatus(sessionId, chat.status);
    };
    const unsubscribeStatus = chat["~registerStatusCallback"]
      ? chat["~registerStatusCallback"](syncStatus)
      : undefined;

    // Use existing standalone data if available, otherwise create new
    const data = standaloneData[sessionId] ?? createSessionData();
    delete standaloneData[sessionId]; // Move to session

    const newSession: ChatSession = {
      chat,
      transport,
      status: chat.status,
      title,
      isStreaming: STREAMING_STATUSES.includes(chat.status),
      unsubscribers: unsubscribeStatus ? [unsubscribeStatus] : [],
      data,
    };

    set((state) => ({
      sessions: {
        ...state.sessions,
        [sessionId]: newSession,
      },
    }));

    return chat;
  },
  getSessionData: (sessionId) => {
    const existing = get().sessions[sessionId];
    if (existing) {
      return existing.data;
    }
    // Return or create standalone data for sessions without a Chat yet
    if (!standaloneData[sessionId]) {
      standaloneData[sessionId] = createSessionData();
    }
    return standaloneData[sessionId];
  },
  claimToolBatch: (sessionId) => {
    let batch: { id: symbol; calls: SessionData["tools"] } | null = null;
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session) return state;
      const calls = session.data.tools.splice(0);
      if (calls.length === 0) return state;
      const id = Symbol('chat-tool-batch');
      batch = { id, calls };
      session.data.pendingToolBatches.add(id);
      return { sessions: { ...state.sessions, [sessionId]: { ...session } } };
    });
    return batch;
  },
  endToolBatch: (sessionId, batchId) => {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session || !session.data.pendingToolBatches.delete(batchId)) return state;
      return { sessions: { ...state.sessions, [sessionId]: { ...session } } };
    });
  },
  clearToolBatches: (sessionId) => {
    set((state) => {
      const session = state.sessions[sessionId];
      if (!session || session.data.pendingToolBatches.size === 0) return state;
      session.data.pendingToolBatches.clear();
      return { sessions: { ...state.sessions, [sessionId]: { ...session } } };
    });
  },
  getToolCallController: (sessionId) => {
    const data = get().getSessionData(sessionId);
    if (!data.toolCallAbortController) {
      data.toolCallAbortController = new AbortController();
    }
    return data.toolCallAbortController;
  },
  abortToolCalls: (sessionId) => {
    const data = get().getSessionData(sessionId);
    data.toolCallAbortController?.abort();
    data.toolCallAbortController = null;
  },
  upsertMessage: (sessionId, message) => {
    const existing = get().sessions[sessionId];
    if (!existing) return;

    existing.chat.messages = [
      ...existing.chat.messages.filter((item) => item.id !== message.id),
      message,
    ];
  },
  updateStatus: (sessionId, status) => {
    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing) {
        return state;
      }

      const wasStreaming = existing.isStreaming;
      const isStreaming = STREAMING_STATUSES.includes(status);
      if (existing.status === status && wasStreaming === isStreaming) {
        return state;
      }

      // Fire an OS notification when a thread finishes generating, controlled
      // solely by the global Desktop notifications switch. Suppressed while
      // the user is actively looking at this conversation in a focused window.
      const justFinished = wasStreaming && !isStreaming;
      if (justFinished) {
        const hasMessages = existing.chat.messages.length > 0;
        const hasPendingTools = existing.data.tools.length > 0 ||
          existing.data.pendingToolBatches.size > 0;
        const hasDocument = typeof document !== "undefined";
        const isVisible = hasDocument
          ? document.visibilityState === "visible"
          : true;
        // On macOS a background Tauri window stays "visible"; use hasFocus()
        // to detect the user switching to another app.
        const hasFocus = hasDocument
          ? typeof document.hasFocus === "function"
            ? document.hasFocus()
            : true
          : true;
        const notFocusedHere =
          !isVisible || !hasFocus || state.activeConversationId !== sessionId;
        // Treat undefined (pre-feature or lost during rehydration) as ON, so
        // the master switch only suppresses notifications when explicitly OFF.
        const globallyEnabled =
          useThreadNotifications.getState().globallyEnabled !== false;

        if (
          globallyEnabled &&
          hasMessages &&
          !hasPendingTools &&
          notFocusedHere
        ) {
          const threadTitle = existing.title ?? "";
          const notificationTitle = i18n.t(
            "settings:threadNotifications.notificationTitle"
          );
          const notificationBody = i18n.t(
            "settings:threadNotifications.notificationBody",
            { title: threadTitle }
          );
          void notifyThreadCompleted(notificationTitle, notificationBody);
        }

        if (
          hasMessages &&
          !hasPendingTools &&
          state.activeConversationId !== sessionId
        ) {
          useThreadReadStatus.getState().markUnread(sessionId);
        }
      }

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: {
            ...existing,
            status,
            isStreaming,
          },
        },
      };
    });
  },
  setSessionTitle: (sessionId, title) => {
    if (!title) return;

    set((state) => {
      const existing = state.sessions[sessionId];
      if (!existing || existing.title === title) {
        return state;
      }

      return {
        sessions: {
          ...state.sessions,
          [sessionId]: { ...existing, title },
        },
      };
    });
  },
  removeSession: (sessionId) => {
    const existing = get().sessions[sessionId];
    if (!existing) {
      delete standaloneData[sessionId];
      return;
    }

    // Remove from store FIRST - prevents updateStatus from showing toast during cleanup
    set((state) => {
      if (!state.sessions[sessionId]) {
        return state;
      }
      const rest = { ...state.sessions };
      delete rest[sessionId];
      return { sessions: rest };
    });

    // Then cleanup (existing is a copy, safe to use after removal)
    existing.data.toolCallAbortController?.abort();
    existing.data.toolCallAbortController = null;
    existing.data.pendingToolBatches.clear();
    existing.unsubscribers.forEach((unsubscribe) => {
      try {
        unsubscribe();
      } catch (error) {
        console.error("Failed to unsubscribe chat session listener", error);
      }
    });
    try {
      existing.chat.stop();
    } catch (error) {
      console.error("Failed to stop chat session", error);
    }

    delete standaloneData[sessionId];
  },
  clearSessions: () => {
    const sessions = get().sessions;
    Object.values(sessions).forEach((session) => {
      session.data.toolCallAbortController?.abort();
      session.data.toolCallAbortController = null;
      session.data.pendingToolBatches.clear();
      session.unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          console.error("Failed to unsubscribe chat session listener", error);
        }
      });
      try {
        session.chat.stop();
      } catch (error) {
        console.error("Failed to stop chat session", error);
      }
    });

    // Clear standalone data
    Object.keys(standaloneData).forEach((key) => {
      delete standaloneData[key];
    });

    set({ sessions: {}, activeConversationId: undefined });
  },
}));
