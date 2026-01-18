/**
 * Forja Configuration - Next.js Example
 *
 * Updated to use new integrated auth system (no more auth plugin!)
 */

import { defineConfig } from "forja-core";
import { JsonAdapter } from "forja-adapter-json";
import { UploadPlugin, LocalStorageProvider } from "forja-plugin-upload";
import { HooksPlugin } from "forja-plugin-hooks";

// Import schema definitions
import { userSchema } from "./src/schemas/user.schema";
import { topicSchema } from "./src/schemas/topic.schema";
import { commentSchema } from "./src/schemas/comment.schema";
import { likeSchema } from "./src/schemas/like.schema";
import { ForjaConfig } from "forja-types";
import { ApiPlugin } from "forja-api";

export default defineConfig(() => {
  const config: ForjaConfig = {
    adapter: new JsonAdapter({
      root: "./data",
    }),

    schemas: [userSchema, topicSchema, commentSchema, likeSchema],

    plugins: [
      new ApiPlugin({
        enabled: true,
        prefix: "/api",
      }),
      new HooksPlugin(), // Initialize hooks first
      new UploadPlugin({
        provider: new LocalStorageProvider({
          basePath: process.env.UPLOAD_DIR || "./public/uploads",
          baseUrl: process.env.UPLOAD_URL || "http://localhost:3000/uploads",
          ensureDirectory: true,
        }),
        validation: {
          maxSize: 5 * 1024 * 1024, // 5MB
          minSize: 1024, // 1KB
          allowedMimeTypes: [
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
            "image/svg+xml",
            "application/pdf",
          ],
          allowedExtensions: ["jpg", "jpeg", "png", "gif", "webp", "svg", "pdf"],
        },
        enableLogging: process.env.NODE_ENV === "development",
      }),
    ],

    /**
     * Migration configuration
     */
    migration: {
      auto: process.env.NODE_ENV === "development",
      directory: "./migrations",
    },

    /**
     * Development options
     */
    dev: {
      logging: process.env.NODE_ENV === "development",
      validateQueries: process.env.NODE_ENV === "development",
      prettyErrors: process.env.NODE_ENV === "development",
    },
  };
  return config;
});
