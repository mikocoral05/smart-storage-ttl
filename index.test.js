import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { SmartStorage } from './index.js';

describe('SmartStorage', () => {
  let windowListeners = {};

  beforeEach(() => {
    windowListeners = {};
    // 1. Mock the browser's storage environments
    const createStorageMock = () => {
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
    };

    const localStorageMock = createStorageMock();
    const sessionStorageMock = createStorageMock();

    vi.stubGlobal('window', {
      localStorage: localStorageMock,
      sessionStorage: sessionStorageMock,
      crypto: webcrypto,
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

    window.localStorage.setItem('other_app', 'keep');
    window.localStorage.setItem('ssttl__lru_order__', '[]');
    window.localStorage.setItem('ssttl_corrupted', '{bad');

    // Initializing the library should silently run autoClean()
    new SmartStorage();

    expect(window.localStorage.getItem('ssttl_expired')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('ssttl_valid')).value).toBe(
      'new',
    );
    expect(window.localStorage.getItem('other_app')).toBe('keep');
    expect(window.localStorage.getItem('ssttl__lru_order__')).toBe('[]');
    expect(window.localStorage.getItem('ssttl_corrupted')).toBeNull(); // Corrupted data gets cleaned up!
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

    // Add keys() coverage for memoryFallback branches
    storage.memoryFallback.set('other_app', { value: '1', expiry: null });
    storage.memoryFallback.set('ssttl__lru_order__', {
      value: [],
      expiry: null,
    });
    storage.memoryFallback.set('ssttl_expired', {
      value: '2',
      expiry: Date.now() - 1000,
    });
    const keys = storage.keys();
    expect(keys).toContain('session');
    expect(keys).not.toContain('other_app');
    expect(keys).not.toContain('expired');
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

  it('Feature: Session Storage Support', () => {
    const sessionStore = new SmartStorage({
      storage: 'session',
      prefix: 'sess',
    });
    sessionStore.set('temp', '123');

    // Should not be in local storage
    expect(window.localStorage.getItem('sess_temp')).toBeNull();

    // Should be in session storage
    const raw = window.sessionStorage.getItem('sess_temp');
    expect(JSON.parse(raw).value).toBe('123');
    expect(sessionStore.get('temp')).toBe('123');
  });

  it('Feature 5: Namespace Isolation', () => {
    const myAppStorage = new SmartStorage({ prefix: 'myapp' });

    // Set a library key and a rogue outside key
    myAppStorage.set('color', 'blue');
    window.localStorage.setItem('other_app_color', 'red');
    window.localStorage.setItem('myapp__lru_order__', '[]');

    // Execute isolated clear()
    myAppStorage.clear();

    // Library key should be wiped
    expect(window.localStorage.getItem('myapp_color')).toBeNull();

    // Rogue key should remain untouched
    expect(window.localStorage.getItem('other_app_color')).toBe('red');
    expect(window.localStorage.getItem('myapp__lru_order__')).toBeNull();
  });

  it('Feature: User ID Isolation', () => {
    const user1Storage = new SmartStorage({ prefix: 'app', userId: 'user1' });
    const user2Storage = new SmartStorage({ prefix: 'app', userId: 'user2' });

    user1Storage.set('theme', 'dark');
    user2Storage.set('theme', 'light');

    expect(user1Storage.get('theme')).toBe('dark');
    expect(user2Storage.get('theme')).toBe('light');
    expect(window.localStorage.getItem('app_user1_theme')).not.toBeNull();
    expect(window.localStorage.getItem('app_user2_theme')).not.toBeNull();
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

  it('Feature: Compression', () => {
    const compressedStorage = new SmartStorage({ compress: true });
    const plainStorage = new SmartStorage();
    const largeData = new Array(50).fill({
      id: 123,
      status: 'active',
      type: 'notification',
    });

    compressedStorage.set('big_data', largeData);

    // 1. Check that the raw value is compressed and smaller than uncompressed string
    const rawStored = window.localStorage.getItem('ssttl_big_data');
    const parsedRecord = JSON.parse(rawStored);
    expect(parsedRecord.isCompressed).toBe(true);

    // Note: Due to encodeURIComponent inflation on small data,
    // it only yields size reduction on sufficiently large/repeating data.
    expect(parsedRecord.value.length).toBeLessThan(
      JSON.stringify(largeData).length,
    );

    // 2. Check that getting it back decrypts/decompresses it correctly
    expect(compressedStorage.get('big_data')).toEqual(largeData);

    // 3. Check fallback and warning when read by plain storage
    const consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation(() => {});
    expect(plainStorage.get('big_data', 'fallback')).toBe('fallback');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('not configured for compression'),
    );

    consoleWarnSpy.mockRestore();
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

    // 3. Simulate a deletion event
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'ssttl_mykey',
        oldValue: newValue,
        newValue: null,
      }),
    );
    expect(changeCallback).toHaveBeenCalledWith('mykey', null, 'new');

    // 4. Simulate a corrupted JSON event
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'ssttl_mykey',
        oldValue: null,
        newValue: '{bad_json',
      }),
    );
    // Safely ignore parse error, but trigger change with nulls
    expect(changeCallback).toHaveBeenCalledWith('mykey', null, null);

    // 5. Simulate an event with a corrupted oldValue
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'ssttl_mykey',
        oldValue: '{bad_json',
        newValue: null,
      }),
    );
    expect(changeCallback).toHaveBeenCalledWith('mykey', null, null);
  });

  it('Feature: Custom Logger', () => {
    const customLogger = { warn: vi.fn(), error: vi.fn() };
    const storage = new SmartStorage({ logger: customLogger });

    // Trigger a warning (QuotaExceededError)
    vi.spyOn(window.localStorage, 'setItem').mockImplementationOnce(() => {
      throw new Error('QuotaExceededError');
    });
    storage.set('test', '123');

    expect(customLogger.warn).toHaveBeenCalledWith(
      'localStorage write failed, falling back to memory.',
      expect.any(Error),
    );

    // Trigger an error (Circular JSON)
    const circularObj = {};
    circularObj.self = circularObj;
    storage.set('circular', circularObj);

    expect(customLogger.error).toHaveBeenCalledWith(
      expect.stringContaining('Failed to serialize'),
      expect.any(Error),
    );
  });

  it('Feature: Auto-Serialize Map and Set', () => {
    const storage = new SmartStorage({
      autoSerialize: true,
      crossTabSync: true,
    });
    const map = new Map([
      ['a', 1],
      ['b', 2],
    ]);
    const set = new Set(['x', 'y']);

    storage.set('my_map', map);
    storage.set('my_set', set);

    const retrievedMap = storage.get('my_map');
    expect(retrievedMap).toBeInstanceOf(Map);
    expect(retrievedMap.get('a')).toBe(1);

    const retrievedSet = storage.get('my_set');
    expect(retrievedSet).toBeInstanceOf(Set);
    expect(retrievedSet.has('y')).toBe(true);

    const plainStorage = new SmartStorage();
    plainStorage.set('plain_map', map);
    expect(plainStorage.get('plain_map')).toEqual({}); // JSON.stringify(Map) defaults to {}

    // Cover autoSerialize parsing in cross-tab sync
    const changeCallback = vi.fn();
    storage.on('change', changeCallback);
    const oldValue = JSON.stringify({ value: map }, storage._replacer);
    const newValue = JSON.stringify({ value: set }, storage._replacer);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'ssttl_my_map',
        oldValue,
        newValue,
      }),
    );
    expect(changeCallback).toHaveBeenCalled();
    expect(changeCallback.mock.calls[0][1]).toBeInstanceOf(Set);
    expect(changeCallback.mock.calls[0][2]).toBeInstanceOf(Map);
  });

  it('Feature: Cross-Origin IFrame Sync (postMessage)', () => {
    const storage = new SmartStorage({ prefix: 'frame' });
    const targetWin = { postMessage: vi.fn() };

    storage.syncWithWindow(targetWin, '*');

    // 1. Broadcasts outward when set is called
    storage.set('test_key', '123');
    expect(targetWin.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'set', key: 'test_key', value: '123' }),
      '*',
    );

    // 2. Receives inward postMessage and triggers local listeners
    const changeCallback = vi.fn();
    storage.on('change', changeCallback);

    const event = new Event('message');
    event.data = {
      __ssttl: 'frame_',
      action: 'set',
      key: 'inward_key',
      value: '456',
    };
    event.origin = 'https://trusted.com';
    window.dispatchEvent(event);

    expect(storage.get('inward_key')).toBe('456');
    expect(changeCallback).toHaveBeenCalledWith('inward_key', '456', null);

    // 3. Receives inward postMessage for remove
    const removeEvent = new Event('message');
    removeEvent.data = {
      __ssttl: 'frame_',
      action: 'remove',
      key: 'inward_key',
    };
    removeEvent.origin = 'https://trusted.com';
    window.dispatchEvent(removeEvent);
    expect(storage.get('inward_key')).toBeNull();

    // 4. Receives inward postMessage for clear
    storage.set('another_key', '111');
    const clearEvent = new Event('message');
    clearEvent.data = { __ssttl: 'frame_', action: 'clear' };
    clearEvent.origin = 'https://trusted.com';
    window.dispatchEvent(clearEvent);
    expect(storage.get('another_key')).toBeNull();

    // 5. Ignores untrusted origins
    const strictStorage = new SmartStorage({ prefix: 'strict' });
    strictStorage.syncWithWindow(targetWin, 'https://trusted.com');

    const strictEvent = new Event('message');
    strictEvent.data = {
      __ssttl: 'strict_',
      action: 'set',
      key: 'hack',
      value: 'bad',
    };
    strictEvent.origin = 'https://evil.com';
    window.dispatchEvent(strictEvent);
    expect(strictStorage.get('hack')).toBeNull();
  });

  it('Feature: Evict Event (TTL & LRU)', () => {
    const storage = new SmartStorage({ prefix: 'evict_test', maxSize: 2 });
    const evictCallback = vi.fn();
    storage.on('evict', evictCallback);

    // 1. Test LRU Eviction
    storage.set('key1', 'val');
    storage.set('key2', 'val');
    storage.set('key3', 'val'); // Exceeds maxSize of 2, triggers eviction of key1

    expect(evictCallback).toHaveBeenCalledWith('key1', 'lru');

    // 2. Test TTL Eviction
    storage.set('expiring_key', 'val', '5m');

    // Fast forward 6 minutes
    vi.advanceTimersByTime(6 * 60 * 1000);

    storage.get('expiring_key'); // Triggers eviction check

    expect(evictCallback).toHaveBeenCalledWith('expiring_key', 'ttl');
  });

  it('Feature: Data Inspection (has and keys)', () => {
    const storage = new SmartStorage({ prefix: 'inspect' });

    storage.set('active_key', '123');
    storage.set('expired_key', '456', '5m');

    // Fast forward to expire the second key
    vi.advanceTimersByTime(6 * 60 * 1000);

    window.localStorage.setItem('other_app_key', '123');
    window.localStorage.setItem('inspect__lru_order__', '[]');
    window.localStorage.setItem('inspect_corrupt', '{bad_json');

    expect(storage.has('active_key')).toBe(true);
    expect(storage.has('expired_key')).toBe(false);
    expect(storage.has('missing_key')).toBe(false);
    expect(storage.has('corrupt')).toBe(false); // Cover has() corrupted JSON catch block

    const activeKeys = storage.keys();
    expect(activeKeys).toContain('active_key');
    expect(activeKeys).not.toContain('expired_key');
    expect(activeKeys).not.toContain('corrupt');
  });

  it('Feature: Read and Destroy (pop and popSecure)', async () => {
    const storage = new SmartStorage({ prefix: 'pop' });
    const password = 'test-password';

    // 1. Test standard pop
    storage.set('message', 'hello world');
    expect(storage.has('message')).toBe(true);

    const poppedMessage = storage.pop('message');
    expect(poppedMessage).toBe('hello world');
    expect(storage.has('message')).toBe(false); // Proves it was destroyed

    // Fallback on pop
    expect(storage.pop('missing', 'fallback')).toBe('fallback');

    // 2. Test secure pop
    await storage.setSecure('secret', 'my-secret-data', password);
    expect(storage.has('secret')).toBe(true);

    const poppedSecret = await storage.popSecure('secret', password);
    expect(poppedSecret).toBe('my-secret-data');
    expect(storage.has('secret')).toBe(false); // Proves secure data was destroyed

    // Fallback on popSecure
    expect(await storage.popSecure('missing_secret', password, 'fb')).toBe(
      'fb',
    );
  });

  it('Feature: Namespace Size Estimator (getSize)', () => {
    const storage = new SmartStorage({ prefix: 'size_test' });
    expect(storage.getSize()).toBe(0);

    storage.set('a', '123');
    const sizeAfterA = storage.getSize();
    expect(sizeAfterA).toBeGreaterThan(0);

    window.localStorage.setItem('other_app', 'ignored');
    window.localStorage.setItem('size_test__lru_order__', '[]');

    storage.set('b', '1234567890');
    expect(storage.getSize()).toBeGreaterThan(sizeAfterA);

    storage.clear();
    expect(storage.getSize()).toBe(0);
  });

  it('Feature: Web Crypto API (setSecure / getSecure)', async () => {
    const storage = new SmartStorage({ prefix: 'secure' });
    const password = 'super-secret-password';
    const data = { sensitive: 'information', creditCard: '1234' };

    // 1. Test successful encryption and decryption
    await storage.setSecure('payment', data, password);

    // Check that it's stored and encrypted in local storage
    const raw = window.localStorage.getItem('secure_payment');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('creditCard'); // Should be mathematically obfuscated

    const parsed = JSON.parse(raw);
    expect(parsed.value.__ssttl_crypto).toBe(true);

    // Decrypt successfully
    const retrieved = await storage.getSecure('payment', password);
    expect(retrieved).toEqual(data);

    // 2. Test incorrect password (should return fallback and remove corrupted data)
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const badRetrieve = await storage.getSecure(
      'payment',
      'wrong-password',
      'fallback-data',
    );

    expect(badRetrieve).toBe('fallback-data');
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to decrypt secure key'),
      expect.any(Error),
    );

    // Auto-cleanup should have removed the unreadable data
    expect(window.localStorage.getItem('secure_payment')).toBeNull();

    consoleErrorSpy.mockRestore();
  });
});

describe('SmartStorage: LRU Cache (maxSize)', () => {
  beforeEach(() => {
    // Mocking for LRU should be consistent with other tests
    const createStorageMock = () => {
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
    };
    vi.stubGlobal('window', {
      localStorage: createStorageMock(),
      sessionStorage: createStorageMock(),
    });
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('should evict oldest items when maxSize is exceeded', () => {
    const storage = new SmartStorage({ prefix: 'lru', maxSize: 3 });

    storage.set('key1', 'value1');
    storage.set('key2', 'value2');
    storage.set('key3', 'value3');
    expect(storage.get('key1')).toBe('value1'); // Access key1 to make it MRU

    storage.set('key4', 'value4'); // This should evict the oldest: key2

    expect(storage.get('key1')).toBe('value1'); // Key1 was accessed, should still be there
    expect(storage.get('key2')).toBeNull(); // Key2 should be evicted
    expect(storage.get('key3')).toBe('value3');
    expect(storage.get('key4')).toBe('value4');

    expect(window.localStorage.getItem('lru_key2')).toBeNull();
  });
});
