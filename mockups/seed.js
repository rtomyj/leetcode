// Mockups only: swap localStorage for an in-memory copy so demo data never
// touches your real progress (file:// pages share one storage area).
(() => {
  const mem = {};
  const fake = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; },
  };
  Object.defineProperty(window, "localStorage", { value: fake, configurable: true });
  const D = 86400000, now = Date.now(), at = (d) => new Date(now - d * D).toISOString();
  const ok = (d, m, note) => ({ date: at(d), minutes: m, solved: true, ...(note ? { note } : {}) });
  const bad = (d, m, note) => ({ date: at(d), minutes: m, solved: false, ...(note ? { note } : {}) });
  fake.setItem("nc150-tracker-v1", JSON.stringify({ version: 1, lastExport: now,
    settings: { slowMinutes: { Easy: 15, Medium: 25, Hard: 40 }, sessionSize: 3 },
    problems: {
      "two-sum": { attempts: [ok(30, 8), ok(27, 5), ok(20, 4)] },
      "valid-anagram": { attempts: [ok(25, 6), ok(21, 4)] },
      "group-anagrams": { attempts: [ok(6, 30, "forgot sorted-key trick")] },
      "top-k-frequent-elements": { attempts: [ok(12, 18), ok(8, 14)] },
      "3sum": { attempts: [bad(5, 45), ok(2, 28)] },
      "valid-palindrome": { attempts: [ok(14, 7), ok(10, 5)] },
      "best-time-to-buy-and-sell-stock": { attempts: [ok(9, 9)] },
      "valid-parentheses": { attempts: [ok(4, 6)] },
      "number-of-islands": { attempts: [ok(1, 20)] },
      "lru-cache": { attempts: [bad(10, 40, "dll pointers")] },
      "reverse-linked-list": { attempts: [ok(15, 10), bad(7, 20, "lost the prev pointer")] },
      "coin-change": { attempts: [ok(3, 22)] },
    } }));
})();
