"use client";

import { useLanguage } from "@/components/language-provider";
import { projectColorKeys } from "@/lib/projects/color-keys";
import { PROJECT_COLOR_VALUES } from "@/lib/projects/colors";
import { cn } from "@/lib/utils";

type Props = {
	value: string;
	onChange: (color: string) => void;
	disabled?: boolean;
};

/** The project palette as radio swatches: the identity accents first, then the label colors. */
export function ProjectColorPicker({ value, onChange, disabled }: Props) {
	const { t } = useLanguage();
	return (
		<div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t("projects.color")}>
			{PROJECT_COLOR_VALUES.map((color) => {
				const name = projectColorKeys[color] ? t(projectColorKeys[color]) : color;
				return (
					<button
						key={color}
						type="button"
						role="radio"
						aria-checked={value === color}
						aria-label={name}
						title={name}
						disabled={disabled}
						onClick={() => onChange(color)}
						className={cn(
							"h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-50",
							value === color ? "border-neutral-900 ring-2 ring-neutral-300 ring-offset-2" : "border-transparent",
						)}
						style={{ backgroundColor: color }}
					/>
				);
			})}
		</div>
	);
}
