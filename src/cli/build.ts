import * as esbuild from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import pinoshim from '@/cli/pino-shim';

let wasmPlugin = {
	name: 'wasm',
	setup(build: any) {
		// Resolve ".wasm" files to a path with a namespace
		build.onResolve({ filter: /\.wasm$/ }, (args: any) => {
			// If this is the import inside the stub module, import the
			// binary itself. Put the path in the "wasm-binary" namespace
			// to tell our binary load callback to load the binary file.
			if (args.namespace === 'wasm-stub') {
				return {
					path: args.path,
					namespace: 'wasm-binary',
				};
			}

			// Otherwise, generate the JavaScript stub module for this
			// ".wasm" file. Put it in the "wasm-stub" namespace to tell
			// our stub load callback to fill it with JavaScript.
			//
			// Resolve relative paths to absolute paths here since this
			// resolve callback is given "resolveDir", the directory to
			// resolve imports against.
			if (args.resolveDir === '') {
				return; // Ignore unresolvable paths
			}
			return {
				path: path.isAbsolute(args.path) ? args.path : path.join(args.resolveDir, args.path),
				namespace: 'wasm-stub',
			};
		});

		// Virtual modules in the "wasm-stub" namespace are filled with
		// the JavaScript code for compiling the WebAssembly binary. The
		// binary itself is imported from a second virtual module.
		build.onLoad({ filter: /.*/, namespace: 'wasm-stub' }, async (args: any) => ({
			contents: `import wasm from ${JSON.stringify(args.path)}
        export default (imports) =>
          WebAssembly.instantiate(wasm, imports).then(
            result => result.instance.exports)`,
		}));

		// Virtual modules in the "wasm-binary" namespace contain the
		// actual bytes of the WebAssembly file. This uses esbuild's
		// built-in "binary" loader instead of manually embedding the
		// binary data inside JavaScript code ourselves.
		build.onLoad({ filter: /.*/, namespace: 'wasm-binary' }, async (args: any) => ({
			contents: await fs.promises.readFile(args.path),
			loader: 'binary',
		}));
	},
};

await esbuild.build({
	entryPoints: {
		ratos: 'ratos.tsx',
	},
	bundle: true,
	external: ['zx'],
	platform: 'node',
	outExtension: { '.js': '.mjs' },
	outdir: '../bin',
	target: 'node18',
	format: 'esm',
	inject: ['cjs-shim.ts'],
	plugins: [wasmPlugin, pinoshim({ transports: ['pino-pretty'] })],
});

// await $`mv ../bin/ratos.mjs.js ../bin/ratos.mjs`;
