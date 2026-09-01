interface SubtleCrypto {
  timingSafeEqual(
    first: ArrayBuffer | ArrayBufferView,
    second: ArrayBuffer | ArrayBufferView,
  ): boolean;
}
