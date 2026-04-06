const defaults = {
	perspective: 695,
	rotateX: -10,
	rotateY: -30,
	scale: 1.5,
	translateY: -15,
	opacity: 0.3,
	gridSize: 45,
	rotateZ: 10,
};

export function PerspectiveGrid() {
	const transform = `perspective(${defaults.perspective}px) rotateX(${defaults.rotateX}deg) rotateY(${defaults.rotateY}deg) rotateZ(${defaults.rotateZ}deg) scale(${defaults.scale}) translateY(${defaults.translateY}%)`;

	return (
		<div className="pointer-events-none absolute inset-0 overflow-hidden">
			<div
				className="absolute inset-0"
				style={{
					backgroundImage: `
            linear-gradient(to right, var(--color-border) 1px, transparent 1px),
            linear-gradient(to bottom, var(--color-border) 1px, transparent 1px)
          `,
					backgroundSize: `${defaults.gridSize}px ${defaults.gridSize}px`,
					opacity: defaults.opacity,
					transform,
					transformOrigin: "center top",
					maskImage:
						"linear-gradient(to bottom, transparent 0%, black 30%, black 70%, transparent 100%)",
				}}
			/>
		</div>
	);
}
