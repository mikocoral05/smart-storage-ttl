import { useState, useEffect, useCallback } from 'react';

export function useSmartStorage(
  storageInstance,
  key,
  initialValue,
  ttl = null,
) {
  // Initialize state with the value from storage, or the fallback
  const [storedValue, setStoredValue] = useState(() => {
    return storageInstance.get(key, initialValue);
  });

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
    setStoredValue(initialValue);
  }, [key, storageInstance, initialValue]);

  // Listen for cross-tab changes if crossTabSync is enabled
  useEffect(() => {
    const handleStorageChange = (changedKey, newValue) => {
      if (changedKey === key) {
        setStoredValue(newValue !== null ? newValue : initialValue);
      }
    };

    storageInstance.on('change', handleStorageChange);

    return () => {
      storageInstance.off('change', handleStorageChange);
    };
  }, [key, storageInstance, initialValue]);

  return [storedValue, setValue, removeValue];
}
