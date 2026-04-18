export class SmartStorage {
  constructor(options = {}) {
    this.options = {
      prefix: 'ssttl_',
      encrypt: false,
      crossTabSync: false,
      ...options,
    };

    // Feature 5: Namespace Isolation
    this.prefix = this.options.prefix.endsWith('_')
      ? this.options.prefix
      : `${this.options.prefix}_`;

    // Feature 3: Bulletproof Fallback to Memory
    this.memoryFallback = new Map();
    this.isSupported = this._checkStorageSupport();

    // Feature 1: Active Garbage Collection
    this.autoClean();

    this._listeners = new Map();
    if (this.options.crossTabSync && this.isSupported) {
      window.addEventListener('storage', this._handleStorageChange);
    }
  }

  /**
   * Safely checks if localStorage is available and writable.
   * Handles Safari Incognito mode and restricted iframes.
   */
  _checkStorageSupport() {
    try {
      const testKey = '__ssttl_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
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

  set(key, value, ttl = null) {
    const prefixedKey = this.prefix + key;
    const ttlMs = this._parseTime(ttl);
    const expiry = ttlMs ? Date.now() + ttlMs : null;

    let record = { value, expiry };

    if (this.options.encrypt) {
      try {
        record.value = btoa(JSON.stringify(record.value));
        record.isEncrypted = true;
      } catch (error) {
        console.error(
          `smart-storage-ttl: Failed to encrypt value for key "${key}". Encryption only works on JSON-serializable data.`,
          error,
        );
        return;
      }
    }

    if (this.isSupported) {
      try {
        const serialized = JSON.stringify(record);
        window.localStorage.setItem(prefixedKey, serialized);
        return;
      } catch (error) {
        // Distinguish between serialization errors and storage quota errors
        if (error.name === 'TypeError') {
          console.error(
            `smart-storage-ttl: Failed to serialize value for key "${key}".`,
            error,
          );
          return; // Do not fall back to memory for developer errors
        }
        // Fallback: localStorage might be full (QuotaExceededError)
        console.warn(
          'localStorage write failed, falling back to memory.',
          error,
        );
      }
    }

    // Feature 3: Save to memory if storage is blocked or full
    this.memoryFallback.set(prefixedKey, record);
  }

  /**
   * Feature 2: Smart Fallbacks
   */
  get(key, fallback = null) {
    const prefixedKey = this.prefix + key;
    let record = null;

    // Try to get from localStorage first
    if (this.isSupported) {
      const raw = window.localStorage.getItem(prefixedKey);
      if (raw) {
        try {
          record = JSON.parse(raw);
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
      this.remove(key); // Cleanup immediately
      return fallback;
    }

    const finalValue = this._hydrateValue(record, key, fallback);

    // If JSON.stringify stripped 'undefined', or it was explicitly set, return fallback
    return finalValue !== undefined ? finalValue : fallback;
  }

  _hydrateValue(record, key, fallback = null) {
    if (!record) return fallback;

    let finalValue = record.value;
    if (record.isEncrypted) {
      if (!this.options.encrypt) {
        console.warn(
          `smart-storage-ttl: Key "${key}" is encrypted, but the current storage instance is not configured for encryption. Returning fallback.`,
        );
        return fallback;
      }
      try {
        finalValue = JSON.parse(atob(String(finalValue)));
      } catch (error) {
        console.error(
          `smart-storage-ttl: Failed to decrypt or parse data for key "${key}". The data may be corrupted.`,
          error,
        );
        this.remove(key); // Clean up corrupted data
        return fallback;
      }
    }
    return finalValue;
  }

  remove(key) {
    const prefixedKey = this.prefix + key;
    if (this.isSupported) {
      window.localStorage.removeItem(prefixedKey);
    }
    this.memoryFallback.delete(prefixedKey);
  }

  /**
   * Feature 5: Clears only keys belonging to this namespace
   */
  clear() {
    if (this.isSupported) {
      const keysToRemove = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const k = window.localStorage.key(i);
        if (k.startsWith(this.prefix)) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach((k) => window.localStorage.removeItem(k));
    }
    this.memoryFallback.clear();
  }

  /**
   * Feature 1: Scans and wipes expired data on initialization
   */
  autoClean() {
    if (!this.isSupported) return;

    const keysToRemove = [];

    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);

      // Only check keys matching our namespace
      if (k.startsWith(this.prefix)) {
        const raw = window.localStorage.getItem(k);
        if (raw) {
          try {
            const record = JSON.parse(raw);
            if (record.expiry && Date.now() > record.expiry) {
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
    keysToRemove.forEach((k) => window.localStorage.removeItem(k));
  }

  _handleStorageChange = (event) => {
    if (!event.key || !event.key.startsWith(this.prefix)) {
      return;
    }

    const key = event.key.substring(this.prefix.length);

    // Update memory fallback
    if (event.newValue) {
      try {
        this.memoryFallback.set(event.key, JSON.parse(event.newValue));
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
        const newRecord = event.newValue ? JSON.parse(event.newValue) : null;
        const oldRecord = event.oldValue ? JSON.parse(event.oldValue) : null;

        newValue = this._hydrateValue(newRecord, key);
        oldValue = this._hydrateValue(oldRecord, key);
      } catch {
        newValue = null;
        oldValue = null;
      }

      changeListeners.forEach((callback) => callback(key, newValue, oldValue));
    }
  };

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
    this._listeners.clear();
  }
}
