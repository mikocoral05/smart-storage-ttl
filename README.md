# 🚀 smart-storage-ttl

A zero-dependency, ultra-lightweight JavaScript library that supercharges the browser's native `localStorage`.

`smart-storage-ttl` introduces intelligent expiration times (TTL), automatic memory cleanup, and smart fallbacks, ensuring your web apps run faster and never leave stale data sitting on a user's device.

## The Problem

Native `localStorage` is great, but it has no concept of expiration. Existing wrapper libraries usually just do one thing: they check if data is expired when you try to read it, and return `null` if it is. That leaves dead data sitting in the user's browser forever, forces you to write boilerplate fallback logic, and crashes entirely if `localStorage` is blocked (like in Safari Incognito mode).

**`smart-storage-ttl` fixes all of this.**

## 📦 Installation

```bash
npm install smart-storage-ttl
```

## ✨ Killer Features

### 1. 🧹 Active Garbage Collection (Auto-Cleanup)

Other libraries only delete expired items if you try to `get()` them. If a user never returns to a specific page, that dead data hogs memory forever.
**Our Solution:** When initialized, `smart-storage-ttl` silently scans local storage and wipes out all expired data immediately, keeping the user's browser perfectly clean.

### 2. 🛡️ Smart Fallbacks (Default Values)

When an item expires, older libraries return `null`, forcing you to write extra `if/else` logic to handle missing data.
**Our Solution:** Pass a fallback value directly into the `get` method. If the data is missing or expired, you get your fallback instantly.

### 3. 🧠 Bulletproof Fallback to Memory

In strict privacy modes (like Safari Private/Incognito) or when the 5MB storage quota is exceeded, native `localStorage` throws fatal errors that crash your app.
**Our Solution:** If `smart-storage-ttl` detects that `localStorage` is blocked or full, it automatically and silently saves the data to a temporary JavaScript `Map` in memory. Your app keeps working perfectly with zero code changes.

### 4. ⏳ Human-Readable Time Formats

Calculating milliseconds in your head is annoying (`86400000` for one day? No thanks).
**Our Solution:** Pass simple string formats like `'1h'`, `'30m'`, or `'2d'`. We do the math for you.

### 5. 📦 Namespace Isolation

Using `localStorage.clear()` wipes out everything—even data saved by other plugins or analytics scripts.
**Our Solution:** Initialize with a `prefix`. If you clear the cache using our library, it _only_ wipes out data belonging to your specific app namespace, leaving everything else untouched.

---

## 🚀 Usage

### Initialization

```javascript
import { SmartStorage } from "smart-storage-ttl";

// Initialize with an optional prefix for namespace isolation
const storage = new SmartStorage({ prefix: "myapp" });
```

_(Note: The moment you instantiate `SmartStorage`, the Active Garbage Collector automatically cleans up any expired keys matching your prefix!)_

### Saving Data (TTL)

Set a key, a value, and an optional Time-To-Live (TTL).

```javascript
// Save forever (standard localStorage behavior)
storage.set("theme", "dark-mode");

// Save for 30 minutes
storage.set("session_token", "xyz123", "30m");

// Save for 2 hours
storage.set("promo_banner", "hidden", "2h");

// Save for 1 day
storage.set("daily_quote", "Hello World", "1d");

// You can still pass exact milliseconds if you prefer!
storage.set("custom", "data", 5000); // 5 seconds
```

### Retrieving Data (Smart Fallbacks)

Get a key and provide an optional fallback value.

```javascript
// Basic retrieval
const token = storage.get("session_token");

// Using Smart Fallbacks (Returns 'light-mode' if 'theme' doesn't exist or expired)
const theme = storage.get("theme", "light-mode");

// Perfect for toggles or modals
const shouldShowPromo = storage.get("promo_banner", "visible");
```

### Removing & Clearing

```javascript
// Remove a specific key
storage.remove("theme");

// Clear ALL keys (But ONLY keys that start with your 'myapp_' prefix!)
storage.clear();
```

---

## ⚙️ API Reference

### `new SmartStorage(options)`

- `options.prefix` _(string)_: A unique string to isolate your app's data. Defaults to `'ssttl_'`.

### `.set(key, value, ttl?)`

- `key` _(string)_: The storage key.
- `value` _(any)_: The data to store (will be serialized via `JSON.stringify`).
- `ttl` _(string | number | null)_: Time-To-Live. Accepts formats like `'30s'`, `'15m'`, `'2h'`, `'1d'`, or raw milliseconds.

### `.get(key, fallback?)`

- `key` _(string)_: The storage key.
- `fallback` _(any)_: The value to return if the key does not exist or has expired. Defaults to `null`.

### `.remove(key)`

- `key` _(string)_: The storage key to delete.

### `.clear()`

- Wipes all items managed by this library instance (matching the configured `prefix`).

## License

ISC
