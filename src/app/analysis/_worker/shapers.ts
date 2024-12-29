'use client';
/**
 * Adapted from Dmitry Butyugin <dmbutyugin@google.com> input shaper code in Klipper.
 * This file may be distributed under the terms of the GNU GPLv3 license.
 */
import { shaperDefaults } from '@/app/analysis/_worker/input-shaper';
import { shadableTWColors } from '@/app/_helpers/colors';

export type Shaper = [number[], number[]];

export type ShaperModels = 'zv' | 'mzv' | 'zvd' | 'ei' | '2hump_ei' | '3hump_ei';

export type InputShaperModel = {
	minFreq: number;
	initFunc: (shaperFrequency: number, dampingRatio: number) => Shaper;
	name: ShaperModels;
	color: keyof typeof shadableTWColors;
};

export function inputShaperCfg(
	name: ShaperModels,
	initFunc: (shaperFrequency: number, dampingRatio: number) => Shaper,
	minFreq: number,
	color: keyof typeof shadableTWColors,
): InputShaperModel {
	return { name, initFunc, minFreq, color };
}

export function getNoneShaper(): Shaper {
	return [[], []];
}

export function getZvShaper(shaperFreq: number, dampingRatio: number): Shaper {
	const df = Math.sqrt(1 - dampingRatio ** 2);
	const K = Math.exp((-dampingRatio * Math.PI) / df);
	const tD = 1 / (shaperFreq * df);
	const A = [1, K];
	const T = [0, 0.5 * tD];
	return [A, T];
}

export function getZvdShaper(shaperFreq: number, dampingRatio: number): Shaper {
	const df = Math.sqrt(1 - dampingRatio ** 2);
	const K = Math.exp((-dampingRatio * Math.PI) / df);
	const tD = 1 / (shaperFreq * df);
	const A = [1, 2 * K, K ** 2];
	const T = [0, 0.5 * tD, tD];
	return [A, T];
}

export function getMzvShaper(shaperFreq: number, dampingRatio: number): Shaper {
	const df = Math.sqrt(1 - dampingRatio ** 2);
	const K = Math.exp((-0.75 * dampingRatio * Math.PI) / df);
	const tD = 1 / (shaperFreq * df);

	const a1 = 1 - 1 / Math.sqrt(2);
	const a2 = (Math.sqrt(2) - 1) * K;
	const a3 = a1 * K * K;

	const A = [a1, a2, a3];
	const T = [0, 0.375 * tD, 0.75 * tD];
	return [A, T];
}

export function getEiShaper(shaperFreq: number, dampingRatio: number): Shaper {
	const vTol = 1 / shaperDefaults.SHAPER_VIBRATION_REDUCTION; // vibration tolerance
	const df = Math.sqrt(1 - dampingRatio ** 2);
	const K = Math.exp((-dampingRatio * Math.PI) / df);
	const tD = 1 / (shaperFreq * df);

	const a1 = 0.25 * (1 + vTol);
	const a2 = 0.5 * (1 - vTol) * K;
	const a3 = a1 * K * K;

	const A = [a1, a2, a3];
	const T = [0, 0.5 * tD, tD];
	return [A, T];
}

export function get2HumpEiShaper(shaperFreq: number, dampingRatio: number): Shaper {
	const vTol = 1 / shaperDefaults.SHAPER_VIBRATION_REDUCTION; // vibration tolerance
	const df = Math.sqrt(1 - dampingRatio ** 2);
	const K = Math.exp((-dampingRatio * Math.PI) / df);
	const tD = 1 / (shaperFreq * df);

	const V2 = vTol ** 2;
	const X = Math.pow(V2 * (Math.sqrt(1 - V2) + 1), 1 / 3);
	const a1 = (3 * X * X + 2 * X + 3 * V2) / (16 * X);
	const a2 = (0.5 - a1) * K;
	const a3 = a2 * K;
	const a4 = a1 * K * K * K;

	const A = [a1, a2, a3, a4];
	const T = [0, 0.5 * tD, tD, 1.5 * tD];
	return [A, T];
}

export function get3HumpEiShaper(shaperFreq: number, dampingRatio: number): Shaper {
	const vTol = 1 / shaperDefaults.SHAPER_VIBRATION_REDUCTION; // vibration tolerance
	const df = Math.sqrt(1 - dampingRatio ** 2);
	const K = Math.exp((-dampingRatio * Math.PI) / df);
	const tD = 1 / (shaperFreq * df);

	const K2 = K * K;
	const a1 = 0.0625 * (1 + 3 * vTol + 2 * Math.sqrt(2 * (vTol + 1) * vTol));
	const a2 = 0.25 * (1 - vTol) * K;
	const a3 = (0.5 * (1 + vTol) - 2 * a1) * K2;
	const a4 = a2 * K2;
	const a5 = a1 * K2 * K2;

	const A = [a1, a2, a3, a4, a5];
	const T = [0, 0.5 * tD, tD, 1.5 * tD, 2 * tD];
	return [A, T];
}

export const INPUT_SHAPERS = [
	inputShaperCfg('zv', getZvShaper, 21, 'blue'),
	inputShaperCfg('mzv', getMzvShaper, 23, 'rose'),
	inputShaperCfg('zvd', getZvdShaper, 29, 'lime'),
	inputShaperCfg('ei', getEiShaper, 29, 'amber'),
	inputShaperCfg('2hump_ei', get2HumpEiShaper, 39, 'pink'),
	inputShaperCfg('3hump_ei', get3HumpEiShaper, 48, 'violet'),
];
