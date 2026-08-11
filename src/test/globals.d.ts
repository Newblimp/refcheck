// Ambient declarations for the test environment only.

declare global {
  /**
   * The last Blob handed to `URL.createObjectURL`.
   *
   * The .docx export hands its bytes to a download link through an object URL,
   * so this is the only way a test can read back what was actually exported.
   * jsdom implements neither `createObjectURL` nor `revokeObjectURL`; the stub
   * in `setup.ts` provides both and records the Blob here.
   *
   * This used to be stashed on `URL` itself as an undeclared property, which
   * meant the export tests read a value the type system knew nothing about.
   */
  // eslint-disable-next-line no-var -- `declare global` requires var, not let/const.
  var __lastExportedBlob: Blob | undefined;
}

export {};
