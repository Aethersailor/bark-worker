export async function timingSafeStringEqual(
  actual: string | null | undefined,
  expected: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual ?? "")),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);

  if (actual === null || actual === undefined) {
    return false;
  }

  if (typeof crypto.subtle.timingSafeEqual === "function") {
    return crypto.subtle.timingSafeEqual(actualHash, expectedHash);
  }

  const actualBytes = new Uint8Array(actualHash);
  const expectedBytes = new Uint8Array(expectedHash);
  let difference = 0;
  for (let index = 0; index < actualBytes.length; index++) {
    difference |= actualBytes[index] ^ expectedBytes[index];
  }
  return difference === 0;
}
