'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';

import { useToolheads } from '@/hooks/useToolheadConfiguration';
import { Card } from '@/components/common/card';
import {
	PSDChartMinimumYVisibleRange,
	PSD_CHART_AXIS_AMPLITUDE_ID,
	isXyDataSeries,
	useADXLSignalChart,
	usePSDChart,
} from '@/app/analysis/charts';
import { twJoin } from 'tailwind-merge';
import { SciChartReact } from 'scichart-react';
import { useDynamicAxisRange, useWorker } from '@/app/analysis/hooks';
import {
	EDataSeriesType,
	LineAnimation,
	MountainAnimation,
	NumberRange,
	SciChartSurface,
	XyDataSeries,
	easing,
} from 'scichart';
import { FullLoadScreen } from '@/components/common/full-load-screen';
import { KlipperAccelSubscriptionResponse, MacroRecordingSettings, PSD } from '@/zods/analysis';
import { useRecoilValue } from 'recoil';
import { ControlboardState } from '@/recoil/printer';
import { toast } from 'sonner';
import { getLogger } from '@/app/_helpers/logger';
import { AccelerometerType } from '@/zods/hardware';
import { z } from 'zod';
import { PSDResult } from '@/app/analysis/_worker/psd';
import { LiveGcodeResponse } from '@/components/common/live-gcode-response';

SciChartSurface.configure({
	wasmUrl: '/configure/scichart2d.wasm',
	dataUrl: '/configure/scichart2d.data',
});

