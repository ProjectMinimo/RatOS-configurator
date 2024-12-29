/**
 * @file gcode-processor.ts
 * @description Public API of the RatOS gcode post-processor.
 *
 * @author Tom Glastonbury <t@tg73.net>
 * @license MIT
 * @copyright 2024
 *
 * THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
 * INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
 * PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
 * TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
 * USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

/**
 * NOTE: Incomplete, API requirements to be determined.
 */

import { existsSync } from 'node:fs';
import { access, constants, stat } from 'node:fs/promises';
import path from 'node:path';
import progress from 'progress-stream';
import { Transform } from 'node:stream';
import { SerializedGcodeInfo } from '@/server/gcode-processor/GCodeInfo';
import { GCodeFile } from '@/server/gcode-processor/GCodeFile';
import { Printability } from '@/server/gcode-processor/Printability';
import { GeneratorIdentificationNotFound } from '@/server/gcode-processor/errors';
import { GCodeFlavour } from '@/server/gcode-processor/GCodeFlavour';
import { WarningCodes } from '@/server/gcode-processor/WarningCodes';

export const PROGRESS_STREAM_SPEED_STABILIZATION_TIME = 3;

type ProcessorResult = SerializedGcodeInfo & {
	wasAlreadyProcessed: boolean;
	printability: Printability;
	printabilityReasons?: string[];
	canDeprocess?: boolean;
};

interface CommonOptions {
	idex?: boolean;
	overwrite?: boolean;
	allowUnsupportedSlicerVersions?: boolean;
	onProgress?: (report: progress.Progress) => void;
	onWarning?: (code: string, message: string) => void;
	abortSignal?: AbortSignal;
	/**
	 * If false, GCode files without a recognised header will raise an error. If true, and if
	 * {@link CommonOptions.onWarning} is specified, GCode files without a recognised header
	 * will return a result with printability 'UNKNOWN'.
	 */
	allowUnknownGenerator?: boolean;
	/**
	 * If true, the whole file is examined, and a full {@link AnalysisResult} is built. Otherwise,
	 * a quick analysis is performed, and at most the `gcodeInfo`, `firstMoveX` and `firstMoveY`
	 * fields will be populated.
	 *
	 * Note: this option has no effect when transformation is performed. It only applies when
	 * non-transformative analysis is performed.
	 */
	fullAnalysis?: boolean;
}

interface ProcessOptions extends CommonOptions {
	overwrite?: boolean;
}

interface InspectOptions extends CommonOptions {}

export async function inspectGCode(inputFile: string, options: InspectOptions): Promise<ProcessorResult> {
	const inputStat = await stat(path.resolve(inputFile));

	if (!inputStat.isFile()) {
		throw new Error(`${inputFile} is not a file`);
	}

	const gcfOptions = {
		printerHasIdex: options.idex,
		allowUnsupportedSlicerVersions: options.allowUnsupportedSlicerVersions,
		allowUnknownGenerator: options.allowUnknownGenerator,
		quickInspectionOnly: !options.fullAnalysis,
		abortSignal: options.abortSignal,
		onWarning: options.onWarning,
	};

	let gcf: GCodeFile;

	try {
		gcf = await GCodeFile.inspect(inputFile, gcfOptions);
	} catch (e) {
		if (e instanceof GeneratorIdentificationNotFound && !!options.allowUnknownGenerator && options.onWarning) {
			options.onWarning(
				WarningCodes.UNKNOWN_GCODE_GENERATOR,
				`The file was not produced by a recognised G-Code generator, therefore it cannot be post-processed or analysed, and its suitability for printing cannot be determined.`,
			);
			return {
				flavour: GCodeFlavour[GCodeFlavour.Unknown],
				generator: 'unknown',
				generatorTimestamp: '',
				generatorVersion: '',
				isProcessed: false,
				printability: Printability.UNKNOWN,
				wasAlreadyProcessed: false,
				canDeprocess: false,
				printabilityReasons: [e.message],
			};
		} else {
			throw e;
		}
	}

	if (gcf.printability === Printability.READY && !gcf.info.analysisResult) {
		let progressStream: Transform | undefined;

		if (options.onProgress) {
			progressStream = progress({ length: inputStat.size });
			progressStream.on('progress', options.onProgress);
		}

		return {
			...(await gcf.analyse({ progressTransform: progressStream, ...gcfOptions })).serialize(),
			wasAlreadyProcessed: false,
			printability: gcf.printability,
			printabilityReasons: gcf.printabilityReasons,
			canDeprocess: gcf.canDeprocess,
		};
	} else {
		return {
			...gcf.info.serialize(),
			wasAlreadyProcessed: gcf.info.isProcessed,
			printability: gcf.printability,
			printabilityReasons: gcf.printabilityReasons,
			canDeprocess: gcf.canDeprocess,
		};
	}
}

