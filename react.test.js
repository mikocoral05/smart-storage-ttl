/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { webcrypto } from 'node:crypto';
import { SmartStorage } from './index.js';
import { useSmartStorage, useSecureStorage } from './react.js';

describe('useSmartStorage Hook', () => {
  let storage;

  beforeEach(() => {
    // jsdom provides a working localStorage, so we just clear it between tests
    window.localStorage.clear();
    vi.stubGlobal('crypto', webcrypto);
    storage = new SmartStorage({ prefix: 'test', crossTabSync: true });
  });

  afterEach(() => {
    storage.dispose();
    vi.unstubAllGlobals();
  });

  it('should initialize with fallback if storage is empty', () => {
    const { result } = renderHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );
    expect(result.current[0]).toBe('light');
  });

  it('should initialize with stored value after hydration', async () => {
    storage.set('theme', 'dark');
    const { result } = renderHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );

    // Initial render should be the fallback to match the server
    expect(result.current[0]).toBe('light');

    // Wait for the useEffect to run and update the state from localStorage
    await waitFor(() => expect(result.current[0]).toBe('dark'));
  });

  it('should update state and storage when setValue is called', () => {
    const { result } = renderHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );

    act(() => {
      result.current[1]('dark');
    });

    expect(result.current[0]).toBe('dark');
    expect(storage.get('theme')).toBe('dark');
  });

  it('should support functional updates in setValue', () => {
    const { result } = renderHook(() => useSmartStorage(storage, 'count', 0));

    act(() => {
      result.current[1]((prev) => prev + 1);
    });

    expect(result.current[0]).toBe(1);
    expect(storage.get('count')).toBe(1);
  });

  it('should remove value from storage and reset to fallback when removeValue is called', () => {
    storage.set('theme', 'dark');
    const { result } = renderHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );

    act(() => {
      result.current[2](); // Call the remove function
    });

    expect(result.current[0]).toBe('light');
    expect(storage.get('theme', 'light')).toBe('light');
  });

  it('should sync state across tabs when crossTabSync is enabled', () => {
    const { result } = renderHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );

    act(() => {
      // Simulate a native StorageEvent triggered by another browser tab
      const event = new StorageEvent('storage', {
        key: 'test_theme',
        newValue: JSON.stringify({ value: 'blue', expiry: null }),
      });
      window.dispatchEvent(event);
    });

    expect(result.current[0]).toBe('blue');
  });
});

describe('useSecureStorage Hook', () => {
  let storage;

  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal('crypto', webcrypto);
    storage = new SmartStorage({ prefix: 'secure_test', crossTabSync: true });
  });

  afterEach(() => {
    storage.dispose();
    vi.unstubAllGlobals();
  });

  it('should securely store and retrieve data asymmetrically', async () => {
    const { result } = renderHook(() =>
      useSecureStorage(storage, 'api_key', 'my-password', 'default-key'),
    );

    // Initially loading and falling back
    expect(result.current[3]).toBe(true);
    expect(result.current[0]).toBe('default-key');

    // Wait for async decryption
    await waitFor(() => expect(result.current[3]).toBe(false));

    // Set secure value
    await act(async () => {
      await result.current[1]('super-secret-key');
    });

    // Verify state
    expect(result.current[0]).toBe('super-secret-key');

    // Verify local storage is encrypted and not plain text
    const raw = window.localStorage.getItem('secure_test_api_key');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain('super-secret-key');

    // Remove value
    act(() => {
      result.current[2]();
    });
    expect(result.current[0]).toBe('default-key');
    expect(window.localStorage.getItem('secure_test_api_key')).toBeNull();
  });
});