export const useRealtimeAnalysisChart = (
	accelerometer?: MacroRecordingSettings['accelerometer'],
	accelerometerType: z.infer<typeof AccelerometerType> = 'adxl345',
) => {
	const [isChartEnabled, _setIsChartEnabled] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const toolheads = useToolheads();
	const controlBoard = useRecoilValue(ControlboardState);
	const adxl = accelerometer ?? toolheads[0].getYAccelerometerName() ?? 'controlboard';
	const adxlHardwareName =
		(adxl === 'controlboard'
			? controlBoard?.name
			: adxl === 'toolboard_t0'
				? toolheads[0]?.getToolboard()?.name
				: adxl === 'toolboard_t1'
					? toolheads[1]?.getToolboard()?.name
					: adxl === 'rpi'
						? 'Raspberry Pi'
						: adxl === 'beacon'
							? 'Beacon'
							: 'N/A') ?? 'N/A';
	const psdChart = usePSDChart();
	const xSignalChart = useADXLSignalChart('x');
	const ySignalChart = useADXLSignalChart('y');
	const zSignalChart = useADXLSignalChart('z');
	const xSignalYAxis = xSignalChart.data.current?.yAxis ?? null;
	const ySignalYAxis = ySignalChart.data.current?.yAxis ?? null;
	const zSignalYAxis = zSignalChart.data.current?.yAxis ?? null;
	const signalAxes = useMemo(
		() => [xSignalYAxis, ySignalYAxis, zSignalYAxis],
		[xSignalYAxis, ySignalYAxis, zSignalYAxis],
	);
	const updateSignalChartRange = useDynamicAxisRange(signalAxes, new NumberRange(-5000, 5000), 1000);

	const psdYAxis = psdChart.surface.current?.yAxes.getById(PSD_CHART_AXIS_AMPLITUDE_ID) ?? null;
	const updatePsdChartRange = useDynamicAxisRange(psdYAxis, PSDChartMinimumYVisibleRange);
	const updateLoadingState = useRef(async (val: boolean) => {});

	const setIsChartEnabled = useCallback(
		async (val: boolean) => {
			_setIsChartEnabled((curVal) => {
				if (curVal === false && val === true) {
					// Reset time since last PSD calculation
					timeSinceLastPsd.current = performance.now();
				}
				return val;
			});
			if (!val) {
				// wait for the stream to stop before animating
				await updateLoadingState.current(val);
			}
			const signalLength = xSignalChart.data.current?.signalData.count() ?? 0;
			const psdLength = psdChart.surface.current?.renderableSeries.getById('total')?.dataSeries.count() ?? 0;
			xSignalChart.data.current?.signalData.clear();
			ySignalChart.data.current?.signalData.clear();
			zSignalChart.data.current?.signalData.clear();
			xSignalChart.data.current?.historyData.clear();
			ySignalChart.data.current?.historyData.clear();
			zSignalChart.data.current?.historyData.clear();
			xSignalChart.data.current?.signalData.appendRange(
				new Array(signalLength).fill(0).map((_, i) => i),
				new Array(signalLength).fill(0),
			);
			ySignalChart.data.current?.signalData.appendRange(
				new Array(signalLength).fill(0).map((_, i) => i),
				new Array(signalLength).fill(0),
			);
			zSignalChart.data.current?.signalData.appendRange(
				new Array(signalLength).fill(0).map((_, i) => i),
				new Array(signalLength).fill(0),
			);
			xSignalChart.surface.current?.invalidateElement();
			ySignalChart.surface.current?.invalidateElement();
			zSignalChart.surface.current?.invalidateElement();
			const animationDS = psdChart.data.current?.animationSeries;
			if (animationDS == null) {
				return;
			}
			animationDS.x.clear();
			animationDS.y.clear();
			animationDS.z.clear();
			animationDS.total.clear();
			animationDS.x.appendRange(
				new Array(psdLength).fill(0).map((_, i) => i * (200 / psdLength)),
				new Array(psdLength).fill(0),
			);
			animationDS.y.appendRange(
				new Array(psdLength).fill(0).map((_, i) => i * (200 / psdLength)),
				new Array(psdLength).fill(0),
			);
			animationDS.z.appendRange(
				new Array(psdLength).fill(0).map((_, i) => i * (200 / psdLength)),
				new Array(psdLength).fill(0),
			);
			animationDS.total.appendRange(
				new Array(psdLength).fill(0).map((_, i) => i * (200 / psdLength)),
				new Array(psdLength).fill(0),
			);
			psdChart.surface.current?.renderableSeries.getById('x')?.runAnimation(
				new LineAnimation({
					duration: 200,
					ease: easing.inOutQuad,
					dataSeries: animationDS.x,
				}),
			);
			psdChart.surface.current?.renderableSeries.getById('y')?.runAnimation(
				new LineAnimation({
					duration: 200,
					ease: easing.inOutQuad,
					dataSeries: animationDS.y,
				}),
			);
			psdChart.surface.current?.renderableSeries.getById('z')?.runAnimation(
				new LineAnimation({
					duration: 200,
					ease: easing.inOutQuad,
					dataSeries: animationDS.z,
				}),
			);
			psdChart.surface.current?.renderableSeries.getById('total')?.runAnimation(
				new MountainAnimation({
					duration: 200,
					ease: easing.inOutQuad,
					dataSeries: animationDS.total,
				}),
			);
			updatePsdChartRange(new NumberRange(0, 0));
			// Wait for the stream to start before returning so this function can be awaited for stream start/stop
			if (val) {
				await updateLoadingState.current(val);
			}
		},
		[
			psdChart.data,
			psdChart.surface,
			updatePsdChartRange,
			xSignalChart.data,
			xSignalChart.surface,
			ySignalChart.data,
			ySignalChart.surface,
			zSignalChart.data,
			zSignalChart.surface,
		],
	);

	const timeSinceLastPsd = useRef<number>(performance.now());

	const updatePSD = useCallback(
		(res: Omit<PSDResult, 'source'>) => {
			const surface = psdChart.surface.current;
			if (surface == null) {
				return;
			}
			const elapsed = performance.now() - timeSinceLastPsd.current;
			timeSinceLastPsd.current = performance.now();
			if (res.total.frequencies.reduce((acc, val) => acc + val, 0) < 200) {
				return;
			}
			const animationDS = psdChart.data.current?.animationSeries;
			if (animationDS == null) {
				throw new Error('No animation data series');
			}
			// Log lengths if estimates and frequencies aren't the same length
			if (res.x.frequencies.length !== res.x.estimates.length) {
				getLogger().warn(
					`X estimates and frequencies are not the same length (${res.x.estimates.length} vs ${res.x.frequencies.length})`,
				);
			}
			if (res.y.frequencies.length !== res.y.estimates.length) {
				getLogger().warn(
					`Y estimates and frequencies are not the same length (${res.y.estimates.length} vs ${res.y.frequencies.length})`,
				);
			}
			if (res.z.frequencies.length !== res.z.estimates.length) {
				getLogger().warn(
					`Z estimates and frequencies are not the same length (${res.z.estimates.length} vs ${res.z.frequencies.length})`,
				);
			}
			if (res.total.frequencies.length !== res.total.estimates.length) {
				getLogger().warn(
					`Total estimates and frequencies are not the same length  (${res.total.estimates.length} vs ${res.total.frequencies.length})`,
				);
			}
			if (res.x.frequencies.length !== surface.renderableSeries.getById('x')?.dataSeries.count()) {
				getLogger().warn(
					`X frequencies are not the same length as the data series (${res.x.estimates.length} vs ${surface.renderableSeries.getById('x')?.dataSeries.count()})`,
				);
				surface.renderableSeries.getById('x')?.dataSeries.clear();
				surface.renderableSeries.getById('y')?.dataSeries.clear();
				surface.renderableSeries.getById('z')?.dataSeries.clear();
				surface.renderableSeries.getById('total')?.dataSeries.clear();
				(surface.renderableSeries.getById('x')?.dataSeries as XyDataSeries | null)?.appendRange(
					res.x.frequencies,
					new Array(res.x.frequencies.length).fill(0),
				);
				(surface.renderableSeries.getById('y')?.dataSeries as XyDataSeries | null)?.appendRange(
					res.y.frequencies,
					new Array(res.y.frequencies.length).fill(0),
				);
				(surface.renderableSeries.getById('z')?.dataSeries as XyDataSeries | null)?.appendRange(
					res.z.frequencies,
					new Array(res.z.frequencies.length).fill(0),
				);
				(surface.renderableSeries.getById('total')?.dataSeries as XyDataSeries | null)?.appendRange(
					res.total.frequencies,
					new Array(res.total.frequencies.length).fill(0),
				);
			}
			animationDS.x.clear();
			animationDS.y.clear();
			animationDS.z.clear();
			animationDS.total.clear();
			animationDS.x.appendRange(res.x.frequencies, res.x.estimates);
			animationDS.y.appendRange(res.y.frequencies, res.y.estimates);
			animationDS.z.appendRange(res.z.frequencies, res.z.estimates);
			animationDS.total.appendRange(res.total.frequencies, res.total.estimates);
			surface.renderableSeries.getById('x')?.runAnimation(
				new LineAnimation({
					duration: Math.max(elapsed, 100),
					ease: easing.inOutQuad,
					dataSeries: animationDS.x,
				}),
			);
			surface.renderableSeries.getById('y')?.runAnimation(
				new LineAnimation({
					duration: Math.max(elapsed, 100),
					ease: easing.inOutQuad,
					dataSeries: animationDS.y,
				}),
			);
			surface.renderableSeries.getById('z')?.runAnimation(
				new LineAnimation({
					duration: Math.max(elapsed, 100),
					ease: easing.inOutQuad,
					dataSeries: animationDS.z,
				}),
			);
			surface.renderableSeries.getById('total')?.runAnimation(
				new MountainAnimation({
					duration: Math.max(elapsed, 100),
					ease: easing.inOutQuad,
					dataSeries: animationDS.total,
				}),
			);
			updatePsdChartRange(new NumberRange(res.total.powerRange.min, res.total.powerRange.max));
		},
		[psdChart.data, psdChart.surface, updatePsdChartRange],
	);
	const updateSignals = useCallback(
		async ([time, x, y, z]: [Float64Array, Float64Array, Float64Array, Float64Array]) => {
			xSignalChart.data.current?.signalData.appendRange(time, x);
			ySignalChart.data.current?.signalData.appendRange(time, y);
			zSignalChart.data.current?.signalData.appendRange(time, z);
			xSignalChart.data.current?.historyData.appendRange(time, x);
			ySignalChart.data.current?.historyData.appendRange(time, y);
			zSignalChart.data.current?.historyData.appendRange(time, z);
			updateSignalChartRange();
		},
		[updateSignalChartRange, xSignalChart.data, ySignalChart.data, zSignalChart.data],
	);

	const onStreamError = useCallback(
		(err: Error) => {
			setIsChartEnabled(false);
			getLogger().error(err);
			toast.error('Error during accelerometer data streaming', { description: err.message });
		},
		[setIsChartEnabled],
	);

	const { startAccumulation, stopAccumulation, streamStarted, streamStopped } = useWorker(
		isChartEnabled,
		adxl,
		updateSignals,
		updatePSD,
		onStreamError,
	);

	updateLoadingState.current = useCallback(
		async (val: boolean) => {
			setIsLoading(true);
			if (val === false) {
				return streamStopped().finally(() => {
					setIsLoading(false);
				});
			} else {
				return streamStarted().finally(() => {
					setIsLoading(false);
				});
			}
		},
		[streamStarted, streamStopped],
	);

	return useMemo(
		() => ({
			isChartEnabled,
			isLoading,
			setIsChartEnabled,
			streamStarted,
			streamStopped,
			psds: {
				startAccumulation,
				stopAccumulation,
			},
			currentAccelerometer: adxl,
			currentAccelerometerHardwareName: adxlHardwareName,
			chartProps: {
				xSignalChart,
				ySignalChart,
				zSignalChart,
				psdChart,
			},
		}),
		[
			isChartEnabled,
			isLoading,
			setIsChartEnabled,
			streamStarted,
			streamStopped,
			startAccumulation,
			stopAccumulation,
			adxl,
			adxlHardwareName,
			xSignalChart,
			ySignalChart,
			zSignalChart,
			psdChart,
		],
	);
};

