/**
 * @file Printablility.ts
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

/**
 * Describes how a gcode file is printable or not. {@link Printability} is not concerned with the method of reprocessing:
 * it might be possible to de-process then re-process an existing processed file (see {@link GCodeFile.canDeprocess}), or it
 * might be necessary for the user to supply the unprocessed file to be processed again.
 *
 * NOTE: Printability does not concern itself with a "must analyse" concept: when inspecting for non-IDEX printing,
 * we know that *transformation* (aka, processing) is not required. The file can be used as-is, and so is READY. However,
 * if the consumer wants to know some info like the first XY position, they should check if {@link GCodeFile.info.analysisResult}
 * is defined, and invoke {@link GCodeFile.analyse} if required.
 */

export enum Printability {
	/** Applies to headerless GCode when `allowUnknownGenerator` is true. The printability of such files cannot be determined. */
	UNKNOWN = 'UNKNOWN',
	/** The file is not supported: (re)processing won't help. For example, an unsupported slicer version. When applicable, see {@link GCodeFile.printabilityReasons}. */
	NOT_SUPPORTED = 'NOT_SUPPORTED',
	/** The file is not supported: (re)processing won't help. File was processed by an obsolete or future version of the RatOS postprocessor. */
	PROCESSOR_NOT_SUPPORTED = 'PROCESSOR_NOT_SUPPORTED',
	/** The file is not processed yet, and must be processed before it can be printed. */
	MUST_PROCESS = 'MUST_PROCESS',
	/** The file can be printed as-is. There would be no benefit to (re)processing. */
	READY = 'READY',
	/** The already-processed file can be printed as-is, but there could be some benefit to reprocessing. */
	COULD_REPROCESS = 'COULD_REPROCESS',
	/** The already-processed file cannot be printed as-is, and must be reprocessed. */
	MUST_REPROCESS = 'MUST_REPROCESS',
}
