// Minimal shim for @solana/transaction-messages to prevent SSR crashes in dev/demo.
export function getVersionedTransactionMessage() {
  return {};
}
export function compileTransaction() {
  return {};
}
export const TRANSACTION_MESSAGE_VERSION = 0;

// Additional exports for compatibility (previously used by @fogo/sessions-sdk)
export function createTransactionMessage() {
  return {};
}
export function setTransactionMessageFeePayer() {
  return {};
}
export function setTransactionMessageLifetimeUsingBlockhash() {
  return {};
}
export function appendTransactionMessageInstructions() {
  return {};
}
export function compressTransactionMessageUsingAddressLookupTables() {
  return {};
}

