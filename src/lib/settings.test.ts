import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { resetDb } from "../../test/db-helpers";
import {
  getAllSettings,
  getMaxChainCallsPerMinute,
  getSetting,
  getSystemPrompt,
  getTickIntervalSeconds,
  setSetting,
} from "./settings";

vi.mock("@/db");

beforeEach(async () => {
  await resetDb();
});

describe("getSetting", () => {
  it("returns the stored value when present", async () => {
    await setSetting("tick_interval_seconds", "42");
    expect(await getSetting("tick_interval_seconds")).toBe("42");
  });

  it("falls back to the built-in default when no row exists", async () => {
    expect(await getSetting("max_chain_calls_per_minute")).toBe("10");
    expect(await getSetting("tick_interval_seconds")).toBe("10");
  });

  it("returns null for an unknown key without default", async () => {
    expect(await getSetting("does_not_exist")).toBeNull();
  });
});

describe("setSetting", () => {
  it("inserts a new row", async () => {
    await setSetting("foo", "bar");
    const rows = await db.select().from(settings);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ key: "foo", value: "bar" });
  });

  it("upserts on conflict, keeping a single row per key", async () => {
    await setSetting("foo", "first");
    await setSetting("foo", "second");
    const rows = await db.select().from(settings);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("second");
    expect(await getSetting("foo")).toBe("second");
  });
});

describe("getAllSettings", () => {
  it("returns defaults when the table is empty", async () => {
    const all = await getAllSettings();
    expect(all.max_chain_calls_per_minute).toBe("10");
    expect(all.tick_interval_seconds).toBe("10");
    expect(all.system_prompt).toContain("Kanban-based multi-agent orchestration system");
  });

  it("merges DB rows over defaults, DB wins", async () => {
    await setSetting("tick_interval_seconds", "3");
    await setSetting("custom_key", "custom");
    const all = await getAllSettings();
    expect(all.tick_interval_seconds).toBe("3");
    expect(all.max_chain_calls_per_minute).toBe("10");
    expect(all.custom_key).toBe("custom");
  });
});

describe("getMaxChainCallsPerMinute", () => {
  it("defaults to 10", async () => {
    expect(await getMaxChainCallsPerMinute()).toBe(10);
  });

  it("parses a valid positive number", async () => {
    await setSetting("max_chain_calls_per_minute", "25");
    expect(await getMaxChainCallsPerMinute()).toBe(25);
  });

  it.each(["0", "-3", "abc", ""])("falls back to 10 for invalid value %j", async (val) => {
    await setSetting("max_chain_calls_per_minute", val);
    expect(await getMaxChainCallsPerMinute()).toBe(10);
  });
});

describe("getTickIntervalSeconds", () => {
  it("defaults to 10", async () => {
    expect(await getTickIntervalSeconds()).toBe(10);
  });

  it("accepts the minimum of 1 second", async () => {
    await setSetting("tick_interval_seconds", "1");
    expect(await getTickIntervalSeconds()).toBe(1);
  });

  it("parses a valid value", async () => {
    await setSetting("tick_interval_seconds", "30");
    expect(await getTickIntervalSeconds()).toBe(30);
  });

  it.each(["0.5", "0", "NaN", "nope"])("falls back to 10 for invalid value %j", async (val) => {
    await setSetting("tick_interval_seconds", val);
    expect(await getTickIntervalSeconds()).toBe(10);
  });
});

describe("getSystemPrompt", () => {
  it("returns the default prompt when unset", async () => {
    const prompt = await getSystemPrompt();
    expect(prompt).toContain("You MUST respond with ONLY a valid JSON object");
  });

  it("returns the DB override when set", async () => {
    await setSetting("system_prompt", "custom prompt");
    expect(await getSystemPrompt()).toBe("custom prompt");
  });
});
