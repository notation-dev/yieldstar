import { expect, test } from "bun:test";
import { getCallSiteHash } from "../packages/yieldstar/src/internal/utils";

// Mirrors how the step runner uses getCallSiteHash: a synchronous wrapper
// passes itself as the frame to skip, so the first captured frame is the
// caller's call site. The hash is assigned to an outer variable before
// returning so the call cannot be turned into a tail call (JSC's proper tail
// calls would otherwise drop the wrapper's stack frame before
// getCallSiteHash runs). The real step runner is safe for the same reason:
// it uses the hash after computing it.
let lastHash = "";
function step(): string {
  lastHash = getCallSiteHash(step);
  return lastHash;
}

test("two distinct call sites produce different hashes", () => {
  const a = step();
  const b = step();
  expect(a).not.toBe(b);
});

test("the same call site produces the same hash on every execution", () => {
  const hashes = new Set<string>();
  for (let i = 0; i < 5; i++) {
    hashes.add(step());
  }
  expect(hashes.size).toBe(1);
});

test("call sites inside a resumed async generator are captured", async () => {
  // Async generator bodies only execute once .next() is called, from a stack
  // that does not include the original caller – this simulates how workflow
  // functions are driven by the runtime.
  async function* workflow() {
    yield;
    const a = step();
    yield;
    const b = step();
    return [a, b];
  }

  const drive = async () => {
    const iterator = workflow();
    let result = await iterator.next();
    while (!result.done) {
      result = await iterator.next();
    }
    return result.value as string[];
  };

  const [a1, b1] = await drive();
  const [a2, b2] = await drive();

  // distinct call sites -> distinct keys
  expect(a1).not.toBe(b1);
  // same call site -> stable key across executions (replay stability)
  expect(a1).toBe(a2);
  expect(b1).toBe(b2);
});

test("hash is a hex sha1 digest", () => {
  expect(step()).toMatch(/^[0-9a-f]{40}$/);
});
