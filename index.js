export class SmartStorage {
  constructor(options = {}) {
    this.options = {
      storage: 'local', // 'local' or 'session'
      prefix: 'ssttl_',
      encrypt: false,
      compress: false,
      maxSize: 0, // 0 means no size limit
      crossTabSync: false,
      logger: console,
      autoSerialize: false,
      userId: '',
      ...options,
    };

    // Feature 5: Namespace Isolation
    const basePrefix = this.options.prefix.endsWith('_')
      ? this.options.prefix
      : `${this.options.prefix}_`;
    this.prefix = this.options.userId
      ? `${basePrefix}${this.options.userId}_`
      : basePrefix;

    // Feature 3: Bulletproof Fallback to Memory
    this.memoryFallback = new Map();
    this.isSupported = this._checkStorageSupport();

    // Feature 1: Active Garbage Collection
    this.autoClean();

    this._lruListKey = `${this.prefix}__lru_order__`;
    this._lruList = this._getLruList();

    this._syncTargets = [];
    this._isSyncing = false;

    this._listeners = new Map();
    if (this.options.crossTabSync && this.isSupported) {
      window.addEventListener('storage', this._handleStorageChange);
    }
  }

  _log(level, ...args) {
    if (
      this.options.logger &&
      typeof this.options.logger[level] === 'function'
    ) {
      this.options.logger[level](...args);
    }
  }

  /**
   * Safely checks if localStorage is available and writable.
   * Handles Safari Incognito mode and restricted iframes.
   */
  _checkStorageSupport() {
    try {
      this._store =
        this.options.storage === 'session'
          ? window.sessionStorage
          : window.localStorage;
      const testKey = '__ssttl_test__';
      this._store.setItem(testKey, '1');
      this._store.removeItem(testKey);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Feature 4: Human-Readable Time Formats
   * Converts formats like '30m', '2h', '1d' to milliseconds.
   */
  _parseTime(ttl) {
    if (typeof ttl === 'number') return ttl;
    if (typeof ttl !== 'string') return null;

    const match = ttl.match(/^(\d+)([smhd])$/);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value * 1000;
      case 'm':
        return value * 60 * 1000;
      case 'h':
        return value * 60 * 60 * 1000;
      case 'd':
        return value * 24 * 60 * 60 * 1000;
      default:
        return null;
    }
  }

  _triggerEvict(key, reason) {
    const evictListeners = this._listeners.get('evict');
    if (evictListeners) {
      evictListeners.forEach((cb) => cb(key, reason));
    }
  }

  _broadcast(payload) {
    if (this._isSyncing) return;
    this._syncTargets.forEach((target) => {
      try {
        target.win.postMessage(
          { __ssttl: this.prefix, ...payload },
          target.origin,
        );
      } catch (e) {
        this._log(
          'warn',
          'smart-storage-ttl: Failed to broadcast to window',
          e,
        );
      }
    });
  }

  set(key, value, ttl = null) {
    this._broadcast({ action: 'set', key, value, ttl });
    const prefixedKey = this.prefix + key;
    const ttlMs = this._parseTime(ttl);
    const expiry = ttlMs ? Date.now() + ttlMs : null;

    let record = { value, expiry };

    if (this.options.compress) {
      // Compression happens first if enabled
      try {
        const str = JSON.stringify(
          record.value,
          this.options.autoSerialize ? this._replacer : undefined,
        );
        if (str !== undefined) {
          record.value = this._compress(encodeURIComponent(str));
          record.isCompressed = true;
        }
      } catch (error) {
        this._log(
          'error',
          `smart-storage-ttl: Failed to compress value for key "${key}".`,
          error,
        );
        return;
      }
    }
    if (this.options.encrypt) {
      // Encryption happens second if enabled (on compressed or uncompressed data)
      try {
        record.value = btoa(
          JSON.stringify(
            record.value,
            this.options.autoSerialize ? this._replacer : undefined,
          ),
        );
        record.isEncrypted = true;
      } catch (error) {
        this._log(
          'error',
          `smart-storage-ttl: Failed to encrypt value for key "${key}". Encryption only works on JSON-serializable data.`,
          error,
        );
        return;
      }
    }

    // Feature: LRU Cache - Update recency and evict if needed
    if (this.options.maxSize > 0) {
      this._updateLru(prefixedKey);
      this._evictLruItems();
    }
    if (this.isSupported) {
      try {
        const serialized = JSON.stringify(
          record,
          this.options.autoSerialize ? this._replacer : undefined,
        );
        this._store.setItem(prefixedKey, serialized);
        return;
      } catch (error) {
        // Distinguish between serialization errors and storage quota errors
        if (error.name === 'TypeError') {
          this._log(
            'error',
            `smart-storage-ttl: Failed to serialize value for key "${key}".`,
            error,
          );
          return; // Do not fall back to memory for developer errors
        }
        // Fallback: localStorage might be full (QuotaExceededError)
        this._log(
          'warn',
          'localStorage write failed, falling back to memory.',
          error,
        );
      }
    }

    // Feature 3: Save to memory if storage is blocked or full
    this.memoryFallback.set(prefixedKey, record);
  }

  // --- Web Crypto API (Asynchronous Secure Storage) ---

  async _getEncryptionKey(password) {
    const enc = new TextEncoder();
    // Hash the password to get a consistent 256-bit key material
    const hash = await window.crypto.subtle.digest(
      'SHA-256',
      enc.encode(password),
    );
    return window.crypto.subtle.importKey(
      'raw',
      hash,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt'],
    );
  }

  async setSecure(key, value, password, ttl = null) {
    if (!window.crypto || !window.crypto.subtle) {
      this._log(
        'error',
        'smart-storage-ttl: Web Crypto API is not available in this environment.',
      );
      return;
    }

    try {
      const cryptoKey = await this._getEncryptionKey(password);
      const iv = window.crypto.getRandomValues(new Uint8Array(12));
      const serialized = JSON.stringify(
        value,
        this.options.autoSerialize ? this._replacer : undefined,
      );
      const encoded = new TextEncoder().encode(serialized);

      const encryptedBuf = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encoded,
      );

      // Combine IV and encrypted data to store as a single Base64 string
      const combined = new Uint8Array(iv.length + encryptedBuf.byteLength);
      combined.set(iv, 0);
      combined.set(new Uint8Array(encryptedBuf), iv.length);

      // Convert buffer to base64
      const base64Str = btoa(String.fromCharCode.apply(null, combined));

      // Store it using the standard set method, wrapping it in an object flag
      this.set(key, { __ssttl_crypto: true, payload: base64Str }, ttl);
    } catch (error) {
      this._log(
        'error',
        `smart-storage-ttl: Failed to securely encrypt key "${key}".`,
        error,
      );
    }
  }

  async getSecure(key, password, fallback = null) {
    if (!window.crypto || !window.crypto.subtle) {
      this._log(
        'error',
        'smart-storage-ttl: Web Crypto API is not available in this environment.',
      );
      return fallback;
    }

    const wrapper = this.get(key);
    if (!wrapper || !wrapper.__ssttl_crypto || !wrapper.payload) {
      return wrapper !== null ? wrapper : fallback;
    }

    try {
      const cryptoKey = await this._getEncryptionKey(password);
      const binaryStr = atob(wrapper.payload);
      const combined = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        combined[i] = binaryStr.charCodeAt(i);
      }

      // Extract the 12-byte IV and the encrypted data
      const iv = combined.slice(0, 12);
      const encryptedData = combined.slice(12);

      const decryptedBuf = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        encryptedData,
      );

      const decoded = new TextDecoder().decode(decryptedBuf);
      return JSON.parse(
        decoded,
        this.options.autoSerialize ? this._reviver : undefined,
      );
    } catch (error) {
      this._log(
        'error',
        `smart-storage-ttl: Failed to decrypt secure key "${key}". Incorrect password or corrupted data.`,
        error,
      );
      this.remove(key); // Auto-cleanup unreadable data
      return fallback;
    }
  }

  /**
   * Feature 2: Smart Fallbacks
   */
  get(key, fallback = null) {
    const prefixedKey = this.prefix + key;
    let record = null;

    // Try to get from localStorage first
    if (this.isSupported) {
      const raw = this._store.getItem(prefixedKey);
      if (raw) {
        try {
          record = JSON.parse(
            raw,
            this.options.autoSerialize ? this._reviver : undefined,
          );
        } catch (error) {
          // Handle corrupted JSON
          this.remove(key);
          return fallback;
        }
      }
    }

    // If not found in localStorage, check memory fallback
    if (!record && this.memoryFallback.has(prefixedKey)) {
      record = this.memoryFallback.get(prefixedKey);
    }

    // If completely missing, return the fallback
    if (!record) return fallback;

    // Check if expired
    if (record.expiry && Date.now() > record.expiry) {
      this._triggerEvict(key, 'ttl');
      this.remove(key); // Cleanup immediately
      return fallback;
    }

    // Feature: LRU Cache - Update recency on access
    if (this.options.maxSize > 0) {
      this._updateLru(prefixedKey);
    }

    const finalValue = this._hydrateValue(record, key, fallback);

    // If JSON.stringify stripped 'undefined', or it was explicitly set, return fallback
    return finalValue !== undefined ? finalValue : fallback;
  }

  pop(key, fallback = null) {
    const value = this.get(key, fallback);
    this.remove(key);
    return value;
  }

  async popSecure(key, password, fallback = null) {
    const value = await this.getSecure(key, password, fallback);
    this.remove(key);
    return value;
  }

  has(key) {
    const prefixedKey = this.prefix + key;
    if (this.isSupported) {
      const raw = this._store.getItem(prefixedKey);
      if (raw) {
        try {
          const record = JSON.parse(raw);
          return !(record.expiry && Date.now() > record.expiry);
        } catch {
          return false; // Corrupted JSON, treat as missing
        }
      }
    }
    // Check memory fallback
    if (this.memoryFallback.has(prefixedKey)) {
      const record = this.memoryFallback.get(prefixedKey);
      return !(record.expiry && Date.now() > record.expiry);
    }
    return false;
  }

  keys() {
    const result = new Set();
    const now = Date.now();

    if (this.isSupported) {
      for (let i = 0; i < this._store.length; i++) {
        const k = this._store.key(i);
        if (k.startsWith(this.prefix) && k !== this._lruListKey) {
          try {
            const raw = this._store.getItem(k);
            const record = JSON.parse(raw);
            if (!(record.expiry && now > record.expiry)) {
              result.add(k.substring(this.prefix.length));
            }
          } catch {
            // Ignore corrupted JSON
          }
        }
      }
    }
    for (const [k, record] of this.memoryFallback.entries()) {
      if (k.startsWith(this.prefix) && k !== this._lruListKey) {
        if (!(record.expiry && now > record.expiry)) {
          result.add(k.substring(this.prefix.length));
        }
      }
    }
    return Array.from(result);
  }

  getSize() {
    let totalLength = 0;
    if (this.isSupported) {
      for (let i = 0; i < this._store.length; i++) {
        const k = this._store.key(i);
        if (k.startsWith(this.prefix) && k !== this._lruListKey) {
          totalLength += k.length + (this._store.getItem(k) || '').length;
        }
      }
    }
    return totalLength * 2; // Approximate byte size (UTF-16 strings are 2 bytes per char)
  }

  _hydrateValue(record, key, fallback = null) {
    if (!record) return fallback;

    let finalValue = record.value;

    if (record.isEncrypted) {
      if (!this.options.encrypt) {
        this._log(
          'warn',
          `smart-storage-ttl: Key "${key}" is encrypted, but the current storage instance is not configured for encryption. Returning fallback.`,
        );
        return fallback;
      }
      try {
        finalValue = JSON.parse(
          atob(String(finalValue)),
          this.options.autoSerialize && !record.isCompressed
            ? this._reviver
            : undefined,
        );
      } catch (error) {
        this._log(
          'error',
          `smart-storage-ttl: Failed to decrypt or parse data for key "${key}". The data may be corrupted.`,
          error,
        );
        this.remove(key); // Clean up corrupted data
        return fallback;
      }
    }

    if (record.isCompressed) {
      if (!this.options.compress) {
        this._log(
          'warn',
          `smart-storage-ttl: Key "${key}" is compressed, but the current storage instance is not configured for compression. Returning fallback.`,
        );
        return fallback;
      }
      try {
        finalValue = JSON.parse(
          decodeURIComponent(this._decompress(finalValue)),
          this.options.autoSerialize ? this._reviver : undefined,
        );
      } catch (error) {
        this._log(
          'error',
          `smart-storage-ttl: Failed to decompress or parse data for key "${key}". The data may be corrupted.`,
          error,
        );
        this.remove(key); // Clean up corrupted data
        return fallback;
      }
    }
    return finalValue;
  }

  _replacer(key, value) {
    if (value instanceof Map) {
      return { __ssttl_type__: 'Map', value: Array.from(value.entries()) };
    }
    if (value instanceof Set) {
      return { __ssttl_type__: 'Set', value: Array.from(value) };
    }
    return value;
  }

  _reviver(key, value) {
    if (value && typeof value === 'object' && value.__ssttl_type__) {
      if (value.__ssttl_type__ === 'Map') return new Map(value.value);
      if (value.__ssttl_type__ === 'Set') return new Set(value.value);
    }
    return value;
  }

  _compress(uncompressed) {
    if (!uncompressed) return uncompressed;
    const dict = new Map();
    let phrase = uncompressed.charAt(0);
    let code = 256;
    const out = [];
    for (let i = 1; i < uncompressed.length; i++) {
      const currChar = uncompressed.charAt(i);
      if (dict.has(phrase + currChar)) {
        phrase += currChar;
      } else {
        out.push(phrase.length > 1 ? dict.get(phrase) : phrase.charCodeAt(0));
        dict.set(phrase + currChar, code);
        code++;
        if (code === 65535) {
          dict.clear();
          code = 256;
        }
        phrase = currChar;
      }
    }
    out.push(phrase.length > 1 ? dict.get(phrase) : phrase.charCodeAt(0));
    return out.map((c) => String.fromCharCode(c)).join('');
  }

  _decompress(compressed) {
    if (!compressed) return compressed;
    const dict = new Map();
    let currChar = compressed.charAt(0);
    let oldPhrase = currChar;
    const out = [currChar];
    let code = 256;
    for (let i = 1; i < compressed.length; i++) {
      const currCode = compressed.charCodeAt(i);
      const phrase =
        currCode < 256
          ? compressed.charAt(i)
          : dict.has(currCode)
            ? dict.get(currCode)
            : oldPhrase + currChar;
      out.push(phrase);
      currChar = phrase.charAt(0);
      dict.set(code, oldPhrase + currChar);
      code++;
      if (code === 65535) {
        dict.clear();
        code = 256;
      }
      oldPhrase = phrase;
    }
    return out.join('');
  }

  // Override remove to also clean up LRU list
  remove(key) {
    this._broadcast({ action: 'remove', key });
    const prefixedKey = this.prefix + key;
    if (this.isSupported) {
      this._store.removeItem(prefixedKey);
    }
    this.memoryFallback.delete(prefixedKey);

    if (this.options.maxSize > 0) {
      this._lruList = this._lruList.filter((k) => k !== prefixedKey);
      this._saveLruList(this._lruList);
    }
  }

  /**
   * Feature 5: Clears only keys belonging to this namespace
   */
  // Override clear to also clean up LRU list
  clear() {
    this._broadcast({ action: 'clear' });
    if (this.isSupported) {
      const keysToRemove = [];
      for (let i = 0; i < this._store.length; i++) {
        const k = this._store.key(i);
        if (k.startsWith(this.prefix) && k !== this._lruListKey) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => this._store.removeItem(k));
      this._store.removeItem(this._lruListKey); // Clear the LRU list itself
    }
    this.memoryFallback.clear();
    this._lruList = []; // Reset in-memory LRU list
  }

  /**
   * Feature 1: Scans and wipes expired data on initialization
   */
  autoClean() {
    if (!this.isSupported) return;

    const keysToRemove = [];

    for (let i = 0; i < this._store.length; i++) {
      const k = this._store.key(i);

      // Only check keys matching our namespace
      if (k.startsWith(this.prefix) && k !== this._lruListKey) {
        const raw = this._store.getItem(k);
        if (raw) {
          try {
            const record = JSON.parse(raw);
            if (record.expiry && Date.now() > record.expiry) {
              this._triggerEvict(k.substring(this.prefix.length), 'ttl');
              keysToRemove.push(k);
            }
          } catch (error) {
            // If data is corrupted/invalid JSON, clean it up anyway
            keysToRemove.push(k);
          }
        }
      }
    }

    // Batch remove to avoid mutating the storage object while iterating
    keysToRemove.forEach((k) => this._store.removeItem(k));
  }

  // --- LRU Cache (Internal Methods) ---

  _getLruList() {
    if (!this.isSupported) return [];
    try {
      const raw = this._store.getItem(this._lruListKey);
      return raw ? JSON.parse(raw) : [];
    } catch (error) {
      this._log(
        'error',
        'smart-storage-ttl: Failed to read LRU list, starting fresh.',
        error,
      );
      return [];
    }
  }

  _saveLruList(list) {
    if (!this.isSupported) return;
    try {
      this._store.setItem(this._lruListKey, JSON.stringify(list));
    } catch (error) {
      this._log('warn', 'smart-storage-ttl: Failed to save LRU list.', error);
      // If LRU list fails to save, it might be due to quota,
      // but we still want the item to be set, so just warn.
    }
  }

  _updateLru(prefixedKey) {
    // Remove from current position (if exists)
    this._lruList = this._lruList.filter((k) => k !== prefixedKey);
    // Add to the end (most recently used)
    this._lruList.push(prefixedKey);
    this._saveLruList(this._lruList);
  }

  _evictLruItems() {
    if (this.options.maxSize <= 0) return;

    while (this._lruList.length > this.options.maxSize) {
      const oldestKey = this._lruList.shift(); // Get and remove the oldest key
      if (oldestKey) {
        this._triggerEvict(oldestKey.substring(this.prefix.length), 'lru');
        // Explicitly remove from storage and memoryFallback
        if (this.isSupported) {
          this._store.removeItem(oldestKey);
        }
        this.memoryFallback.delete(oldestKey);
        // Clean up any associated non-prefixed key from memory fallback too, if it somehow got there
        if (oldestKey.startsWith(this.prefix)) {
          const unprefixedKey = oldestKey.substring(this.prefix.length);
          this.memoryFallback.delete(unprefixedKey);
        }
      }
    }
    this._saveLruList(this._lruList);
  }

  _handleStorageChange = (event) => {
    if (!event.key || !event.key.startsWith(this.prefix)) {
      return;
    }

    const key = event.key.substring(this.prefix.length);

    // Update memory fallback
    if (event.newValue) {
      try {
        this.memoryFallback.set(
          event.key,
          JSON.parse(
            event.newValue,
            this.options.autoSerialize ? this._reviver : undefined,
          ),
        );
      } catch {
        // ignore parse errors
      }
    } else {
      this.memoryFallback.delete(event.key);
    }

    // Trigger listeners
    const changeListeners = this._listeners.get('change');
    if (changeListeners) {
      let newValue, oldValue;
      try {
        const newRecord = event.newValue
          ? JSON.parse(
              event.newValue,
              this.options.autoSerialize ? this._reviver : undefined,
            )
          : null;
        const oldRecord = event.oldValue
          ? JSON.parse(
              event.oldValue,
              this.options.autoSerialize ? this._reviver : undefined,
            )
          : null;

        newValue = this._hydrateValue(newRecord, key);
        oldValue = this._hydrateValue(oldRecord, key);
      } catch {
        newValue = null;
        oldValue = null;
      }

      changeListeners.forEach((callback) => callback(key, newValue, oldValue));
    }
  };

  syncWithWindow(targetWindow, targetOrigin = '*') {
    if (!this._messageListener) {
      this._messageListener = (event) => {
        if (!event.data || event.data.__ssttl !== this.prefix) return;

        // Verify origin for cross-domain security
        const isTrusted = this._syncTargets.some(
          (t) => t.origin === '*' || t.origin === event.origin,
        );
        if (!isTrusted) return;

        this._isSyncing = true;
        try {
          const { action, key, value, ttl } = event.data;
          const oldValue = key ? this.get(key) : null;

          if (action === 'set') {
            this.set(key, value, ttl);
          } else if (action === 'remove') {
            this.remove(key);
          } else if (action === 'clear') {
            this.clear();
          }

          // Manually trigger local UI hooks
          if (action === 'set' || action === 'remove') {
            const changeListeners = this._listeners.get('change');
            if (changeListeners) {
              const newValue = action === 'set' ? value : null;
              changeListeners.forEach((cb) => cb(key, newValue, oldValue));
            }
          }
        } finally {
          this._isSyncing = false;
        }
      };
      window.addEventListener('message', this._messageListener);
    }
    this._syncTargets.push({ win: targetWindow, origin: targetOrigin });
  }

  on(eventName, callback) {
    if (!this._listeners.has(eventName)) {
      this._listeners.set(eventName, new Set());
    }
    this._listeners.get(eventName).add(callback);
  }

  off(eventName, callback) {
    if (this._listeners.has(eventName)) {
      this._listeners.get(eventName).delete(callback);
    }
  }

  dispose() {
    if (this.options.crossTabSync && this.isSupported) {
      window.removeEventListener('storage', this._handleStorageChange);
    }
    if (this._messageListener) {
      window.removeEventListener('message', this._messageListener);
    }
    this._syncTargets = [];
    this._listeners.clear();
  }
}
