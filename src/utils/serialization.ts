import type { z } from 'zod';
import { Drivers } from '@/data/drivers';
import {
	BasePrinterRail,
	Driver,
	PrinterRail,
	PrinterRailDefinition,
	SerializedPrinterRail,
	SerializedPrinterRailDefinition,
	Stepper,
	PrinterAxis,
	DriverID,
} from '@/zods/motion';
import { Steppers } from '@/data/steppers';
import {
	ToolheadConfiguration,
	SerializedToolheadConfiguration,
	PartialToolheadConfiguration,
	SerializedPartialToolheadConfiguration,
	ToolOrAxis,
} from '@/zods/toolhead';
import { PartialPrinterConfiguration } from '@/zods/printer-configuration';
import { ToolheadHelper, ToolheadSuffix } from '@/helpers/toolhead';
import {
	Accelerometer,
	AccelerometerType,
	KlipperAccelSensorName,
	KlipperAccelSensorSchema,
	klipperAccelSensorSchema,
} from '@/zods/hardware';
import { Board, Toolboard } from '@/zods/boards';

export const deserializeDriver = (driverId: z.input<typeof DriverID>): z.infer<typeof Driver> | null => {
	return Drivers.find((d) => d.id === driverId) ?? null;
};

export const deserializeStepper = (stepperId: z.input<typeof Stepper.shape.id>): z.infer<typeof Stepper> | null => {
	return Steppers.find((d) => d.id === stepperId) ?? null;
};

export const deserializePrinterRail = (rail: z.input<typeof SerializedPrinterRail>): z.infer<typeof PrinterRail> => {
	const stepper = deserializeStepper(rail.stepper);
	const driver = deserializeDriver(rail.driver);
	if (stepper == null) {
		throw new Error(`Stepper ${rail.stepper} not found in database`);
	}
	if (driver == null) {
		throw new Error(`Driver ${rail.driver} not found in database`);
	}
	return BasePrinterRail.parse({
		...rail,
		stepper,
		driver,
	});
};

export const deserializePrinterRailDefinition = (
	rail: z.input<typeof SerializedPrinterRailDefinition>,
): z.infer<typeof PrinterRailDefinition> => {
	const stepper = deserializeStepper(rail.stepper);
	const driver = deserializeDriver(rail.driver);
	if (stepper == null) {
		throw new Error(`Stepper ${rail.stepper} not found in database`);
	}
	if (driver == null) {
		throw new Error(`Driver ${rail.driver} not found in database`);
	}
	return PrinterRailDefinition.parse({
		...rail,
		stepper,
		driver,
	});
};

export const stringToTitleObject = <Item extends string>(data: Item): { id: Item; title: Item } => {
	return { id: data, title: data };
};

export const serializePrinterRail = (rail: z.input<typeof PrinterRail>): z.infer<typeof SerializedPrinterRail> => {
	return SerializedPrinterRail.parse({
		...rail,
		driver: rail.driver.id,
		stepper: rail.stepper.id,
	});
};

export const serializeToolheadConfiguration = (th: ToolheadConfiguration<any>): SerializedToolheadConfiguration => {
	return {
		...th,
		toolboard: th.toolboard?.id,
		hotend: th.hotend.id,
		thermistor: th.thermistor,
		extruder: th.extruder.id,
		probe: th.probe?.id,
		xEndstop: th.xEndstop.id,
		yEndstop: th.yEndstop.id,
		partFan: th.partFan.id,
		hotendFan: th.hotendFan.id,
		xAccelerometer: th.xAccelerometer?.id,
		yAccelerometer: th.yAccelerometer?.id,
	};
};

