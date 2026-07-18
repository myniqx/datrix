/**
 * CLI version, inlined from package.json at build time (tsup bundles the
 * JSON import; vitest/tsc resolve it via resolveJsonModule).
 */

import packageJson from "../../package.json";

export const CLI_VERSION: string = packageJson.version;
