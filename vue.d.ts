import { Ref } from 'vue';
import { SmartStorage } from './index.js';

/**
 * A Vue 3 Composable for seamless integration with smart-storage-ttl.
 *
 * @param storageInstance The SmartStorage instance to use.
 * @param key The storage key.
 * @param initialValue The fallback/initial value to use if the key is missing or expired.
 * @param ttl Time-To-Live for new values. Accepts formats like '30s', '15m', '2h', '1d', or raw milliseconds.
 */
export function useSmartStorage<T>(
  storageInstance: SmartStorage,
  key: string,
  initialValue: T,
  ttl?: string | number | null,
): [Ref<T>, () => void, () => string[]];

/**
 * An asynchronous Vue 3 Composable for secure, AES-GCM encrypted integration.
 *
 * @param storageInstance The SmartStorage instance to use.
 * @param key The storage key.
 * @param password The secret passphrase used to encrypt and decrypt the data.
 * @param initialValue The fallback/initial value to use if the key is missing or fails decryption.
 * @param ttl Time-To-Live for new values. Accepts formats like '30s', '15m', '2h', '1d', or raw milliseconds.
 */
export function useSecureStorage<T>(
  storageInstance: SmartStorage,
  key: string,
  password: string,
  initialValue: T,
  ttl?: string | number | null,
): [Ref<T>, () => void, () => string[], Ref<boolean>];
