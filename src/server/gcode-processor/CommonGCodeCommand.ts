/**
 * @file CommonGCodeCommand.ts
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
 * PERFORMANCE NOTES
 *
 * Various approaches were tried and benchmarked. The final outcome performs well without
 * having a complex "hand-optimized" implementation. Always benchmark, as regex performance
 * can often be counter-intuitive.
 *
 */

export interface CommonGCodeCommand {
	/** The command letter, such as 'G' or 'T'. Always normalized to upper case. */
	readonly letter: string;
	/** The command value, such as '1' for 'G1'. Note that G0 and G1 are normalized to value '1' for easier conditional handling. */
	readonly value: string;
	readonly x?: string;
	readonly y?: string;
	readonly e?: string;
	readonly z?: string;
	readonly f?: string;
	readonly i?: string;
	readonly j?: string;
}

const rxG01 =
	/^\s*G\s*[01](?=\D)(?:(?:(?:\s*X\s*([+-]?[\d.]+))|(?=[^;]*?(?:X\s*([+-]?[\d.]+)))|)(?:(?:\s*Y\s*([+-]?[\d.]+))|(?=[^;]*?(?:Y\s*([+-]?[\d.]+)))|)(?:(?:\s*E\s*([+-]?[\d.]+))|(?=[^;]*?(?:E\s*([+-]?[\d.]+)))|)(?:(?:\s*Z\s*([+-]?[\d.]+))|(?=[^;]*?(?:Z\s*([+-]?[\d.]+)))|)(?:(?:\s*F\s*([+-]?[\d.]+))|(?=[^;]*?(?:F\s*([+-]?[\d.]+)))|))/i;

const rxG23 =
	/^\s*G\s*([23])(?=\D)(?:(?:(?:\s*X([+-]?[\d.]+))|(?=[^;]*?(?:X([+-]?[\d.]+)))|)(?:(?:\s*Y([+-]?[\d.]+))|(?=[^;]*?(?:Y([+-]?[\d.]+)))|)(?:(?:\s*I([+-]?[\d.]+))|(?=[^;]*?(?:I([+-]?[\d.]+)))|)(?:(?:\s*J([+-]?[\d.]+))|(?=[^;]*?(?:J([+-]?[\d.]+)))|)(?:(?:\s*E([+-]?[\d.]+))|(?=[^;]*?(?:E([+-]?[\d.]+)))|)(?:(?:\s*Z([+-]?[\d.]+))|(?=[^;]*?(?:Z([+-]?[\d.]+)))|)(?:(?:\s*F([+-]?[\d.]+))|(?=[^;]*?(?:F([+-]?[\d.]+)))|))/i;

const rxT = /^\s*T\s*(\d+)/i;

/**
 * Parses a single G-Code command line, parsing only commands and arguments known to be of interest during analysis.
 * This method is not intended to handle multi-line text. Some flexibility in G-code format is supported,
 * to cover typical hand-coded gcode that might occur in custom gcode blocks, but this is *not* a full-
 * featured parser, and less common gcode features are not supported. This is a performance trade-off
 * given that we expect to parse gcode from a proscribed set of slicers.
 *
 * Note: the set of parsed arguments is not exhaustive. There may be additional unparsed arguments. Bear
 * this in mind if you need to mutate a line in-place.
 */
export function parseCommonGCodeCommandLine(line: string): CommonGCodeCommand | null {
	// Various approaches were analysed for performance (see gcode_match_benchmarks.bench.ts). This approach
	// has a simple implementation, decent performance and is more accommodating of format variations than
	// some other approaches benchmarked.
	// Note that the "obvious optimisation" of inspecting the first (and second) char codes of line and branching
	// was less performant for the most common G0/G1 case.

	rxG01.lastIndex = 0;
	let m = rxG01.exec(line);
	if (m) {
		return {
			letter: 'G',
			value: '1',
			x: m[1] ?? m[2],
			y: m[3] ?? m[4],
			e: m[5] ?? m[6],
			z: m[7] ?? m[8],
			f: m[9] ?? m[10],
		};
	}

	rxG23.lastIndex = 0;
	m = rxG23.exec(line);
	if (m) {
		return {
			letter: 'G',
			value: m[1],
			x: m[2] ?? m[3],
			y: m[4] ?? m[5],
			i: m[6] ?? m[7],
			j: m[8] ?? m[9],
			e: m[10] ?? m[11],
			z: m[12] ?? m[13],
			f: m[14] ?? m[15],
		};
	}

	rxT.lastIndex = 0;
	m = rxT.exec(line);
	if (m) {
		return {
			letter: 'T',
			value: m[1],
		};
	}

	return null;
}
