/**
 * @file GCodeProcessor.ts
 * @description The RatOS gcode post-processor.
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

import {
	ActionResult,
	ActionSequence,
	executeActionSequence,
	subSequence,
} from '@/server/gcode-processor/ActionSequence';
import { BookmarkCollection } from '@/server/gcode-processor/BookmarkingBufferEncoder';
import { Bookmark } from '@/server/gcode-processor/Bookmark';
import { ProcessLineContext, SlidingWindowLineProcessor } from '@/server/gcode-processor/SlidingWindowLineProcessor';
import { GCodeProcessorError, InternalError } from '@/server/gcode-processor/errors';
import { GCodeInfo, MutableGCodeInfo } from '@/server/gcode-processor/GCodeInfo';
import { GCodeFlavour } from '@/server/gcode-processor/GCodeFlavour';
import { State } from '@/server/gcode-processor/State';
import { exactlyOneBitSet } from '@/server/gcode-processor/helpers';
import { Action, ActionFilter, REMOVED_BY_RATOS } from '@/server/gcode-processor/Actions';
import * as act from '@/server/gcode-processor/Actions';
import semver, { SemVer } from 'semver';
import { ANALYSIS_RESULT_VERSION, AnalysisResultKind } from '@/server/gcode-processor/AnalysisResult';
import { getPostProcessorVersion } from '@/server/gcode-processor/Version';

export class InspectionIsComplete extends Error {}

export interface GCodeProcessorOptions {
	printerHasIdex?: boolean;
	quickInspectionOnly?: boolean;
	allowUnsupportedSlicerVersions?: boolean;
	onWarning?: (code: string, message: string) => void;
	abortSignal?: AbortSignal;
}

export interface FinalizeProcessingOptions {
	bookmarks: BookmarkCollection;
	replaceLine: (bookmark: Bookmark, line: string) => Promise<void>;
	getProcessedByRatosHeader: (currentCodeVersion: SemVer, timestamp: Date) => string;
}

/**
 * Processes a stream of text lines read-forward-once, analysing and transforming on the fly.
 *
 * Analysis is performed using {@link ActionSequence}, which supports state-machine-like behaviour
 * and action sequence short-circuiting.
 *
 * Where the output is streamed to a {@link BookmarkingBufferEncoder} and then to disk, changes to lines that
 * require forward knowledge are speculatively padded with spaces, bookmarked, then retrospectively replaced
 * by random access changes to the output file at the end of streaming.
 **/
export class GCodeProcessor extends SlidingWindowLineProcessor {
	constructor(opts: GCodeProcessorOptions) {
		super(20, 100, opts?.abortSignal);
		this.#state = new State(
			!!opts.printerHasIdex,
			!!opts.quickInspectionOnly,
			!!opts.allowUnsupportedSlicerVersions,
			opts.onWarning,
		);

