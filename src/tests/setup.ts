/**
 * Test setup: mock Chrome extension APIs not available in happy-dom
 */

// Minimal chrome.storage.local mock
const store: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    local: {
      get: vi.fn(async (keys: string | string[] | null) => {
        if (keys === null) return { ...store };
        const keyList = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(keyList.map(k => [k, store[k]]));
      }),
      set: vi.fn(async (items: Record<string, unknown>) => {
        Object.assign(store, items);
      }),
      remove: vi.fn(async (keys: string | string[]) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        keyList.forEach(k => delete store[k]);
      }),
      clear: vi.fn(async () => {
        Object.keys(store).forEach(k => delete store[k]);
      }),
    },
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn(),
      removeListener: vi.fn(),
    },
  },
};

// Reset store between tests
beforeEach(() => {
  Object.keys(store).forEach(k => delete store[k]);
  vi.clearAllMocks();

  // Re-register get/set/remove/clear pointing at same fresh store
  chromeMock.storage.local.get.mockImplementation(async (keys: string | string[] | null) => {
    if (keys === null) return { ...store };
    const keyList = Array.isArray(keys) ? keys : [keys];
    return Object.fromEntries(keyList.map(k => [k, store[k]]));
  });
  chromeMock.storage.local.set.mockImplementation(async (items: Record<string, unknown>) => {
    Object.assign(store, items);
  });
  chromeMock.storage.local.remove.mockImplementation(async (keys: string | string[]) => {
    const keyList = Array.isArray(keys) ? keys : [keys];
    keyList.forEach(k => delete store[k]);
  });
  chromeMock.storage.local.clear.mockImplementation(async () => {
    Object.keys(store).forEach(k => delete store[k]);
  });
});

Object.defineProperty(globalThis, 'chrome', {
  value: chromeMock,
  writable: true,
});
