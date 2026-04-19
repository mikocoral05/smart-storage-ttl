import {
  ref,
  watch,
  onMounted,
  onScopeDispose,
  getCurrentScope,
  nextTick,
} from 'vue';

/**
 * A Vue 3 Composable for seamless integration with smart-storage-ttl.
 *
 * @param {Object} storageInstance The SmartStorage instance to use.
 * @param {string} key The storage key.
 * @param {*} initialValue The fallback/initial value to use if the key is missing or expired.
 * @param {string|number|null} [ttl=null] Time-To-Live for new values. Accepts formats like '30s', '15m', '2h', '1d', or raw milliseconds.
 * @returns {[import('vue').Ref<*>, Function, Function]} An array containing the reactive state, a remover, and a keys() getter.
 */
export function useSmartStorage(
  storageInstance,
  key,
  initialValue,
  ttl = null,
) {
  // Initialize reactive state
  const state = ref(initialValue);

  // onMounted only runs on the client, safely hydrating the state.
  onMounted(() => {
    state.value = storageInstance.get(key, initialValue);
  });

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
      nextTick(() => {
        isUpdatingFromStorage = false;
      });
    }
  };

  storageInstance.on('change', handleStorageChange);

  if (getCurrentScope()) {
    onScopeDispose(() => {
      storageInstance.off('change', handleStorageChange);
    });
  }

  const removeValue = () => {
    isUpdatingFromStorage = true;
    storageInstance.remove(key);
    state.value = initialValue;
    nextTick(() => {
      isUpdatingFromStorage = false;
    });
  };

  const getKeys = () => storageInstance.keys();

  return [state, removeValue, getKeys];
}

/**
 * An asynchronous Vue 3 Composable for secure, AES-GCM encrypted integration with smart-storage-ttl.
 *
 * @param {Object} storageInstance The SmartStorage instance to use.
 * @param {string} key The storage key.
 * @param {string} password The secret passphrase used to encrypt and decrypt the data.
 * @param {*} initialValue The fallback/initial value to use if the key is missing or fails decryption.
 * @param {string|number|null} [ttl=null] Time-To-Live for new values. Accepts formats like '30s', '15m', '2h', '1d', or raw milliseconds.
 * @returns {[import('vue').Ref<*>, Function, Function, import('vue').Ref<boolean>]} An array containing the reactive state, a remover, a keys() getter, and an isLoading ref.
 */
export function useSecureStorage(
  storageInstance,
  key,
  password,
  initialValue,
  ttl = null,
) {
  const state = ref(initialValue);
  const isLoading = ref(true);
  let isUpdatingFromStorage = false;

  const fetchSecure = () => {
    isLoading.value = true;
    storageInstance.getSecure(key, password, initialValue).then((val) => {
      isUpdatingFromStorage = true;
      state.value = val;
      nextTick(() => {
        isUpdatingFromStorage = false;
      });
      isLoading.value = false;
    });
  };

  onMounted(() => {
    fetchSecure();
  });

  watch(
    state,
    (newValue) => {
      if (!isUpdatingFromStorage) {
        storageInstance.setSecure(key, newValue, password, ttl);
      }
    },
    { deep: true },
  );

  const handleStorageChange = (changedKey) => {
    if (changedKey === key) fetchSecure();
  };

  storageInstance.on('change', handleStorageChange);
  if (getCurrentScope())
    onScopeDispose(() => storageInstance.off('change', handleStorageChange));

  const removeValue = () => {
    isUpdatingFromStorage = true;
    storageInstance.remove(key);
    state.value = initialValue;
    nextTick(() => {
      isUpdatingFromStorage = false;
    });
  };
  const getKeys = () => storageInstance.keys();

  return [state, removeValue, getKeys, isLoading];
}
