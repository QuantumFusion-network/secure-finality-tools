export async function waitForSecureUpTo(
  palletAnchor: any,
  targetBlock: number,
): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const unsub = await palletAnchor.secureUpTo(async (upTo: any) => {
        const n = upTo?.toNumber ? upTo.toNumber() : Number(upTo);
        if (Number.isFinite(n) && n >= targetBlock) {
          unsub();
          resolve();
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}
