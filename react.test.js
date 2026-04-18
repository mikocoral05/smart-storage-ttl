/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { SmartStorage } from './index.js';
import { useSmartStorage } from './react.js';

describe('useSmartStorage Hook', () => {
  let storage;

  beforeEach(() => {
    // jsdom provides a working localStorage, so we just clear it between tests
    window.localStorage.clear();
    storage = new SmartStorage({ prefix: 'test', crossTabSync: true });
  });

  afterEach(() => {
    storage.dispose();
  });

  it('should initialize with fallback if storage is empty', () => {
    const { result } = renderHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );
    expect(result.current[0]).toBe('light');
  });

  it('should initialize with stored value if present in storage', () => {
    storage.set('theme', 'dark');
    const { result } = renderHook(() =>
      useSmartStorage(storage, 'theme', 'light'),
    );
    expect(result.current[0]).toBe('dark');
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
