import { defineConfig } from "tsdown";

export default defineConfig({
	clean: true,
	dts: {
		sourcemap: true,
	},
	entry: ["./client", "./server"],
	fromVite: true,
	format: "esm",
});
