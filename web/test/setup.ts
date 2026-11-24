// Ensure Node Buffer instances satisfy `instanceof Uint8Array` in jsdom tests
// so @stellar/stellar-sdk's XDR encoder works across realms.
if (typeof Buffer !== "undefined" && !(Buffer.alloc(0) instanceof Uint8Array)) {
  const NodeUint8Array = Object.getPrototypeOf(Buffer.prototype)?.constructor as
    | Uint8ArrayConstructor
    | undefined;
  if (NodeUint8Array) {
    globalThis.Uint8Array = NodeUint8Array;
  }
}
