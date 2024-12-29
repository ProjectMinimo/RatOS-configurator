/**
 * @file GCodeFile.ts
 * @description
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

import semver, { SemVer } from 'semver';
import { GCodeError, InternalError, GeneratorIdentificationNotFound } from '@/server/gcode-processor/errors';
import date2 from 'date-and-time';
import fsReader from '@/server/helpers/fs-reader.js';
import util from 'node:util';
import fastChunkString from '@shelf/fast-chunk-string';
import { GCodeInfo, MutableGCodeInfo } from '@/server/gcode-processor/GCodeInfo';
import { GCodeFlavour } from '@/server/gcode-processor/GCodeFlavour';
import { GCodeProcessor, GCodeProcessorOptions, InspectionIsComplete } from '@/server/gcode-processor/GCodeProcessor';
import { Readable, Transform } from 'stream';
import { FileHandle, open } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import split from 'split2';
import {
	BookmarkingBufferEncoder,
	replaceBookmarkedGcodeLine,
} from '@/server/gcode-processor/BookmarkingBufferEncoder';
import { getPostProcessorVersion } from '@/server/gcode-processor/Version';
import { validateGenerator } from '@/server/gcode-processor/Actions';
import { WarningCodes } from '@/server/gcode-processor/WarningCodes';
import { AssertionError } from 'node:assert';
import { AnalysisResult, AnalysisResultKind, AnalysisResultSchema } from '@/server/gcode-processor/AnalysisResult';
import { Printability } from '@/server/gcode-processor/Printability';
import { NullSink } from '@/server/gcode-processor/NullSink';
import { PartialToNullableRequired, strictWithDefaults } from '@/utils/object-manipulation';

function assert(condition: any, message?: string): asserts condition {
	if (!condition) {
		throw new AssertionError({ message });
	}
}

/**
 * GCode File Metadata
 * -------------------
 *
 * We add metadata in two locations:
 *
 * 1. The "Processed by" header line. This is added as the first line in the processed file. Example:
 *
 * 		; processed by RatOS 2.0.2-598-g1b6c63fa on 2024-11-07 at 15:08:23 UTC
 *
 *    The header line allows us to detect already-processed data during a streaming read (eg, processing
 *    during upload). The data values are considered informative only, versus the ratos_meta block which
 *    is considered authoritative.
 *
 * 2. The ratos_meta block. This is added at the end of the file. It comprises a 'begin' line, one or
 *    more lines of base64 data, and an 'end' line. The base64 data encodes the JSON serialization of
 *    a GCodeInfo object. This data is considered authoritative.
 *
 */

export type TransformOptions = { progressTransform?: Transform } & Pick<
	GCodeProcessorOptions,
	'abortSignal' | 'allowUnsupportedSlicerVersions' | 'onWarning' | 'printerHasIdex'
>;

export type AnalyseOptions = { progressTransform?: Transform } & GCodeProcessorOptions;

export type InspectOptions = Pick<
	GCodeProcessorOptions,
	'onWarning' | 'allowUnsupportedSlicerVersions' | 'printerHasIdex'
>;

const defaultTransformOptions: PartialToNullableRequired<TransformOptions> = {
	abortSignal: null,
	progressTransform: null,
	allowUnsupportedSlicerVersions: null,
	onWarning: null,
	printerHasIdex: null,
};

const defaultAnalyseOptions: PartialToNullableRequired<AnalyseOptions> = {
	abortSignal: null,
	progressTransform: null,
	allowUnsupportedSlicerVersions: null,
	onWarning: null,
	printerHasIdex: null,
	quickInspectionOnly: null,
};

const defaultInspectOptions: PartialToNullableRequired<InspectOptions> = {
	allowUnsupportedSlicerVersions: null,
	onWarning: null,
	printerHasIdex: null,
};

const fsReaderGetLines = util.promisify(fsReader) as (path: string, lines: number) => Promise<string>;

