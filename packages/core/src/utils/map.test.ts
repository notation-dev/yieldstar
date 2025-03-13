import { expect, test } from "bun:test";
import { ReadOnlyMap, FreezableMap } from "./map";

test("ReadOnlyMap", () => {
  const originalMap = new Map<string, any>();
  originalMap.set("key", "value");

  const readOnlyMap = new ReadOnlyMap(originalMap);

  // Reading should work
  expect(readOnlyMap.get("key")).toBe("value");
  expect(readOnlyMap.has("key")).toBe(true);
  expect(readOnlyMap.size).toBe(1);
  expect(Array.from(readOnlyMap.entries())).toEqual([["key", "value"]]);
  expect(Array.from(readOnlyMap.keys())).toEqual(["key"]);
  expect(Array.from(readOnlyMap.values())).toEqual(["value"]);
  expect(readOnlyMap.forEach).toBeInstanceOf(Function);
  expect(readOnlyMap[Symbol.iterator]).toBeInstanceOf(Function);

  expect("set" in readOnlyMap).toBe(false);
  expect("delete" in readOnlyMap).toBe(false);
  expect("clear" in readOnlyMap).toBe(false);
});

test("FreezableMap", () => {
  const freezableMap = new FreezableMap<string, any>();
  freezableMap.set("key", "value");

  // Before freezing, modifications should work
  expect(freezableMap.get("key")).toBe("value");
  freezableMap.set("key2", "value2");
  expect(freezableMap.get("key2")).toBe("value2");

  // Freeze the map
  freezableMap.freeze();
  expect(freezableMap.isFrozen()).toBe(true);

  // After freezing, modifications should throw
  expect(() => freezableMap.set("key3", "value3")).toThrow(
    "Cannot call set on a frozen map"
  );
  expect(() => freezableMap.delete("key")).toThrow(
    "Cannot call delete on a frozen map"
  );
  expect(() => freezableMap.clear()).toThrow(
    "Cannot call clear on a frozen map"
  );
});
