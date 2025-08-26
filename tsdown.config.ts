import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	dts: false, // FIXME: broken .d.ts generation
	entry: ["./client/*.tsx", "./server/*.ts"],
	format: ["esm"],
	hash: false,
	platform: "neutral",
	sourcemap: true,
});
