async function loadInspectModule() {
  return import("@sourceog/compiler");
}

export async function inspectBuildArtifacts(cwd: string = process.cwd()) {
  const mod = await loadInspectModule();
  return mod.inspectBuildArtifacts(cwd);
}

export async function inspectGovernance(cwd: string = process.cwd()) {
  const mod = await loadInspectModule();
  return mod.inspectGovernance(cwd);
}

export async function inspectRoute(cwd: string = process.cwd(), selector: string) {
  const mod = await loadInspectModule();
  return mod.inspectRoute(cwd, selector);
}

export async function inspectGraph(cwd: string = process.cwd(), selector: string) {
  const mod = await loadInspectModule();
  return mod.inspectGraph(cwd, selector);
}

export async function inspectCache(cwd: string = process.cwd(), selector: string = "all") {
  const mod = await loadInspectModule();
  return mod.inspectCache(cwd, selector);
}

export async function inspectAction(cwd: string = process.cwd(), selector: string) {
  const mod = await loadInspectModule();
  return mod.inspectAction(cwd, selector);
}

export async function diffBuildArtifacts(
  cwd: string = process.cwd(),
  compareTarget: string,
) {
  const mod = await loadInspectModule();
  return mod.diffBuildArtifacts(cwd, compareTarget);
}
