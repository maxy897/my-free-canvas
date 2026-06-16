import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";

const store = localforage.createInstance({
  name: "free-canvas",
  storeName: "canvas_state",
});

const WRITE_DEBOUNCE_MS = 500;
const pendingValues = new Map<string, string>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function writeItem(name: string, value: string) {
  try {
    await store.setItem(name, value);
  } catch {
    window.localStorage.setItem(name, value);
  }
}

function scheduleWrite(name: string, value: string) {
  pendingValues.set(name, value);

  const existingTimer = pendingTimers.get(name);
  if (existingTimer) clearTimeout(existingTimer);

  pendingTimers.set(
    name,
    setTimeout(() => {
      const pendingValue = pendingValues.get(name);
      pendingValues.delete(name);
      pendingTimers.delete(name);
      if (pendingValue !== undefined) {
        void writeItem(name, pendingValue);
      }
    }, WRITE_DEBOUNCE_MS)
  );
}

export const localForageStorage: StateStorage = {
  getItem: async (name) => {
    if (typeof window === "undefined") return null;
    try {
      return (await store.getItem<string>(name)) || null;
    } catch {
      return window.localStorage.getItem(name);
    }
  },
  setItem: async (name, value) => {
    if (typeof window === "undefined") return;
    scheduleWrite(name, value);
  },
  removeItem: async (name) => {
    if (typeof window === "undefined") return;
    const existingTimer = pendingTimers.get(name);
    if (existingTimer) clearTimeout(existingTimer);
    pendingTimers.delete(name);
    pendingValues.delete(name);

    try {
      await store.removeItem(name);
    } catch {
      window.localStorage.removeItem(name);
    }
  },
};
