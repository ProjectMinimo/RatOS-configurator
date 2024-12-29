export type NullableRequiredToPartial<T> = Partial<{ [key in keyof T]: NonNullable<T[key]> }>;

export const removeNulledProperties = <T extends object>(opts: T): NullableRequiredToPartial<T> => {
	const result = { ...opts };
	Object.keys(opts).forEach((opt) => {
		if (result[opt as keyof T] === null) {
			delete result[opt as keyof T];
		}
	});
	return result;
};

export type PartialToNullableRequired<T> = Required<{ [key in keyof T]: T[key] | null }>;

/**
 * Typically used with `options` objects where most or all propeties are optional, returns a copy of {@link opts} which
 * contains only the properties of {@link T}. Properties of {@link T} that are not defined by {@link opts} will be replaced
 * by the default values in {@link defaults}. By design, {@link defaults} must declare all the properties of {@link T},
 * using value `null` if there is no default value for a given property. Properties that are not defined by either
 * {@link opts} or {@link defaults} will be absent from the returned object.
 *
 * Example:
 * @example
 * const defaultOptions: PartialToNullableRequired<TransformOptions> = {
 *    abortSignal: null,
 *    progressTransform: null,
 *    allowUnsupportedSlicerVersions: false,
 *    onWarning: () => {},
 *    printerHasIdex: false,
 *    quickInspectionOnly: false,
 * };
 * strictWithDefaults(test, defaultOptions);
 * */
export const strictWithDefaults = <T extends object, S extends PartialToNullableRequired<T>>(
	opts: Partial<T>,
	structure: [PartialToNullableRequired<T>] extends [S] ? S : `STRUCTURE_DOES_NOT_MATCH_INPUT`,
): NullableRequiredToPartial<T> => {
	return removeNulledProperties(
		Object.fromEntries(
			Object.keys(structure).map((k) => [k, opts[k as keyof T] ?? null]),
		) as NullableRequiredToPartial<T>,
	);
};
