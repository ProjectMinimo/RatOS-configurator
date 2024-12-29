/**
 * @file State.ts
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

import { MutableGCodeInfo } from '@/server/gcode-processor/GCodeInfo';
import { InternalError } from '@/server/gcode-processor/errors';
import { BookmarkKey } from '@/server/gcode-processor/Bookmark';
import { CommonGCodeCommand } from '@/server/gcode-processor/CommonGCodeCommand';

export class BookmarkedLine {
	constructor(
		public readonly line: string,
		public readonly bookmark: BookmarkKey,
	) {}
}

/**
 * The state shared between actions in the action sequence for RatOS G-code post processing.
 * Property naming convention:
 *  * `k` prefix: external configuration. Always readonly.
 *  * `_` prefix: iteration-scope state that gets reset for each line
 *  * no prefix: G-code file-scope state that is maintained for the whole file
 */
export class State {
	constructor(
		public readonly kPrinterHasIdex: boolean,
		public readonly kQuickInpsectionOnly: boolean,
		public readonly kAllowUnsupportedSlicerVersions: boolean,
		public readonly onWarning?: (code: string, message: string) => void,
	) {}

	// Stream-scope fields:
	public currentLineNumber: number = -1;
	public firstLine?: BookmarkedLine;
	public startPrintLine?: BookmarkedLine;
	public onLayerChange2Line?: BookmarkedLine;
	public extruderTempLines?: BookmarkedLine[];
	public extruderTemps?: string[];
	public toolChangeCount = 0;
	public firstMoveX?: string;
	public firstMoveY?: string;
	public minX = Number.MAX_VALUE;
	public maxX = Number.MIN_VALUE;
	public hasPurgeTower?: boolean;
	public configSection?: Map<string, string>;
	public processingHasBeenFinalized = false;

	/** Used tools, in order of first use. */
	public usedTools: string[] = [];

	// Iteration-scope fields (reset at the start of each processLine iteration):
	public _cmd?: CommonGCodeCommand | null;

	/**
	 * Resets iteration-scope state.
	 */
	resetIterationState() {
		this._cmd = undefined;
	}

	#gcodeInfo?: MutableGCodeInfo;

	/**
	 * `gcodeInfo` is always set near the start of processing and is accessed frequently
	 * so provide a non-optional accessor for convenience.
	 */
	get gcodeInfo(): MutableGCodeInfo {
		if (!this.#gcodeInfo) {
			throw new InternalError('gcodeInfo has not been set yet.');
		}
		return this.#gcodeInfo;
	}

	set gcodeInfo(value: MutableGCodeInfo) {
		this.#gcodeInfo = value;
	}

	get gcodeInfoOrUndefined(): MutableGCodeInfo | undefined {
		return this.#gcodeInfo;
	}

	get configSectionAsObject():
		| {
				[key: string]: string;
		  }
		| undefined {
		const configSectionEntries = this.configSection?.entries();
		return configSectionEntries ? Object.fromEntries(configSectionEntries) : undefined;
	}
}
