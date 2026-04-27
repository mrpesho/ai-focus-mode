/// <reference types="vite/client" />

// Chrome extension APIs used directly (offscreen + background bypass polyfill)
declare namespace chrome {
  namespace offscreen {
    function createDocument(params: {
      url: string;
      reasons: string[];
      justification: string;
    }): Promise<void>;
  }

  namespace runtime {
    interface MessageSender {
      tab?: { id?: number };
      id?: string;
    }

    interface Port {
      name: string;
      postMessage(message: unknown): void;
      onMessage: {
        addListener(callback: (message: any) => void): void;
      };
      onDisconnect: {
        addListener(callback: () => void): void;
      };
      disconnect(): void;
    }

    function connect(info: { name: string }): Port;

    function getContexts(filter: {
      contextTypes: string[];
    }): Promise<Array<{ contextType: string }>>;

    const onConnect: {
      addListener(callback: (port: Port) => void): void;
    };

    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void,
        ) => boolean | void,
      ): void;
    };
  }

  namespace storage {
    const local: {
      set(items: Record<string, unknown>): Promise<void>;
    };
  }
}
