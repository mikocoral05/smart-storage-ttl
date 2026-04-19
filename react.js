import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * A React Hook for seamless integration with smart-storage-ttl.
 *
 * @param {Object} storageInstance The SmartStorage instance to use.
 * @param {string} key The storage key.
 * @param {*} initialValue The fallback/initial value to use if the key is missing or expired.
 * @param {string|number|null} [ttl=null] Time-To-Live for new values. Accepts formats like '30s', '15m', '2h', '1d', or raw milliseconds.
 * @returns {[*, Function, Function, Function]} An array containing the stored value, a setter, a remover, and a keys() getter.
 */
export function useSmartStorage(
  storageInstance,
  key,
  initialValue,
  ttl = null,
) {
  // Initialize state with the value from storage, or the fallback
  const [storedValue, setStoredValue] = useState(initialValue);

  // Store initialValue in a ref to prevent infinite useEffect churn if the developer passes an unmemoized object
  const fallbackRef = useRef(initialValue);
  useEffect(() => {
    fallbackRef.current = initialValue;
  }, [initialValue]);

  // This effect runs only on the client, after the initial render,
  // to safely hydrate the state from the browser's storage.
  useEffect(() => {
    setStoredValue(storageInstance.get(key, fallbackRef.current));
  }, [key, storageInstance]);

  // Wrapped setter function that persists to storage and updates state
  const setValue = useCallback(
    (value) => {
      setStoredValue((prevValue) => {
        // Allow passing a function to setValue, just like native useState
        const valueToStore =
          value instanceof Function ? value(prevValue) : value;
        storageInstance.set(key, valueToStore, ttl);
        return valueToStore;
      });
    },
    [key, storageInstance, ttl],
  );

  // Remove the key from storage and reset state to initial value
  const removeValue = useCallback(() => {
    storageInstance.remove(key);
    setStoredValue(fallbackRef.current);
  }, [key, storageInstance]);

  // Retrieve all non-expired keys for this storage namespace
  const getKeys = useCallback(() => storageInstance.keys(), [storageInstance]);

  // Listen for cross-tab changes if crossTabSync is enabled
  useEffect(() => {
    const handleStorageChange = (changedKey, newValue) => {
      if (changedKey === key) {
        setStoredValue(newValue !== null ? newValue : fallbackRef.current);
      }
    };

    storageInstance.on('change', handleStorageChange);

    return () => {
      storageInstance.off('change', handleStorageChange);
    };
  }, [key, storageInstance]);

  return [storedValue, setValue, removeValue, getKeys];
}

/**
 * An asynchronous React Hook for secure, AES-GCM encrypted integration with smart-storage-ttl.
 *
 * @param {Object} storageInstance The SmartStorage instance to use.
 * @param {string} key The storage key.
 * @param {string} password The secret passphrase used to encrypt and decrypt the data.
 * @param {*} initialValue The fallback/initial value to use if the key is missing or fails decryption.
 * @param {string|number|null} [ttl=null] Time-To-Live for new values. Accepts formats like '30s', '15m', '2h', '1d', or raw milliseconds.
 * @returns {[*, Function, Function, boolean]} An array containing the stored value, an async setter, a remover, and an isLoading boolean.
 */
export function useSecureStorage(
  storageInstance,
  key,
  password,
  initialValue,
  ttl = null,
) {
  const [storedValue, setStoredValue] = useState(initialValue);
  const [isLoading, setIsLoading] = useState(true);

  const fallbackRef = useRef(initialValue);
  useEffect(() => {
    fallbackRef.current = initialValue;
  }, [initialValue]);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);
    storageInstance
      .getSecure(key, password, fallbackRef.current)
      .then((val) => {
        if (isMounted) {
          setStoredValue(val);
          setIsLoading(false);
        }
      });

    // Refetch and decrypt automatically when data changes in another tab
    const handleStorageChange = (changedKey) => {
      if (changedKey === key && isMounted) {
        setIsLoading(true);
        storageInstance
          .getSecure(key, password, fallbackRef.current)
          .then((val) => {
            if (isMounted) {
              setStoredValue(val);
              setIsLoading(false);
            }
          });
      }
    };

    storageInstance.on('change', handleStorageChange);

    return () => {
      isMounted = false;
      storageInstance.off('change', handleStorageChange);
    };
  }, [key, password, storageInstance]);

  const setValue = useCallback(
    async (value) => {
      const valueToStore =
        value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore); // Optimistic UI update
      await storageInstance.setSecure(key, valueToStore, password, ttl);
    },
    [key, password, storageInstance, ttl, storedValue],
  );

  const removeValue = useCallback(() => {
    storageInstance.remove(key);
    setStoredValue(fallbackRef.current);
  }, [key, storageInstance]);

  return [storedValue, setValue, removeValue, isLoading];
}