/** Match a block like:
 *
 * ; ratos_meta begin 1234
 * ; iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAGeUlEQVR4Ad1bW08bRxjd31CpskjSPK
 * ; ratos_meta end 99
 *
 * Where 1234 is the number of base64 characters expected, and 99 is the count of lines
 * of base64 data. (NB: the above example does not have valid counts)
 */
const rxRatosMeta = /(?:^; ratos_meta begin (\d+)\n(.*))?\n; ratos_meta end (\d+)$/ms;

const rxGeneratorHeader =
	/^; generated (by|with) (?<GENERATOR>[^\s]+) (?<VERSION>[^\s]+) (in RatOS dialect (?<RATOS_DIALECT_VERSION>[^\s]+) )?on (?<DATE>[^\s]+) at (?<TIME>.*)$/im;

const rxProcessedByRatosHeaderPreV3 =
	/^; processed by RatOS (?<VERSION>[^\s]+) on (?<DATE>[^\s]+) at (?<TIME>\d\d:\d\d:\d\d(?:Z| UTC))/im;

const rxProcessedByRatosHeaderV3 =
	/^; processed by RatOS\.PostProcessor (?<VERSION>[^\s]+) on (?<DATE>[^\s]+) at (?<TIME>\d\d:\d\d:\d\d(?:Z| UTC))(?: v:(?<V>3) m:(?<M>[\da-fA-F]+)(?<IDEX> idex)?)?(?:$|\s)/im;

function coerceSemVerOrThrow(version: string | undefined, message: string): SemVer | undefined {
	if (version === undefined) {
		return undefined;
	}
	const sv = semver.coerce(version);
	if (sv === null) {
		throw new GCodeError(message);
	}
	return sv;
}

export class GCodeFile {
	private static readonly FILE_FORMAT_VERSION = 3;

	/** The placeholder version used to represent files transformed by the legacy ratos.py post processor. */
	public static readonly LEGACY_RATOS_VERSION = new SemVer('0.1.0-legacy');

	private constructor(
		public readonly path: string,
		public readonly info: GCodeInfo,
		public readonly printability: Printability,
		/** Can the file be deprocessed, which would allow reprocessing without re-uploading? Only defined for files that are already processed. */
		public readonly canDeprocess?: boolean,
		/** When available, one or more reasons explaining {@link printability}. */
		public readonly printabilityReasons?: string[],
	) {}

	private static getRatosMetaFooter(analysisResult: AnalysisResult): string {
		const b64 = Buffer.from(JSON.stringify(analysisResult)).toString('base64');
		const chunks = fastChunkString(b64, { size: 78, unicodeAware: false });
		return `\n; ratos_meta begin ${b64.length}\n; ${chunks.join('\n; ')}\n; ratos_meta end ${chunks.length}`;
	}

