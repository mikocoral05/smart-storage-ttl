export interface SmartStorageLogger {
  warn?: (...args: any[]) => void;
  error?: (...args: any[]) => void;
}

export interface SmartStorageOptions {
  /**
   * Type of storage to use.
   * @default 'local'
   */
  storage?: 'local' | 'session';
  /**
   * A unique string to isolate your app's data.
   * @default 'ssttl_'
   */
  prefix?: string;
  /**
   * A unique identifier for the current user. Appended to the prefix to isolate data between multiple accounts on the same device.
   */
  userId?: string | number;
  /**
   * If true, data will be obfuscated using Base64 encoding.
   * @default false
   */
  encrypt?: boolean;
  /**
   * If true, data will be minified with LZW compression to save localStorage space.
   * @default false
   */
  compress?: boolean;
  /**
   * Maximum number of items to store. When exceeded, the oldest items are evicted (LRU).
   * Set to 0 for no size limit.
   * @default 0
   */
  maxSize?: number;
  /**
   * If true, changes in other tabs will be synced and trigger 'change' events.
   * @default false
   */
  crossTabSync?: boolean;
  /**
   * Automatically serialize and deserialize Set and Map data structures.
   * @default false
   */
  autoSerialize?: boolean;
  /**
   * Custom logger object to handle warnings and errors. Set to `false` to disable logging.
   * @default console
   */
  logger?: SmartStorageLogger | false;
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
   * Retrieves a value and immediately removes it from storage (Read and Destroy).
   * @param key The storage key.
   * @param fallback The value to return if the key does not exist or has expired. Defaults to `null`.
   * @returns The stored value, or the fallback.
   */
  pop<T = any>(key: string, fallback?: T | null): T | null;

  /**
   * Asynchronously decrypts a value and immediately removes it from storage.
   * @param key The storage key.
   * @param password The secret passphrase used to decrypt the data.
   * @param fallback The value to return if the key does not exist, has expired, or fails decryption.
   * @returns The stored value, or the fallback.
   */
  popSecure<T = any>(
    key: string,
    password: string,
    fallback?: T | null,
  ): Promise<T | null>;

  /**
   * Asynchronously encrypts and saves a value to storage using AES-GCM (Web Crypto API).
   * @param key The storage key.
   * @param value The data to securely store.
   * @param password The secret passphrase used to encrypt the data.
   * @param ttl Time-To-Live. Accepts formats like '30s', '15m', '2h', '1d', or raw milliseconds.
   */
  setSecure(
    key: string,
    value: any,
    password: string,
    ttl?: string | number | null,
  ): Promise<void>;

  /**
   * Asynchronously decrypts and retrieves a value from storage using AES-GCM.
   * @param key The storage key.
   * @param password The secret passphrase used to decrypt the data.
   * @param fallback The value to return if the key does not exist, has expired, or fails decryption.
   */
  getSecure<T = any>(
    key: string,
    password: string,
    fallback?: T | null,
  ): Promise<T | null>;

  /**
   * Checks if a specific key exists and is not expired.
   * @param key The storage key.
   * @returns True if the key exists and is valid, false otherwise.
   */
  has(key: string): boolean;

  /**
   * Retrieves all non-expired, unprefixed keys currently managed by this storage instance.
   * @returns An array of keys.
   */
  keys(): string[];

  /**
   * Calculates the approximate size (in bytes) of all data currently stored in this namespace.
   * @returns The size in bytes.
   */
  getSize(): number;

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

  /**
   * Connects this storage instance to a cross-origin IFrame or Window via a secure postMessage bridge.
   * @param targetWindow The window to sync with (e.g., `iframe.contentWindow` or `window.parent`).
   * @param targetOrigin The allowed origin for security. Defaults to `'*'`.
   */
  syncWithWindow(targetWindow: Window, targetOrigin?: string): void;

  /**
   * Subscribes to events.
   * @param eventName The name of the event to listen to.
   * @param callback The function to call when the event fires.
   */
  on(
    eventName: 'evict',
    callback: (key: string, reason: 'ttl' | 'lru') => void,
  ): void;
  /**
   * Subscribes to events.
   * @param eventName The name of the event to listen to.
   * @param callback The function to call when the event fires.
   */
  on(
    eventName: 'change',
    callback: (key: string, newValue: any, oldValue: any) => void,
  ): void;

  /**
   * Unsubscribes from an event.
   * @param eventName The name of the event.
   * @param callback The callback function to remove.
   */
  off(
    eventName: 'evict',
    callback: (key: string, reason: 'ttl' | 'lru') => void,
  ): void;
  /**
   * Unsubscribes from an event.
   * @param eventName The name of the event.
   * @param callback The callback function to remove.
   */
  off(
    eventName: 'change',
    callback: (key: string, newValue: any, oldValue: any) => void,
  ): void;

  /**
   * Removes all event listeners and cleans up resources.
   */
  dispose(): void;
}