type RealtimeAnalysisChartProps = ReturnType<typeof useRealtimeAnalysisChart>['chartProps'];

export const RealtimeAnalysisChart: React.FC<RealtimeAnalysisChartProps> = React.memo(
	({ xSignalChart, ySignalChart, zSignalChart, psdChart }) => {
		return (
			<div className="flex max-h-full min-h-full flex-col space-y-4 @container">
				{/* <Toolbar buttons={toolbarButtons} /> */}
				<div className="grid grid-cols-1 gap-4 @screen-lg:grid-cols-3">
					<Card className="flex max-h-32 min-h-32 overflow-hidden @screen-lg:max-h-72 @screen-lg:min-h-72">
						<h3 className="text-md absolute left-0 right-0 top-0 flex items-center space-x-2 p-4 font-semibold">
							<div className={twJoin('flex-none rounded-full bg-yellow-400/10 p-1 text-yellow-400')}>
								<div className="h-2 w-2 rounded-full bg-current" />
							</div>
							<span className="text-zinc-100">X Signal</span>
						</h3>
						<SciChartReact
							{...xSignalChart.forwardProps}
							className="flex-1 rounded-lg"
							fallback={<FullLoadScreen className="ml-[150px]" />}
						/>
					</Card>
					<Card className="flex max-h-32 min-h-32 overflow-hidden @screen-lg:max-h-72 @screen-lg:min-h-72">
						<h3 className="text-md absolute left-0 right-0 top-0 flex items-center space-x-2 p-4 font-semibold">
							<div className={twJoin('flex-none rounded-full bg-sky-400/10 p-1 text-sky-400')}>
								<div className="h-2 w-2 rounded-full bg-current" />
							</div>
							<span className="text-zinc-100">Y Signal</span>
						</h3>
						<SciChartReact
							{...ySignalChart.forwardProps}
							className="flex-1 rounded-lg"
							fallback={<FullLoadScreen className="ml-[150px]" />}
						/>
					</Card>
					<Card className="flex max-h-32 min-h-32 overflow-hidden @screen-lg:max-h-72 @screen-lg:min-h-72">
						<h3 className="text-md absolute left-0 right-0 top-0 flex items-center space-x-2 p-4 font-semibold">
							<div className={twJoin('flex-none rounded-full bg-rose-400/10 p-1 text-rose-400')}>
								<div className="h-2 w-2 rounded-full bg-current" />
							</div>
							<span className="text-zinc-100">Z Signal</span>
						</h3>
						<SciChartReact
							{...zSignalChart.forwardProps}
							className="flex-1 rounded-lg"
							fallback={<FullLoadScreen className="ml-[150px]" />}
						/>
					</Card>
				</div>
				<Card className="relative flex flex-1 overflow-hidden">
					<SciChartReact
						{...psdChart.forwardProps}
						className="flex-1"
						fallback={<FullLoadScreen className="ml-[150px]" />}
					/>
					<LiveGcodeResponse className="absolute right-4 top-4" />
				</Card>
			</div>
		);
	},
);
