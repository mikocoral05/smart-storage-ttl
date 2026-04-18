export class SmartStorage {
  constructor(options = {}) {
    // Feature 5: Namespace Isolation
    this.prefix = options.prefix ? `${options.prefix}_` : "ssttl_";

    // Feature 3: Bulletproof Fallback to Memory
    this.memoryFallback = new Map();
    this.isSupported = this._checkStorageSupport();

    // Feature 1: Active Garbage Collection
    this.autoClean();
  }

  /**
   * Safely checks if localStorage is available and writable.
   * Handles Safari Incognito mode and restricted iframes.
   */
  _checkStorageSupport() {
    try {
      const testKey = "__ssttl_test__";
      window.localStorage.setItem(testKey, "1");
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
    if (typeof ttl === "number") return ttl;
    if (typeof ttl !== "string") return null;

    const match = ttl.match(/^(\d+)([smhd])$/);
    if (!match) return null;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case "s":
        return value * 1000;
      case "m":
        return value * 60 * 1000;
      case "h":
        return value * 60 * 60 * 1000;
      case "d":
        return value * 24 * 60 * 60 * 1000;
      default:
        return null;
    }
  }

  set(key, value, ttl = null) {
    const prefixedKey = this.prefix + key;
    const ttlMs = this._parseTime(ttl);
    const expiry = ttlMs ? Date.now() + ttlMs : null;

    const record = { value, expiry };

    if (this.isSupported) {
      try {
        window.localStorage.setItem(prefixedKey, JSON.stringify(record));
        return;
      } catch (error) {
        // Fallback: localStorage might be full (QuotaExceededError)
        console.warn(
          "localStorage write failed, falling back to memory.",
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

    return record.value;
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
}
