/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { webcrypto } from 'node:crypto';
import { SmartStorage } from './index.js';
import { useSmartStorage, useSecureStorage } from './vue.js';

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
    const scope = effectScope();
    scope.run(() => {
      const [theme] = useSmartStorage(storage, 'theme', 'light');
      expect(theme.value).toBe('light');
    });
    scope.stop();
  });

  it('should initialize with stored value after hydration', async () => {
    storage.set('theme', 'dark');
    const scope = effectScope();
    await scope.run(async () => {
      const [theme] = useSmartStorage(storage, 'theme', 'light');

      // Initial state should be the fallback
      expect(theme.value).toBe('light');

      // Wait for onMounted to complete
      await nextTick();
      expect(theme.value).toBe('dark');
    });
    scope.stop();
  });

  it('should update storage when ref is mutated', async () => {
    const scope = effectScope();
    await scope.run(async () => {
      const [theme] = useSmartStorage(storage, 'theme', 'light');
      theme.value = 'dark';
      await nextTick(); // Wait for Vue's watch to trigger
      expect(storage.get('theme')).toBe('dark');
    });
    scope.stop();
  });

  it('should remove value from storage and reset to fallback when remove is called', async () => {
    storage.set('theme', 'dark');
    const scope = effectScope();
    await scope.run(async () => {
      const [theme, remove] = useSmartStorage(storage, 'theme', 'light');
      remove();
      await nextTick();
      expect(theme.value).toBe('light');
      expect(storage.get('theme', 'light')).toBe('light');
    });
    scope.stop();
  });

  it('should sync state across tabs when crossTabSync is enabled', async () => {
    const scope = effectScope();
    await scope.run(async () => {
      const [theme] = useSmartStorage(storage, 'theme', 'light');

      // Simulate a native StorageEvent triggered by another browser tab
      const event = new StorageEvent('storage', {
        key: 'test_theme',
        newValue: JSON.stringify({ value: 'blue', expiry: null }),
      });
      window.dispatchEvent(event);

      await nextTick();
      expect(theme.value).toBe('blue');
    });
    scope.stop();
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
    const scope = effectScope();
    await scope.run(async () => {
      const [state, , , isLoading] = useSecureStorage(
        storage,
        'api_key',
        'my-password',
        'default-key',
      );

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
    });
    scope.stop();
  });
});