	/** Factory. Returns GCodeFile with valid `info` or throws if the file header can't be parsed etc. */
	public static async inspect(path: string, options: InspectOptions): Promise<GCodeFile> {
		// Sanitise options to remove any extra properties that might be present at runtime.
		options = strictWithDefaults(options, defaultInspectOptions);
		const onWarning = options?.onWarning;
		const header = await fsReaderGetLines(path, 4);
		const gci = GCodeFile.tryParseHeader(header);

		if (!gci) {
			throw new GeneratorIdentificationNotFound();
		}

		if (gci.fileFormatVersion === undefined) {
			const tail = await fsReaderGetLines(path, -3);
			if (/^; processed by RatOS($|\s)/im.test(tail)) {
				gci.postProcessorVersion = GCodeFile.LEGACY_RATOS_VERSION;
				gci.fileFormatVersion = 0;
			}
		}

		const reasons: string[] = [];
		let printability: Printability | undefined;

		if (!options.allowUnsupportedSlicerVersions) {
			try {
				validateGenerator(gci, false);
			} catch (e) {
				if (e instanceof Error) {
					reasons.push(e.message);
				}
			}
		}

		if (gci.fileFormatVersion !== undefined) {
			// NB: In the future, we might make more effort to read older file layouts. For now, we don't.
			if (gci.fileFormatVersion < GCodeFile.FILE_FORMAT_VERSION) {
				printability = Printability.PROCESSOR_NOT_SUPPORTED;
				reasons.push(
					'The file format is from an old version of RatOS which is no longer supported. The original file must be re-uploaded or re-sliced.',
				);
			} else if (gci.fileFormatVersion > GCodeFile.FILE_FORMAT_VERSION) {
				printability = Printability.PROCESSOR_NOT_SUPPORTED;
				reasons.push(
					'The file format is from a newer version of RatOS. Update RatOS, or re-upload or re-slice the original file.',
				);
			}
		}

		if (reasons.length > 0) {
			return new GCodeFile(path, gci, printability ?? Printability.NOT_SUPPORTED, undefined, reasons);
		}

		const currentVersion = await getPostProcessorVersion();

		if (gci.isProcessed) {
			if (gci.processedForIdex !== !!options.printerHasIdex) {
				switch (gci.processedForIdex) {
					case true:
						reasons.push('The file was processed for a printer with IDEX, but the current printer does not have IDEX.');
						break;
					case false:
						reasons.push('The file was processed for a printer without IDEX, but the current printer has IDEX.');
						break;
					default:
						reasons.push('It cannot be determined if the file was processed for a printer with IDEX or not.');
						break;
				}
				printability = Printability.MUST_REPROCESS;
			} else {
				assert(gci.postProcessorVersion);
				if (semver.eq(currentVersion, gci.postProcessorVersion)) {
					printability = Printability.READY;
				} else if (semver.lt(currentVersion, gci.postProcessorVersion)) {
					reasons.push(
						'The file was processed by a more recent version of RatOS than the installed version. Either update RatOS, or the file must be reprocessed.',
					);
					printability = Printability.MUST_REPROCESS;
				} else if (currentVersion.major > gci.postProcessorVersion.major) {
					reasons.push(
						'There have been significant incompatible changes to RatOS gcode handling since the file was last processed.',
					);
					printability = Printability.MUST_REPROCESS;
				} else {
					reasons.push(
						currentVersion.minor === gci.postProcessorVersion.minor
							? 'There have been bug fixes since the file was last processed.'
							: 'There have been enhancements and/or bug fixes since the file was last processed.',
					);
					printability = Printability.COULD_REPROCESS;
				}
			}
		} else {
			// Currently we only need to transform for IDEX.
			printability = !!options.printerHasIdex ? Printability.MUST_PROCESS : Printability.READY;
		}

		// NB: gci.ratosMetaFileOffset is set but not used yet. The code below is transitional and will be replaced.

		if (gci.isProcessed) {
			var tail = await fsReaderGetLines(path, -100);

			rxRatosMeta.lastIndex = 0;
			var match = rxRatosMeta.exec(tail);

			if (match && match[3] && !match[1]) {
				// Found end marker but not start. The end marker has a line count hint.
				// Load more this time, try to match again.
				tail = await fsReaderGetLines(path, -(102 + Number(match[3])));

				rxRatosMeta.lastIndex = 0;
				match = rxRatosMeta.exec(tail);
			}

			if (match) {
				if (match[3] && !match[1]) {
					onWarning?.(
						WarningCodes.INVALID_METADATA,
						'Failed to parse ratos_meta block: the begin marker was not found.',
					);
				} else {
					const expectedBase64CharCount = Number(match[1]);
					const base64str = match[2].replaceAll(/[;\s]/g, '');
					if (base64str.length != expectedBase64CharCount) {
						onWarning?.(
							WarningCodes.INVALID_METADATA,
							`Failed to parse ratos_meta block: expected ${expectedBase64CharCount} base64 characters, but found ${base64str.length}.`,
						);
					} else {
						const jsonStr = Buffer.from(base64str, 'base64').toString('utf-8');
						// TODO: Versioning
						// Fix up recently-added 'kind' field. There must be a cleaner way to do this...
						const obj = JSON.parse(jsonStr);

						if (obj.kind === undefined) {
							obj.kind = obj.minX === undefined ? AnalysisResultKind.Quick : AnalysisResultKind.Full;
						}

						gci.analysisResult = AnalysisResultSchema.parse(obj);
					}
				}
			} else {
				onWarning?.(WarningCodes.INVALID_METADATA, 'The ratos_meta block was not found.');
			}
		}

		return new GCodeFile(path, gci, printability, gci.isProcessed ? false : undefined, reasons);
	}

