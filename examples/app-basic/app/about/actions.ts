"use server";

import { revalidatePath } from "sourceog/cache";

export async function recordAboutVisit(): Promise<{ ok: true }> {
  await revalidatePath("/about");
  return { ok: true };
}

export async function recordAboutVisitViaPolicy(): Promise<{ ok: true }> {
  return { ok: true };
}
