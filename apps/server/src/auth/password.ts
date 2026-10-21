import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

/** OWASP's argon2id minimum (19 MiB, 2 passes, 1 lane): ~tens of ms per hash. */
export const ARGON2_PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

function argon2id(
  password: string,
  salt: Buffer,
  params: { memory: number; passes: number; parallelism: number; tagLength: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2("argon2id", { message: password, nonce: salt, ...params }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

const b64 = (b: Buffer) => b.toString("base64").replace(/=+$/, "");

/** A PHC string: `$argon2id$v=19$m=19456,t=2,p=1$<salt>$<hash>` (unpadded base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2id(password, salt, ARGON2_PARAMS);
  const { memory, passes, parallelism } = ARGON2_PARAMS;
  return `$argon2id$v=19$m=${memory},t=${passes},p=${parallelism}$${b64(salt)}$${b64(hash)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** Constant-time check against a stored PHC string; false for anything malformed. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const m = PHC.exec(stored);
  if (!m) return false;
  const [, memory, passes, parallelism, salt, hash] = m;
  const expected = Buffer.from(hash ?? "", "base64");
  const actual = await argon2id(password, Buffer.from(salt ?? "", "base64"), {
    memory: Number(memory),
    passes: Number(passes),
    parallelism: Number(parallelism),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A fixed hash to verify against when the username doesn't exist, so a failed login
 * takes as long either way (no user enumeration by timing).
 */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString("hex"));
  return dummy;
}
