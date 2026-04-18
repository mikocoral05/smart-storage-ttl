import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SmartStorage } from './index.js';

describe('SmartStorage', () => {
  let windowListeners = {};

  beforeEach(() => {
    windowListeners = {};
    // 1. Mock the browser's window.localStorage environment
    const localStorageMock = (() => {
      let store = {};
      return {
        getItem: vi.fn((key) => (key in store ? store[key] : null)),
        setItem: vi.fn((key, value) => {
          store[key] = value.toString();
        }),
        removeItem: vi.fn((key) => {
          delete store[key];
        }),
        clear: vi.fn(() => {
          store = {};
        }),
        get length() {
          return Object.keys(store).length;
        },
        key: vi.fn((i) => Object.keys(store)[i]),
      };
    })();

    vi.stubGlobal('window', {
      localStorage: localStorageMock,
      addEventListener: vi.fn((event, cb) => {
        windowListeners[event] = cb;
      }),
      removeEventListener: vi.fn((event) => {
        delete windowListeners[event];
      }),
      dispatchEvent: vi.fn((event) => {
        if (windowListeners[event.type]) {
          windowListeners[event.type](event);
        }
      }),
    });

    vi.stubGlobal(
      'StorageEvent',
      class StorageEvent {
        constructor(type, init) {
          this.type = type;
          Object.assign(this, init);
        }
      },
    );

    // 2. Lock the system time so TTL math is predictable
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('Feature 1: Active Garbage Collection (Auto-Cleanup)', () => {
    // Manually insert an expired item and a valid item into localStorage
    window.localStorage.setItem(
      'ssttl_expired',
      JSON.stringify({ value: 'old', expiry: Date.now() - 1000 }),
    );
    window.localStorage.setItem(
      'ssttl_valid',
      JSON.stringify({ value: 'new', expiry: Date.now() + 1000 }),
    );

    // Initializing the library should silently run autoClean()
    new SmartStorage();

    expect(window.localStorage.getItem('ssttl_expired')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('ssttl_valid')).value).toBe(
      'new',
    );
  });

  it('Feature 2: Smart Fallbacks (Default Values)', () => {
    const storage = new SmartStorage();

    // Missing key should return fallback
    expect(storage.get('theme', 'dark-mode')).toBe('dark-mode');

    // Expired key should return fallback
    storage.set('promo', 'show', '5m');
    vi.advanceTimersByTime(6 * 60 * 1000); // Fast-forward 6 minutes
    expect(storage.get('promo', 'hide')).toBe('hide');
  });

  it('Feature 3: Bulletproof Fallback to Memory', () => {
    const storage = new SmartStorage();

    // Simulate Safari Incognito or Storage Quota Exceeded error
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    // Setting the value will fail in localStorage, but silently fall back to memory
    storage.set('session', '12345');

    // Prove it didn't make it to localStorage
    expect(window.localStorage.getItem('ssttl_session')).toBeNull();

    // Prove the app can still retrieve it seamlessly
    expect(storage.get('session')).toBe('12345');
  });

  it('Feature 4: Human-Readable Time Formats', () => {
    const storage = new SmartStorage();

    // Check parser works for seconds, minutes, hours, and days
    expect(storage._parseTime('30s')).toBe(30 * 1000);
    expect(storage._parseTime('15m')).toBe(15 * 60 * 1000);
    expect(storage._parseTime('2h')).toBe(2 * 60 * 60 * 1000);
    expect(storage._parseTime('1d')).toBe(24 * 60 * 60 * 1000);

    // Should fallback to parsing a standard millisecond number
    expect(storage._parseTime(5000)).toBe(5000);

    // Invalid formats should return null
    expect(storage._parseTime('10years')).toBeNull();
  });

  it('Feature 5: Namespace Isolation', () => {
    const myAppStorage = new SmartStorage({ prefix: 'myapp' });

    // Set a library key and a rogue outside key
    myAppStorage.set('color', 'blue');
    window.localStorage.setItem('other_app_color', 'red');

    // Execute isolated clear()
    myAppStorage.clear();

    // Library key should be wiped
    expect(window.localStorage.getItem('myapp_color')).toBeNull();

    // Rogue key should remain untouched
    expect(window.localStorage.getItem('other_app_color')).toBe('red');
  });

  it('Edge Cases: JSON Serialization and undefined handling', () => {
    const storage = new SmartStorage();

    // 1. undefined values should return fallback (since JSON.stringify strips undefined)
    storage.set('empty', undefined);
    expect(storage.get('empty', 'fallback-triggered')).toBe(
      'fallback-triggered',
    );

    // 2. Circular references should log an error and NOT save to memory
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const circularObj = {};
    circularObj.self = circularObj;

    storage.set('circular', circularObj);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to serialize'),
      expect.any(Error),
    );
    expect(storage.get('circular', 'fallback-triggered')).toBe(
      'fallback-triggered',
    );

    consoleSpy.mockRestore();
  });

  it('Feature: Encryption', () => {
    const encryptedStorage = new SmartStorage({ encrypt: true });
    const plainStorage = new SmartStorage();
    const myObject = { a: 1, b: 'hello' };

    encryptedStorage.set('secret', myObject);

    // 1. Check that the raw value in localStorage is not the original object
    const raw = window.localStorage.getItem('ssttl_secret');
    expect(raw).not.toContain('hello');
    const parsedRaw = JSON.parse(raw);
    expect(parsedRaw.isEncrypted).toBe(true);

    // 2. Check that getting it back with the correct instance decrypts it
    expect(encryptedStorage.get('secret')).toEqual(myObject);

    // 3. Check that a plain instance gets a fallback and warns the user
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    expect(plainStorage.get('secret', 'fallback')).toBe('fallback');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not configured for encryption'),
    );

    // 4. Test corrupted data
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    window.localStorage.setItem(
      'ssttl_secret',
      JSON.stringify({ value: 'not-base-64-!', isEncrypted: true }),
    );
    expect(encryptedStorage.get('secret', 'fallback')).toBe('fallback');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to decrypt'),
      expect.any(Error),
    );

    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('Feature: Cross-Tab Sync & Events', () => {
    const storage = new SmartStorage({ crossTabSync: true, encrypt: true });
    const changeCallback = vi.fn();
    storage.on('change', changeCallback);

    // 1. Simulate a storage event from another tab (with encrypted data)
    const oldValue = JSON.stringify({
      value: btoa(JSON.stringify('old')),
      isEncrypted: true,
    });
    const newValue = JSON.stringify({
      value: btoa(JSON.stringify('new')),
      isEncrypted: true,
    });

    const event = new StorageEvent('storage', {
      key: 'ssttl_mykey',
      oldValue,
      newValue,
    });
    window.dispatchEvent(event);

    // 2. Check if the listener was called with the correct, decrypted values
    expect(changeCallback).toHaveBeenCalledTimes(1);
    expect(changeCallback).toHaveBeenCalledWith('mykey', 'new', 'old');
  });
});
