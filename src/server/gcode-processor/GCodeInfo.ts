/**
 * @file GCodeInfo.ts
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

import { SemVer } from 'semver';
import fsReader from '@/server/helpers/fs-reader.js';
import util from 'node:util';
import { AnalysisResult } from '@/server/gcode-processor/AnalysisResult';
import { GCodeFlavour } from '@/server/gcode-processor/GCodeFlavour';

const fsReaderGetLines = util.promisify(fsReader) as (path: string, lines: number) => Promise<string>;

/** Serialized characteristics of a G-code file, typically determined from the header lines of the file. */
export interface SerializedGcodeInfo {
	isProcessed: boolean;
	generator: string;
	generatorVersion: string;
	flavour: string;
	generatorTimestamp: string;
	ratosDialectVersion?: string;
	postProcessorVersion?: string;
	postProcessorTimestamp?: string;
	processedForIdex?: boolean | 'unknown';
	/** If a file has been processed, by a compatible version, the result of analysing the file. */
	analysisResult?: AnalysisResult;
}

export type GCodeInfo = Readonly<MutableGCodeInfo>;

/** Characteristics of a G-code file, typically determined from the header lines of the file. */
export class MutableGCodeInfo {
	constructor(
		public generator: string,
		public generatorVersion: SemVer,
		public flavour: GCodeFlavour,
		public generatorTimestamp: Date,
		public ratosDialectVersion?: SemVer,
		public postProcessorVersion?: SemVer,
		public postProcessorTimestamp?: Date,
		public analysisResult?: AnalysisResult,
		/** undefined = unprocessed or partially initialized, 0 = legacy PBR footer, 1 = pre-release, 2 = beta transitional version, 3 = adds 'kind' for better zod handling */
		public fileFormatVersion?: number,
		public ratosMetaFileOffset?: number,
		public processedForIdex?: boolean,
	) {}

	/** True when the current {@link MutableGCodeInfo} is associated with a file that has been transformed. */
	public get isProcessed(): boolean {
		// Note:
		// fileFormatVersion is set when parsed from the header of a transformed file,
		// or in GCodeFile.transform when at the end of successful transformation.
		return this.fileFormatVersion !== undefined && this.postProcessorVersion !== undefined;
	}

	public toJSON(): string {
		return JSON.stringify(this.serialize());
	}

	public serialize(): SerializedGcodeInfo {
		return {
			isProcessed: this.isProcessed,
			generator: this.generator,
			generatorVersion: this.generatorVersion.toString(),
			flavour: GCodeFlavour[this.flavour],
			generatorTimestamp: this.generatorTimestamp.toISOString(),
			ratosDialectVersion: this.ratosDialectVersion?.toString(),
			postProcessorVersion: this.postProcessorVersion?.toString(),
			postProcessorTimestamp: this.postProcessorTimestamp?.toISOString(),
			processedForIdex: this.processedForIdex ?? (this.postProcessorVersion ? 'unknown' : undefined),
			analysisResult: this.analysisResult,
		};
	}
}
