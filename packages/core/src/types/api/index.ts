/**
 * API Types
 *
 * Type definitions for the API module.
 *
 * Don't re-export from index.ts! Use these types directly in packages/api.
 */

export * from "./parser";
export * from "./upload";
export * from "./interface";
export * from "./auth";
export * from "./config";

export type ResponseData<T = unknown> = {
	data: T;
	meta: {
		total: number;
		page: number;
		pageSize: number;
		totalPages: number;
	};
};
