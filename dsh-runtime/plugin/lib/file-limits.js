export const MAX_FILE_BYTES = 100_000_000;
// Base64 file content plus the surrounding command or peer response.
export const MAX_FILE_TRANSFER_BYTES = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 1_000_000;
export const fileSizeLimit = (hosted = !!globalThis.process?.env?.BEES_HOSTED_CLIENT) => hosted ? MAX_FILE_BYTES : Infinity;
export const fileTransferLimit = () => Number.isFinite(fileSizeLimit()) ? MAX_FILE_TRANSFER_BYTES : Infinity;
export const threadFileBytesLimit = () => Number.isFinite(fileSizeLimit()) ? 250_000_000 : Infinity;
export function checkUploadSizes(files, hosted = false) {
  const big = files.find(file => file.size > fileSizeLimit(hosted));
  if (big) throw Error(`${big.name} is over ${MAX_FILE_BYTES / 1_000_000} MB. Files must be ${MAX_FILE_BYTES / 1_000_000} MB or smaller.`);
}
