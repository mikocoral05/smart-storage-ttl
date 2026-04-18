import { ref, watch, onScopeDispose, getCurrentScope } from 'vue';

export function useSmartStorage(
  storageInstance,
  key,
  initialValue,
  ttl = null,
) {
  // Initialize reactive state
  const state = ref(storageInstance.get(key, initialValue));

  // Internal flag to prevent infinite loops when updating from cross-tab events
  let isUpdatingFromStorage = false;

  // Watch for local changes in Vue and sync them to SmartStorage
  watch(
    state,
    (newValue) => {
      if (!isUpdatingFromStorage) {
        storageInstance.set(key, newValue, ttl);
      }
    },
    { deep: true },
  );

  // Listen for cross-tab changes
  const handleStorageChange = (changedKey, newValue) => {
    if (changedKey === key) {
      isUpdatingFromStorage = true;
      state.value = newValue !== null ? newValue : initialValue;
      // Reset the flag immediately after the synchronous Vue update
      isUpdatingFromStorage = false;
    }
  };

  storageInstance.on('change', handleStorageChange);

  if (getCurrentScope()) {
    onScopeDispose(() => {
      storageInstance.off('change', handleStorageChange);
    });
  }

  const removeValue = () => {
    storageInstance.remove(key);
    state.value = initialValue;
  };

  return [state, removeValue];
}
