/**
 * @file massive.test.ts
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

import { GCodeFile } from '@/server/gcode-processor/GCodeFile';
import { describe, test } from 'vitest';

/**
 * To enable this test, rename this file, removing the underscore (massive.test.ts).
 * Don't commit it with the underscore removed!
 *
 * You must update the paths below to suit your local environment and provide
 * a suitable gcode file. To run the test under linux or WSL with memory usage
 * stats etc:
 *
 * `~/RatOS-dev/RatOS-configurator/src$ /usr/bin/time -v pnpm vitest run --no-ui massive`
 *
 */
describe('massive', async () => {
	test('massive', { timeout: 999999999 }, async () => {
		const gci = await GCodeFile.inspect('/mnt/c/dev/ratos-gcode-samples/massive.gcode', {});
		await gci.transform('/mnt/c/dev/ratos-gcode-samples/massive.out.gcode', { printerHasIdex: true });
	});
});
