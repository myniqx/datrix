import { DatrixError } from "../types/errors";

type BeforeHookName =
	| "beforeCreate"
	| "beforeUpdate"
	| "beforeDelete"
	| "beforeFind";

type AfterHookName =
	| "afterCreate"
	| "afterUpdate"
	| "afterDelete"
	| "afterFind";

/**
 * Thrown when a before hook returns undefined or null instead of data.
 * This is a programmer error — the hook must always return the (possibly modified) data.
 */
export function throwHookInvalidReturn(hookName: BeforeHookName): never {
	throw new DatrixError(
		`${hookName} hook must return data. Did you forget to return?`,
		{
			code: "HOOK_INVALID_RETURN",
			operation: `dispatcher:schema:${hookName}`,
			suggestion: `Ensure your ${hookName} hook returns the data object (even if unmodified).`,
		},
	);
}

/**
 * Thrown when a plugin's before hook throws an error.
 * Re-throws DatrixErrors as-is; wraps unknown errors.
 */
export function throwHookPluginError(
	pluginName: string,
	hookName: string,
	cause: unknown,
): never {
	if (cause instanceof DatrixError) throw cause;
	throw new DatrixError(
		`Plugin '${pluginName}' threw an error in ${hookName} hook.`,
		{
			code: "HOOK_PLUGIN_ERROR",
			operation: `dispatcher:plugin:${hookName}`,
			cause: cause instanceof Error ? cause : new Error(String(cause)),
		},
	);
}

/**
 * Logs a warning when an after hook throws an error.
 * The operation result is still returned — after hook errors do not abort the response.
 * See docs: after hook errors are non-fatal by design.
 */
export function warnAfterHookError(
	hookName: AfterHookName,
	error: unknown,
): void {
	console.warn(
		`[Datrix] ${hookName} hook threw an error. The operation completed successfully but the hook failed.`,
		error,
	);
}
