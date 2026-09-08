import { customAlphabet } from "nanoid";

// URL/key-safe, lowercase; long enough to avoid collisions in S3 key paths.
const gen = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 20);

/** Generate an id we can use as a Prisma primary key and inside S3 keys. */
export function newId(): string {
  return gen();
}
