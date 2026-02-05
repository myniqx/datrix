/**
 * Base Storage Provider
 *
 * This file re-exports the StorageProvider interface.
 * NO `any` types, NO type assertions.
 */

export type { StorageProvider, UploadFile, UploadResult } from "../types";

export { UploadError, isStorageProvider } from "../types";
