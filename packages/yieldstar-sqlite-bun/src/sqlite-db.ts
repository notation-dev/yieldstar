import { mkdir } from "node:fs/promises";
import { dirname } from "path";
import { Database } from "bun:sqlite";

export async function createSqliteDb(path: string) {
  const dirPath = dirname(path);
  await mkdir(dirPath, { recursive: true });
  return new Database(path, { create: true });
}
