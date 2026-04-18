/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { effectScope, nextTick } from 'vue';
import { SmartStorage } from './index.js';
import { useSmartStorage } from './vue.js';

describe('useSmartStorage Vue Composable', () => {
  let storage;

  beforeEach(() => {
    window.localStorage.clear();
    storage = new SmartStorage({ prefix: 'test', crossTabSync: true });
  });

  afterEach(() => {
    storage.dispose();
  });

  it('should initialize with fallback if storage is empty', () => {
    const scope = effectScope();
    scope.run(() => {
      const [theme] = useSmartStorage(storage, 'theme', 'light');
      expect(theme.value).toBe('light');
    });
    scope.stop();
  });

  it('should initialize with stored value if present in storage', () => {
    storage.set('theme', 'dark');
    const scope = effectScope();
    scope.run(() => {
      const [theme] = useSmartStorage(storage, 'theme', 'light');
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