	/** If the current file is already processed by the current GCodeHandling version, throws; otherwise, inputFile will be deprocessed on the fly (if already processed) and (re)transformed. */
	public async transform(outputFile: string, options: TransformOptions): Promise<GCodeInfo> {
		// Sanitise options to remove any extra properties that might be present at runtime.
		options = strictWithDefaults(options, defaultTransformOptions);
		let fh: FileHandle | undefined;
		const gcodeProcessor = new GCodeProcessor(options);
		const encoder = new BookmarkingBufferEncoder(undefined, undefined, options.abortSignal);

		try {
			try {
				fh = await open(outputFile, 'w');
				if (options.progressTransform) {
					await pipeline(
						createReadStream(this.path),
						options.progressTransform,
						split(),
						gcodeProcessor,
						encoder,
						createWriteStream('|notused|', { fd: fh.fd, highWaterMark: 256 * 1024, autoClose: false }),
					);
				} else {
					await pipeline(
						createReadStream(this.path),
						split(),
						gcodeProcessor,
						encoder,
						createWriteStream('|notused|', { fd: fh.fd, highWaterMark: 256 * 1024, autoClose: false }),
					);
				}
			} catch (e) {
				if (!(e instanceof InspectionIsComplete)) {
					throw e;
				}
			}

			const s = await fh!.stat();

			const gci = await gcodeProcessor.finalizeProcessing({
				bookmarks: encoder,
				replaceLine: (bm, line) => replaceBookmarkedGcodeLine(fh!, bm, line),
				getProcessedByRatosHeader: (currentCodeVersion, timestamp) =>
					GCodeFile.getProcessedByRatosHeader({
						currentCodeVersion,
						timestamp,
						ratosMetaFileOffset: s.size,
						processedForIdex: !!options.printerHasIdex,
					}),
			});

			if (!gci.analysisResult) {
				throw new InternalError('finalizeProcessing did not set analysisResult.');
			}

			await fh!.write(GCodeFile.getRatosMetaFooter(gci.analysisResult));

			gci.processedForIdex = !!options.printerHasIdex;
			gci.fileFormatVersion = GCodeFile.FILE_FORMAT_VERSION;

			return gci;
		} finally {
			try {
				await fh?.close();
			} catch {}
		}
	}

	/** If the current file is already processed by the current GCodeHandling version, returns inputFile.info; otherwise, inputFile will be unprocessed on the fly (if already processed) and (re)analysed. */
	public async analyse(options: AnalyseOptions): Promise<GCodeInfo> {
		// Sanitise options to remove any extra properties that might be present at runtime.
		options = strictWithDefaults(options, defaultAnalyseOptions);
		const gcodeProcessor = new GCodeProcessor(options);

		try {
			if (options.progressTransform) {
				await pipeline(
					createReadStream(this.path),
					options.progressTransform,
					split(),
					gcodeProcessor,
					new NullSink({ objectMode: true }),
				);
			} else {
				await pipeline(createReadStream(this.path), split(), gcodeProcessor, new NullSink({ objectMode: true }));
			}
		} catch (e) {
			if (!(e instanceof InspectionIsComplete)) {
				throw e;
			}
		}

		const gci = await gcodeProcessor.finalizeProcessing();

		if (!gci.analysisResult) {
			throw new InternalError('finalizeProcessing did not set analysisResult.');
		}

		gci.processedForIdex = !!options.printerHasIdex;

		return gci;
	}

	/** Reads the file line by line. If the file has already been processed, it will be de-processed on the fly. */
	private readDeprocessedLines(progress?: Transform): Readable {
		throw 'todo';
	}