export async function processGCode(
	inputFile: string,
	outputFile: string,
	options: ProcessOptions,
): Promise<ProcessorResult> {
	const gcfOptions = {
		printerHasIdex: options.idex,
		allowUnsupportedSlicerVersions: options.allowUnsupportedSlicerVersions,
		allowUnknownGenerator: options.allowUnknownGenerator,
		quickInspectionOnly: !options.fullAnalysis,
		abortSignal: options.abortSignal,
		onWarning: options.onWarning,
	};

	const inputStat = await stat(path.resolve(inputFile));
	const outPath = path.resolve(path.dirname(outputFile));
	if (!inputStat.isFile()) {
		throw new Error(`${inputFile} is not a file`);
	}

	let gcf: GCodeFile;

	try {
		gcf = await GCodeFile.inspect(inputFile, gcfOptions);
	} catch (e) {
		if (e instanceof GeneratorIdentificationNotFound && !!options.allowUnknownGenerator && options.onWarning) {
			options.onWarning(
				WarningCodes.UNKNOWN_GCODE_GENERATOR,
				`The file was not produced by a recognised G-Code generator, therefore it cannot be post-processed or analysed, and its suitability for printing cannot be determined.`,
			);
			return {
				flavour: GCodeFlavour[GCodeFlavour.Unknown],
				generator: 'unknown',
				generatorTimestamp: '',
				generatorVersion: '',
				isProcessed: false,
				printability: Printability.UNKNOWN,
				wasAlreadyProcessed: false,
				canDeprocess: false,
				printabilityReasons: [e.message],
			};
		} else {
			throw e;
		}
	}

	if (gcf.printability === Printability.READY && !gcf.info.analysisResult) {
		let progressStream: Transform | undefined;

		if (options.onProgress) {
			progressStream = progress({ length: inputStat.size });
			progressStream.on('progress', options.onProgress);
		}

		return {
			...(await gcf.analyse({ progressTransform: progressStream, ...gcfOptions })).serialize(),
			wasAlreadyProcessed: false,
			printability: gcf.printability,
			printabilityReasons: gcf.printabilityReasons,
			canDeprocess: gcf.canDeprocess,
		};
	} else if (gcf.printability !== Printability.MUST_PROCESS) {
		return {
			...gcf.info.serialize(),
			wasAlreadyProcessed: gcf.info.isProcessed,
			printability: gcf.printability,
			printabilityReasons: gcf.printabilityReasons,
			canDeprocess: gcf.canDeprocess,
		};
	}

	try {
		await access(outPath, constants.W_OK);
	} catch (e) {
		throw new Error(`${outPath} is not a writable directory`);
	}
	if (existsSync(path.resolve(outputFile)) && !options.overwrite) {
		throw new Error(`${outputFile} already exists`);
	}

	let progressStream: Transform | undefined;

	if (options.onProgress) {
		progressStream = progress({ length: inputStat.size, speed: PROGRESS_STREAM_SPEED_STABILIZATION_TIME });
		progressStream.on('progress', options.onProgress);
	}

	return {
		...(await gcf.transform(outputFile, { progressTransform: progressStream, ...gcfOptions })).serialize(),
		wasAlreadyProcessed: false,
		printability: Printability.READY,
	};
}
