export interface SmartStorageOptions {
  /**
   * A unique string to isolate your app's data.
   * @default 'ssttl_'
   */
  prefix?: string;
}

export class SmartStorage {
  /**
   * Initializes a new SmartStorage instance and automatically cleans up expired data.
   * @param options Configuration options for the storage instance.
   */
  constructor(options?: SmartStorageOptions);

  /**
   * Saves a value to storage with an optional Time-To-Live (TTL).
   * @param key The storage key.
   * @param value The data to store (will be serialized via `JSON.stringify`).
   * @param ttl Time-To-Live. Accepts formats like '30s', '15m', '2h', '1d', or raw milliseconds.
   */
  set(key: string, value: any, ttl?: string | number | null): void;

  /**
   * Retrieves a value from storage. Returns the fallback if the item is missing or expired.
   * @param key The storage key.
   * @param fallback The value to return if the key does not exist or has expired. Defaults to `null`.
   * @returns The stored value, or the fallback.
   */
  get<T = any>(key: string, fallback?: T | null): T | null;

  /**
   * Removes a specific key from storage.
   * @param key The storage key to delete.
   */
  remove(key: string): void;

  /**
   * Wipes all items managed by this library instance (matching the configured prefix).
   */
  clear(): void;

  /**
   * Scans and wipes expired data.
   * This is called automatically on initialization, but can be triggered manually.
   */
  autoClean(): void;
}
