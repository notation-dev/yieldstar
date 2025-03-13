import { errorWithOriginalStack } from "./error";

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

  entries(): MapIterator<[K, V]> {
    return this.sourceMap.entries();
  }

  keys(): MapIterator<K> {
    return this.sourceMap.keys();
  }

  values(): MapIterator<V> {
    return this.sourceMap.values();
  }

  forEach(
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: any
  ): void {
    return this.sourceMap.forEach(callbackfn, thisArg);
  }

  [Symbol.iterator](): MapIterator<[K, V]> {
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
      const error = new Error("Cannot call set on a frozen map");
      throw errorWithOriginalStack(error, this.set);
    }
    return super.set(key, value);
  }

  delete(key: K): boolean {
    if (this.frozen) {
      const error = new Error("Cannot call delete on a frozen map");
      throw errorWithOriginalStack(error, this.delete);
    }
    return super.delete(key);
  }

  clear(): void {
    if (this.frozen) {
      const error = new Error("Cannot call clear on a frozen map");
      throw errorWithOriginalStack(error, this.clear);
    }
    return super.clear();
  }
}
