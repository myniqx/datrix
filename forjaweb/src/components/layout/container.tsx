import { cn } from "@/lib/utils"

interface ContainerProps extends React.ComponentProps<"div"> {
  children: React.ReactNode
}

export function Container({ className, children, ...props }: ContainerProps) {
  return (
    <div
      className={cn("mx-auto w-full max-w-6xl px-6", className)}
      {...props}
    >
      {children}
    </div>
  )
}
