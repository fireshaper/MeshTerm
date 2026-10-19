import { randomUUID } from "node:crypto";
import { fixtures } from "@meshterm/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseHandle } from "./database.js";
import { insertMessage, listDmMessages } from "./repositories.js";
import { messages } from "./schema.js";
import { openTestDatabase } from "./test-db.js";

let handle: DatabaseHandle;

beforeEach(() => {
  handle = openTestDatabase();
});

afterEach(() => {
  handle.close();
});

const rowCount = () => handle.db.select().from(messages).all().length;

describe("inbound deduplication", () => {
  it("stores a packet once and reports the second copy as a duplicate", () => {
    const first = { ...fixtures.inboundMessage, id: randomUUID() };
    // The rebroadcast decodes to a new message object with a new id.
    const again = { ...first, id: randomUUID(), rxTime: first.rxTime + 4_000, rxSnr: -12 };
    expect(insertMessage(handle.db, first)).toBe("inserted");
    expect(insertMessage(handle.db, again)).toBe("duplicate");
    expect(rowCount()).toBe(1);
    // The stored copy is the first one heard.
    expect(listDmMessages(handle.db, 1, first.peer)[0]?.id).toBe(first.id);
  });

  it("stores the same packet id from a different sender", () => {
    const fromBob = { ...fixtures.inboundMessage, id: randomUUID() };
    const fromCarol = {
      ...fromBob,
      id: randomUUID(),
      fromNum: 0x1a2b3c4d,
      peer: 0x1a2b3c4d,
    };
    expect(insertMessage(handle.db, fromBob)).toBe("inserted");
    expect(insertMessage(handle.db, fromCarol)).toBe("inserted");
    expect(rowCount()).toBe(2);
  });

  it("still rejects a reused message id outright", () => {
    const m = { ...fixtures.inboundMessage, id: randomUUID() };
    insertMessage(handle.db, m);
    expect(() => insertMessage(handle.db, { ...m, packetId: m.packetId + 1 })).toThrow(
      /UNIQUE constraint failed: messages\.id/,
    );
  });
});