	/**
	 * Parses header (top of file) comments. This method will not detect files already processed by the legacy Python-based post processor.
	 * @param header One or more newline-separated lines from the start of a gcode file. Normally, at least the first three lines should be provided.
	 */
	static tryParseHeader(header: string): MutableGCodeInfo | null {
		rxGeneratorHeader.lastIndex = 0;
		let match = rxGeneratorHeader.exec(header);

		if (match) {
			let flavour = GCodeFlavour.Unknown;
			let ratosDialectVersion: string | undefined = undefined;

			switch (match.groups?.GENERATOR?.toLowerCase()) {
				case 'prusaslicer':
					flavour = GCodeFlavour.PrusaSlicer;
					break;
				case 'orcaslicer':
					flavour = GCodeFlavour.OrcaSlicer;
					break;
				case 'superslicer':
					flavour = GCodeFlavour.SuperSlicer;
					break;
				default:
					if (match.groups?.RATOS_DIALECT_VERSION) {
						flavour = GCodeFlavour.RatOS;
						ratosDialectVersion = match.groups?.RATOS_DIALECT_VERSION;
					}
					break;
			}

			let pbrVersion: SemVer | undefined;
			let pbrTimestamp: Date | undefined;
			let pbrFileFormatVersion: number | undefined;
			let pbrRatosMetaFileOffset: number | undefined;
			let pbrIdex: boolean | undefined;

			rxProcessedByRatosHeaderV3.lastIndex = 0;
			const pbrMatch = rxProcessedByRatosHeaderV3.exec(header);

			if (pbrMatch) {
				pbrVersion = coerceSemVerOrThrow(
					pbrMatch?.groups?.VERSION,
					'The processed by RatOS version is not a valid SemVer.',
				);
				pbrTimestamp = new Date(pbrMatch.groups?.DATE + ' ' + pbrMatch.groups?.TIME);
				pbrFileFormatVersion = pbrMatch.groups?.V ? Number(pbrMatch.groups?.V) : 1;
				pbrRatosMetaFileOffset = pbrMatch.groups?.M ? parseInt(pbrMatch.groups?.M, 16) : undefined;
				pbrIdex = pbrMatch.groups?.V ? !!pbrMatch.groups?.IDEX : undefined;
			} else {
				// Match files processed during initial development prior to firming up format V3. Such files will always be
				// treated as unsupported.
				rxProcessedByRatosHeaderPreV3.lastIndex = 0;
				const pbrMatch = rxProcessedByRatosHeaderPreV3.exec(header);

				if (pbrMatch) {
					pbrVersion = coerceSemVerOrThrow(
						pbrMatch?.groups?.VERSION,
						'The processed by RatOS version is not a valid SemVer.',
					);
					pbrTimestamp = new Date(pbrMatch.groups?.DATE + ' ' + pbrMatch.groups?.TIME);
					pbrFileFormatVersion = 1;
				}
			}

			return new MutableGCodeInfo(
				match.groups?.GENERATOR!,
				coerceSemVerOrThrow(match.groups?.VERSION!, 'The generator version is not a valid SemVer.')!,
				flavour,
				new Date(match.groups?.DATE + ' ' + match.groups?.TIME),
				coerceSemVerOrThrow(ratosDialectVersion, 'The RatOS dialect version is not a valid SemVer.'),
				pbrVersion,
				pbrTimestamp,
				undefined,
				pbrFileFormatVersion,
				pbrRatosMetaFileOffset,
				pbrIdex,
			);
		}

		return null;
	}

	/** Gets the 'Processed by RatOS' header for the current code version. */
	public static getProcessedByRatosHeader(args: {
		currentCodeVersion: semver.SemVer;
		timestamp: Date;
		ratosMetaFileOffset: number;
		processedForIdex: boolean;
	}): string {
		return `; processed by RatOS.PostProcessor ${args.currentCodeVersion.toString()} on ${date2.format(args.timestamp, 'YYYY-MM-DD [at] HH:mm:ss [UTC]', true)} v:${GCodeFile.FILE_FORMAT_VERSION} m:${args.ratosMetaFileOffset.toString(16)}${args.processedForIdex ? ' idex' : ''}`;
	}
}
