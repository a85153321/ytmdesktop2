import { type ReactNode, useId } from "react";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Slider } from "@/components/ui/slider";
import { useSettingsState } from "@/hooks/use-settings";
import { cn } from "@/lib/utils";

export interface SettingsSliderProps {
	configKey: string;
	defaultValue?: number;
	min?: number;
	max?: number;
	step?: number;
	label?: ReactNode;
	description?: ReactNode;
	formatValue?: (value: number) => ReactNode;
	className?: string;
	disabled?: boolean;
	debounce?: number;
	onChange?: (value: number) => void;
}

export function SettingsSlider({
	configKey,
	defaultValue = 0,
	min = 0,
	max = 100,
	step = 1,
	label,
	description,
	formatValue = (val) => `${val}%`,
	className,
	disabled = false,
	debounce = 150,
	onChange,
}: SettingsSliderProps) {
	const id = useId();
	const [value, setValue, { isPending }] = useSettingsState<number>(configKey, defaultValue, {
		debounce,
	});

	const locked = disabled || isPending;
	const numericVal = typeof value === "number" && Number.isFinite(value) ? value : defaultValue;

	const handleValueChange = (vals: number | readonly number[]) => {
		const next = Array.isArray(vals) ? vals[0] : vals;
		if (typeof next !== "number" || !Number.isFinite(next)) return;
		setValue(next);
		onChange?.(next);
	};

	return (
		<Field data-disabled={locked || undefined} className={cn("gap-2", className)}>
			<div className="flex items-center justify-between gap-4">
				{label ? <FieldLabel htmlFor={id}>{label}</FieldLabel> : <span />}
				<span className="font-mono text-xs font-medium tabular-nums text-muted-foreground select-none">
					{formatValue(numericVal)}
				</span>
			</div>
			<Slider
				id={id}
				min={min}
				max={max}
				step={step}
				disabled={locked}
				value={[numericVal]}
				onValueChange={handleValueChange}
			/>
			{description ? <FieldDescription>{description}</FieldDescription> : null}
		</Field>
	);
}

export default SettingsSlider;
