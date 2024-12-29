/**
 * @file GCodeFlavour.ts
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

/** A known flavour of G-code. */
export enum GCodeFlavour {
	Unknown = 0,

	PrusaSlicer = 1 << 0,
	OrcaSlicer = 1 << 1,
	SuperSlicer = 1 << 2,

	/** Custom-generated G-code, may declare conformance with the RatOS dialect. This is yet to be defined. */
	RatOS = 1 << 3,

	Any = 0xffff,
}
