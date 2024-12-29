/**
 * @file gcode_match_benchmarks.bench.ts
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

/* eslint-disable no-console */

import { parseCommonGCodeCommandLine } from '@/server/gcode-processor/CommonGCodeCommand';
import { describe, bench } from 'vitest';

/**
 * RUNNING BENCHMARKS:
 *   pnpm vitest bench
 *
 * PERFORMANCE NOTES
 *
 * The biggest performance improvement came from avoiding named groups. Removing named groups roughly doubles
 * performance. Optimizing for an expected order and falling back to lookahead is about 1.4x faster.
 *
 * The returned match array is sized for all possible capturing groups. Exec performance even for obviously
 * quick-matching strings is made worse simply by adding more capturing groups (that are irrelevant for
 * such a quick-matching string). This means, for example, that extending a regex to handle rarely-needed
 * args, even if there is no direct impact on the parsing logic performance for common args, can
 * have a net-negative performance impact.
 */

describe.each([
	{ name: 'empty', gcode: '' },
	{ name: 'empty comment', gcode: ';' },
	{ name: 'comment', gcode: '; blah this is a test' },
	{ name: 'T5', gcode: 'T5' },
	{ name: 'G1 XYE', gcode: 'G1 X234.55 Y257.654 E.01224' },
	{ name: 'G1 ZXYE (vase mode)', gcode: 'G1 Z1.23 X234.55 Y257.654 E.01224' },
	{ name: 'G2 XYIJE', gcode: 'G2 X150.054 Y133.306 I-.867 J16.671 E3.2407' },
	{ name: 'G3 XYIJE', gcode: 'G3 X150.054 Y133.306 I-.867 J16.671 E3.2407' },
])('$name', ({ name, gcode }) => {
	/*
	// https://github.com/cncjs/gcode-parser
	// Flexible, likely correct, handles uncommon comment formats etc, but around 7x slower than other
	// approaches tailored to the formatting we expect/support.
	const parser = require('gcode-parser');

	bench('gcode-parser', () => {
		parser.parseLine(gcode);
	});

	*/

	bench('parseCommonGCodeCommandLine', () => {
		parseCommonGCodeCommandLine(gcode);
	});
});