export const serializePartialToolheadConfiguration = (
	th: PartialToolheadConfiguration,
): SerializedPartialToolheadConfiguration => {
	return th == null
		? undefined
		: {
				...th,
				toolboard: th.toolboard?.id,
				hotend: th.hotend?.id,
				thermistor: th.thermistor,
				extruder: th.extruder?.id,
				probe: th.probe?.id,
				xEndstop: th.xEndstop?.id,
				yEndstop: th.yEndstop?.id,
				partFan: th.partFan?.id,
				hotendFan: th.hotendFan?.id,
				xAccelerometer: th.xAccelerometer?.id,
				yAccelerometer: th.yAccelerometer?.id,
			};
};

export const extractToolheadsFromPrinterConfiguration = (config: PartialPrinterConfiguration) => {
	const toolheads = config?.toolheads
		?.map((th) => {
			if (th == null) {
				throw new Error('Toolhead can not be null');
			}
			return new ToolheadHelper(ToolheadConfiguration.parse(th));
		})
		.filter(Boolean);
	if (toolheads == null) {
		throw new Error('No toolheads found');
	}
	return toolheads;
};

export const extractToolheadFromPrinterConfiguration = (
	toolOrAxis: ToolOrAxis | PrinterAxis,
	config: PartialPrinterConfiguration,
) => {
	if (config?.toolheads == null || config.toolheads.length === 0) {
		throw new Error('No toolheads preset in supplied printer config');
	}
	const toolheads = extractToolheadsFromPrinterConfiguration(config);
	const th =
		typeof toolOrAxis === 'number'
			? toolheads.find((th) => th.getTool() === toolOrAxis)
			: toolheads.find((th) => th.getExtruderAxis() === toolOrAxis || th.getMotionAxis() === toolOrAxis);
	return th;
};

export const getAccelerometerWithType = (
	accelerometer: z.infer<typeof Accelerometer>,
	toolheadSuffix: ToolheadSuffix | null,
	toolboard?: Toolboard | null,
	controlboard?: Board | null,
): KlipperAccelSensorSchema | null => {
	let accelType: z.infer<typeof AccelerometerType> = 'adxl345';
	if (accelerometer.id === 'toolboard') {
		if (toolboard == null) {
			throw new Error('Toolboard not found in supplied printer config');
		}
		if (toolboard.ADXL345SPI != null) {
			accelType = 'adxl345';
		}
		if (toolboard.LIS2DW != null) {
			accelType = 'lis2dw';
		}
	} else if (accelerometer.id === 'controlboard') {
		if (controlboard == null) {
			throw new Error('Controlboard needed to determine accelerometer type');
		}
		if (controlboard.ADXL345SPI != null) {
			accelType = 'adxl345';
		}
		if (controlboard.LIS2DW != null) {
			accelType = 'lis2dw';
		}
	} else if (accelerometer.id === 'beacon') {
		accelType = 'beacon';
	} else if (accelerometer.id === 'sbc') {
		accelType = 'adxl345';
	}
	if (accelerometer.id === 'none') {
		return null;
	}
	return klipperAccelSensorSchema.parse({
		name: accelerometerIdToKlipperAccelSensorName(accelerometer, toolheadSuffix, toolboard, controlboard),
		type: accelType,
	});
};

export const accelerometerIdToKlipperAccelSensorName = (
	accelerometer: z.infer<typeof Accelerometer>,
	toolheadSuffix: ToolheadSuffix | null,
	toolboard?: Toolboard | null,
	controlboard?: Board | null,
): KlipperAccelSensorName => {
	if (accelerometer.id === 'toolboard') {
		if (toolboard == null) {
			throw new Error('Toolboard not found in supplied printer config');
		}
		return toolheadSuffix === 't0' ? 'toolboard_t0' : 'toolboard_t1';
	}
	if (accelerometer.id === 'controlboard') {
		if (controlboard == null) {
			throw new Error('Controlboard not found in supplied printer config');
		}
		return 'controlboard';
	}
	if (accelerometer.id === 'beacon') {
		return 'beacon';
	}
	if (accelerometer.id === 'sbc') {
		return 'rpi';
	}
	throw new Error('Cannot translate accelerometer id to Klipper accel sensor name');
};
