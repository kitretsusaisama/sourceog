async function loadExplainModule() {
  return import("@sourceog/compiler");
}

export async function explainRoute(cwd: string = process.cwd(), selector: string) {
  const mod = await loadExplainModule();
  return mod.explainRoute(cwd, selector);
}

export async function explainDecision(cwd: string = process.cwd(), selector: string) {
  const mod = await loadExplainModule();
  return mod.explainDecision(cwd, selector);
}
