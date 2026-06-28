import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  // ts-jest needs these to match the tsconfig exactly
  transform: {
    "^.+\\.tsx?$": ["ts-jest", { tsconfig: "tsconfig.json" }],
  },
  // Each test file gets a fresh module registry — important for singleton DB
  resetModules: false,
  // Suppress Next.js server internals
  testPathIgnorePatterns: ["/node_modules/", "/.next/"],
};

export default config;