		// NB: The order of actions is significant.
		this.#actions = !!opts.printerHasIdex
			? [
					act.getGcodeInfo,
					// NB: sequence won't execute past getStartPrint until the START_PRINT line is found.
					act.getStartPrint,
					// NB: sequence won't continue past whenCommonCommandDoThenStop when the current line matches a common command (Tn/G0/G1).
					subSequence(act.whenCommonCommandDoThenStop, [act.findFirstMoveXY, act.findMinMaxX, act.processToolchange]),
					act.fixOtherLayerTemperature,
					act.captureConfigSection,
				]
			: [
					act.getGcodeInfo,
					// NB: sequence won't execute past getStartPrint until the START_PRINT line is found.
					act.getStartPrint,
					// NB: sequence won't continue past whenCommonCommandDoThenStop when the current line matches a common command (Tn/G0/G1).
					subSequence(act.whenCommonCommandDoThenStop, [act.findFirstMoveXY]),
					act.captureConfigSection,
				];
	}

	#state: State;

	// NB: The order of actions is significant.
	#actions: ActionSequence<Action>;

	_processLine(ctx: ProcessLineContext) {
		if (this.#state.processingHasBeenFinalized) {
			throw new InternalError('_processLine was called after processing has been finalized.');
		}
		this.#state.resetIterationState();
		++this.#state.currentLineNumber;

		executeActionSequence(this.#actions, (action: Action) => GCodeProcessor.invokeAction(action, ctx, this.#state));
	}

	// NB: Static for easier unit testing.
	/**
	 * Wraps action invocation with additional {@link GCodeProcessor}-specific convenience logic.
	 *  * The action function can return `ActionResult | void`, where `void` is equivalent to
	 *    {@link ActionResult.Continue}.
	 *  * Some union alternates of the {@link Action} type allow common relevance filters to be
	 *    expressed declaritively (currently by {@link GCodeFlavour}).
	 * */
	private static invokeAction(
		action: Action,
		ctx: ProcessLineContext,
		state: State,
	): ActionResult | [result: ActionResult, replaceWith: Action] {
		if (!Array.isArray(action)) {
			// It's a plain action, no filter.
			let result = action(ctx, state);
			return result === undefined ? ActionResult.Continue : result;
		} else {
			if (state.gcodeInfoOrUndefined === undefined) {
				// Allowing flavour-filtered actions to execute before the flavour is known is considered a
				// design error. An preceding action should return ActionResult.Stop or throw.
				throw new InternalError('Attemted to invoke flavour-filtered action before the flavour is known.');
			} else {
				const keep = this.satisfiesFilter(state.gcodeInfoOrUndefined, action[0]);
				if (keep) {
					const result = action[1](ctx, state);
					// We don't need to evaluate the ActionFilter(s) again (because gcodeInfo never changes),
					// so remove the filter by replacing the action, either with the simple function form, or
					// with the replacement it provided.
					if (Array.isArray(result)) {
						return result;
					} else {
						return [result === undefined ? ActionResult.Continue : result, action[1]];
					}
				} else {
					// Filter is not a match, remove the action.
					return ActionResult.RemoveAndContinue;
				}
			}
		}
	}

	private static satisfiesFilter(gcodeInfo: GCodeInfo, include: ActionFilter | ActionFilter[]): boolean {
		const flat = Array.isArray(include) ? include.flat(Infinity) : [include];

		// Evaluation is 'or' - any criterion matching is success.
		let i = 0;
		while (i < flat.length) {
			const flavour = flat[i] as GCodeFlavour;
			if (flavour == GCodeFlavour.Unknown) {
				throw new InternalError('GCodeFlavour.Unknown must not be used in action filters.');
			}

			if ((flavour & gcodeInfo.flavour) > 0) {
				const semVerRange = flat[i + 1];

				if (typeof semVerRange === 'string') {
					if (!exactlyOneBitSet(flavour)) {
						throw new InternalError(
							'An ActionFilter with semVerRange specified must specify exactly one GCodeFlavour to which the filter applies.',
						);
					}
					if (
						semver.satisfies(
							flavour == GCodeFlavour.RatOS ? gcodeInfo.ratosDialectVersion! : gcodeInfo.generatorVersion!,
							semVerRange,
						)
					) {
						return true;
					}
					++i;
				} else {
					// Simple flavour-only filter has matched.
					return true;
				}
			}
			++i;
		}
		return false;
	}

	/**
	 * Applies all the retrospective changes required after analysing the whole file/stream.
	 */
	async finalizeProcessing(options?: FinalizeProcessingOptions): Promise<MutableGCodeInfo> {
		const s = this.#state;

		if (s.processingHasBeenFinalized) {
			throw new GCodeProcessorError('Processing has already been finalized.');
		}

		if (!s.gcodeInfoOrUndefined) {
			// This is essentially an internal error as it indicates a program logic problem with the caller.
			// This exception will be thrown in the following scenarios:
			// 1. No data has passed through the GCodeProcessor yet.
			// 2. The header indicated that the stream is already processed. This will currently throw an
			//    AlreadyProcessedError, which has a gcodeInfo property for the gcodeInfo parsed from the header.
			//    At present, the higher-level code in gcode-processor.ts only deals with files - no "process during
			//    upload" yet. gcode-processor code only invokes a GCodeProcessor for unprocessed files, so GCodeProcessor
			//    is currently ok to bail when it is given a processed file. However, this will need to be reconsidered
			//    when we implement process during upload.
			// 3. Processing threw an error before the file header was parsed, but the caller still tries to finalize processing.
			throw new GCodeProcessorError(
				'Processing is incomplete and cannot be finalized (the file headers have not been parsed successfully).',
			);
		}

		s.processingHasBeenFinalized = true;

		const currentPPVersion = await getPostProcessorVersion();
		const now = new Date();

		s.gcodeInfo.postProcessorVersion = currentPPVersion;
		s.gcodeInfo.postProcessorTimestamp = now;

		if (s.kQuickInpsectionOnly) {
			// Populate only known-complete data.
			s.gcodeInfo.analysisResult = {
				version: ANALYSIS_RESULT_VERSION,
				kind: AnalysisResultKind.Quick,
				extruderTemps: s.extruderTemps,
				firstMoveX: s.firstMoveX,
				firstMoveY: s.firstMoveY,
				hasPurgeTower: s.hasPurgeTower,
				configSection: s.configSectionAsObject,
			};
		} else {
			s.gcodeInfo.analysisResult = {
				version: ANALYSIS_RESULT_VERSION,
				kind: AnalysisResultKind.Full,
				extruderTemps: s.extruderTemps,
				toolChangeCount: s.toolChangeCount,
				firstMoveX: s.firstMoveX,
				firstMoveY: s.firstMoveY,
				minX: s.minX,
				maxX: s.maxX,
				hasPurgeTower: s.hasPurgeTower,
				configSection: s.configSectionAsObject,
				usedTools: s.usedTools,
			};
		}

		if (!options) {
			// Skip bookmark processing, we're only inspecting.
			return s.gcodeInfo;
		}

		if (s.firstLine) {
			await options.replaceLine(
				options.bookmarks.getBookmark(s.firstLine.bookmark),
				options.getProcessedByRatosHeader(currentPPVersion, now) + '\n' + s.firstLine.line.trimEnd(),
			);
		}

		if (s.startPrintLine) {
			let toAdd = '';

			if (s.toolChangeCount > 0) {
				toAdd += ` TOTAL_TOOLSHIFTS=${s.toolChangeCount - 1}`;
			}

			if (s.firstMoveX && s.firstMoveY) {
				toAdd += ` FIRST_X=${s.firstMoveX} FIRST_Y=${s.firstMoveY}`;
			}

			if (s.minX < Number.MAX_VALUE) {
				toAdd += ` MIN_X=${s.minX} MAX_X=${s.maxX}`;
			}

			if (s.usedTools.length > 0) {
				toAdd += ` USED_TOOLS=${s.usedTools.join()}`;
			}

			if (toAdd) {
				await options.replaceLine(
					options.bookmarks.getBookmark(s.startPrintLine.bookmark),
					s.startPrintLine.line.trimEnd() + toAdd,
				);
			}

			toAdd = '';

			if (s.usedTools.length > 0 && s.extruderTemps && s.onLayerChange2Line) {
				for (let tool of s.usedTools) {
					toAdd += `\nM104 S${s.extruderTemps[Number(tool)]} T${tool}`;
				}

				await options.replaceLine(
					options.bookmarks.getBookmark(s.onLayerChange2Line.bookmark),
					s.onLayerChange2Line.line.trimEnd() + toAdd,
				);

				if (s.extruderTempLines) {
					for (let bmLine of s.extruderTempLines) {
						await options.replaceLine(
							options.bookmarks.getBookmark(bmLine.bookmark),
							REMOVED_BY_RATOS + bmLine.line.trimEnd(),
						);
					}
				}
			}
		}

		return s.gcodeInfo;
	}
}
