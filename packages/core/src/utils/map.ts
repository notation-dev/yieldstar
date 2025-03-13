export class ReadOnlyMap<K, V> implements ReadonlyMap<K, V> {
  private sourceMap: Map<K, V>;

  constructor(sourceMap: Map<K, V>) {
    this.sourceMap = sourceMap;
  }

  get(key: K): V | undefined {
    return this.sourceMap.get(key);
  }

  has(key: K): boolean {
    return this.sourceMap.has(key);
  }

  get size(): number {
    return this.sourceMap.size;
  }

  entries(): ReturnType<Map<K, V>["entries"]> {
    return this.sourceMap.entries();
  }

  keys(): ReturnType<Map<K, V>["keys"]> {
    return this.sourceMap.keys();
  }

  values(): ReturnType<Map<K, V>["values"]> {
    return this.sourceMap.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: any
  ): void {
    return this.sourceMap.forEach(callbackfn, thisArg);
  }

  [Symbol.iterator](): ReturnType<Map<K, V>[typeof Symbol.iterator]> {
    return this.sourceMap[Symbol.iterator]();
  }
}

export class FreezableMap<K, V> extends Map<K, V> {
  private frozen = false;

  freeze(): void {
    this.frozen = true;
  }

  isFrozen(): boolean {
    return this.frozen;
  }

  set(key: K, value: V): this {
    if (this.frozen) {
      throw new Error("Cannot call set on a frozen map");
    }
    return super.set(key, value);
  }

  delete(key: K): boolean {
    if (this.frozen) {
      throw new Error("Cannot call delete on a frozen map");
    }
    return super.delete(key);
  }

  clear(): void {
    if (this.frozen) {
      throw new Error("Cannot call clear on a frozen map");
    }
    return super.clear();
  }
}
