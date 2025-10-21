export function supportsBroadcastChannel() {
  if (!("BroadcastChannel" in globalThis)) return false;
  try {
    const bc = new BroadcastChannel("__bc_test__");
    bc.close();
    return true;
  } catch {
    return false;
  }
}
