/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick, defineComponent, createApp } from 'vue';
import { webcrypto } from 'node:crypto';
import { SmartStorage } from './index.js';
import { useSmartStorage, useSecureStorage } from './vue.js';

function mountHook(hookFn) {
  let result;
  const App = defineComponent({
    setup() {
      result = hookFn();
      return () => {};
    },
  });
  const app = createApp(App);
  const el = document.createElement('div');
  app.mount(el);
  return { result, app };
}

describe('useSmartStorage Vue Composable', () => {
  let storage;

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('crypto', webcrypto);
    storage = new SmartStorage({ prefix: 'test', crossTabSync: true });
  });

  afterEach(() => {
    storage.dispose();
    vi.unstubAllGlobals();
  });

  it('should initialize with fallback if storage is empty', () => {
    const { result, app } = mountHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );
    const [theme] = result;
    expect(theme.value).toBe('light');
    app.unmount();
  });

  it('should initialize with stored value after hydration', async () => {
    storage.set('theme', 'dark');
    const { result, app } = mountHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );
    const [theme] = result;

    // Vue's app.mount() synchronously flushes onMounted hooks.
    // Therefore, hydration update will already be reflected here.
    expect(theme.value).toBe('dark');
    app.unmount();
  });

  it('should update storage when ref is mutated', async () => {
    const { result, app } = mountHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );
    const [theme] = result;
    theme.value = 'dark';
    await nextTick(); // Wait for Vue's watch to trigger
    expect(storage.get('theme')).toBe('dark');
    app.unmount();
  });

  it('should remove value from storage and reset to fallback when remove is called', async () => {
    storage.set('theme', 'dark');
    const { result, app } = mountHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );
    const [theme, remove, getKeys] = result;

    await nextTick(); // wait for mount to finish

    expect(getKeys()).toContain('theme');
    remove();
    await nextTick();
    expect(theme.value).toBe('light');
    expect(storage.get('theme', 'light')).toBe('light');
    expect(getKeys()).not.toContain('theme');
    app.unmount();
  });

  it('should sync state across tabs when crossTabSync is enabled', async () => {
    const { result, app } = mountHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );
    const [theme] = result;

    await nextTick(); // wait for component to mount

    // Simulate a native StorageEvent triggered by another browser tab
    const event = new StorageEvent('storage', {
      key: 'test_theme',
      newValue: JSON.stringify({ value: 'blue', expiry: null }),
    });
    window.dispatchEvent(event);

    await nextTick();
    expect(theme.value).toBe('blue');

    // Simulate a deletion event from another tab
    const removeEvent = new StorageEvent('storage', {
      key: 'test_theme',
      newValue: null,
    });
    window.dispatchEvent(removeEvent);

    await nextTick();
    expect(theme.value).toBe('light'); // Reverts to fallback
    app.unmount();
  });
});

describe('useSecureStorage Vue Composable', () => {
  let storage;

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('crypto', webcrypto);
    storage = new SmartStorage({ prefix: 'secure_test', crossTabSync: true });
  });

  afterEach(() => {
    storage.dispose();
    vi.unstubAllGlobals();
  });

  it('should securely store and retrieve data asymmetrically', async () => {
    const { result, app } = mountHook(() =>
      useSecureStorage(storage, 'api_key', 'my-password', 'default-key'),
    );
    const [state, , , isLoading] = result;

    expect(isLoading.value).toBe(true);
    expect(state.value).toBe('default-key');

    // Wait for decryption promise
    await new Promise((r) => setTimeout(r, 50));
    expect(isLoading.value).toBe(false);

    // Mutate state to trigger secure encryption
    state.value = 'super-secret-key';
    await nextTick(); // Trigger watcher
    await new Promise((r) => setTimeout(r, 50)); // Wait for setSecure promise

    const raw = window.localStorage.getItem('secure_test_api_key');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('super-secret-key');

    app.unmount();
  });

  it('should remove value from storage and reset to fallback when remove is called', async () => {
    const { result, app } = mountHook(() =>
      useSecureStorage(storage, 'api_key', 'my-password', 'default-key'),
    );
    const [state, remove, getKeys] = result;

    // Wait for initial fetch
    await new Promise((r) => setTimeout(r, 50));

    state.value = 'super-secret-key';
    await nextTick(); // Trigger watcher
    await new Promise((r) => setTimeout(r, 50)); // Wait for setSecure promise

    expect(getKeys()).toContain('api_key');

    remove();
    await nextTick();

    expect(state.value).toBe('default-key');
    expect(window.localStorage.getItem('secure_test_api_key')).toBeNull();
    expect(getKeys()).not.toContain('api_key');

    app.unmount();
  });

  it('should sync state across tabs when crossTabSync is enabled', async () => {
    const { result, app } = mountHook(() =>
      useSecureStorage(storage, 'api_key', 'my-password', 'default-key'),
    );
    const [state] = result;

    // Wait for initial fetch
    await new Promise((r) => setTimeout(r, 50));

    // Set value securely directly on the storage instance (simulating other tab)
    await storage.setSecure('api_key', 'synced-value', 'my-password');

    // Dispatch the native storage event to trigger the cross-tab listener
    const event = new StorageEvent('storage', {
      key: 'secure_test_api_key',
      newValue: window.localStorage.getItem('secure_test_api_key'),
    });
    window.dispatchEvent(event);

    // Wait for the re-fetch to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(state.value).toBe('synced-value');

    app.unmount();
  });
});
