import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	dts: { build: true },
	entry: ["./client/*.tsx", "./server/*.ts"],
	format: ["esm"],
	hash: false,
	platform: "neutral",
	sourcemap: true,
});
