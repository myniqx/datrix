export function DatrixLogo({ size = 32 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 32 32"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* Outer ring dots */}
			{Array.from({ length: 12 }).map((_, i) => {
				const angle = (i / 12) * Math.PI * 2;
				const r = 14;
				const x = 16 + r * Math.cos(angle);
				const y = 16 + r * Math.sin(angle);
				return (
					<circle
						key={i}
						cx={x}
						cy={y}
						r={1.1}
						fill="currentColor"
						opacity={0.5}
					/>
				);
			})}
			{/* Middle ring dots */}
			{Array.from({ length: 8 }).map((_, i) => {
				const angle = (i / 8) * Math.PI * 2 + 0.3;
				const r = 9;
				const x = 16 + r * Math.cos(angle);
				const y = 16 + r * Math.sin(angle);
				return (
					<circle
						key={i}
						cx={x}
						cy={y}
						r={1.3}
						fill="currentColor"
						opacity={0.75}
					/>
				);
			})}
			{/* Inner ring dots */}
			{Array.from({ length: 5 }).map((_, i) => {
				const angle = (i / 5) * Math.PI * 2 + 0.6;
				const r = 4.5;
				const x = 16 + r * Math.cos(angle);
				const y = 16 + r * Math.sin(angle);
				return (
					<circle
						key={i}
						cx={x}
						cy={y}
						r={1.5}
						fill="currentColor"
						opacity={1}
					/>
				);
			})}
			{/* Center dot */}
			<circle cx={16} cy={16} r={1.8} fill="currentColor" />
		</svg>
	);
}
