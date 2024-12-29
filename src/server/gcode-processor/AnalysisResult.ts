/**
 * @file AnalysisResult.ts
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

import { z } from 'zod';

export const ANALYSIS_RESULT_VERSION = 1;
type ANALYSIS_RESULT_VERSION = 1;

export enum AnalysisResultKind {
	Full = 'full',
	Quick = 'quick',
}

export interface BaseAnalysisResult {
	readonly version: ANALYSIS_RESULT_VERSION;
	readonly kind: AnalysisResultKind;
}

export interface FullAnalysisResult extends BaseAnalysisResult {
	readonly kind: AnalysisResultKind.Full;
	readonly extruderTemps?: string[];
	readonly toolChangeCount: number;
	readonly firstMoveX?: string;
	readonly firstMoveY?: string;
	readonly minX: number;
	readonly maxX: number;
	readonly hasPurgeTower?: boolean;
	readonly usedTools: string[];
	readonly configSection?: {
		[key: string]: string;
	};
}

export interface QuickAnalysisResult
	extends BaseAnalysisResult,
		Pick<FullAnalysisResult, 'extruderTemps' | 'firstMoveX' | 'firstMoveY' | 'hasPurgeTower' | 'configSection'> {
	readonly kind: AnalysisResultKind.Quick;
}

export type AnalysisResult = FullAnalysisResult | QuickAnalysisResult;

export const AnalysisResultSchema = z.discriminatedUnion('kind', [
	z.object({
		version: z.literal(ANALYSIS_RESULT_VERSION),
		kind: z.literal(AnalysisResultKind.Full),
		extruderTemps: z.array(z.string()).optional(),
		toolChangeCount: z.number(),
		firstMoveX: z.string().optional(),
		firstMoveY: z.string().optional(),
		minX: z.number(),
		maxX: z.number(),
		hasPurgeTower: z.boolean().optional(),
		configSection: z.record(z.string(), z.string()).optional(),
		usedTools: z.array(z.string()),
	}),

	z.object({
		version: z.literal(ANALYSIS_RESULT_VERSION),
		kind: z.literal(AnalysisResultKind.Quick),
		extruderTemps: z.array(z.string()).optional(),
		firstMoveX: z.string().optional(),
		firstMoveY: z.string().optional(),
		hasPurgeTower: z.boolean().optional(),
	}),
]);

export type AnalysisResultSchema = z.infer<typeof AnalysisResultSchema>;
