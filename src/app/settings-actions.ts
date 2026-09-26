"use server";

import { revalidatePath } from "next/cache";
import { getAllSettings, setSetting } from "@/lib/settings";
import { tickEngine } from "@/lib/ticker";

export async function getSettings(): Promise<Record<string, string>> {
  return getAllSettings();
}

export async function updateSetting(key: string, value: string): Promise<void> {
  await setSetting(key, value);
  revalidatePath("/settings");
}

export async function toggleTick(): Promise<boolean> {
  if (tickEngine.isRunning()) {
    tickEngine.stop();
  } else {
    await tickEngine.start();
  }
  revalidatePath("/");
  return tickEngine.isRunning();
}

export async function getTickRunning(): Promise<boolean> {
  return tickEngine.isRunning();
}

export async function getTickState(): Promise<{
  running: boolean;
  nextTickAt: number | null;
}> {
  return {
    running: tickEngine.isRunning(),
    nextTickAt: tickEngine.getNextTickAt(),
  };
}
