"use client"

import { useState } from "react"
import { CopyIcon, CheckIcon } from "lucide-react"

interface CopyButtonProps {
  text: string
}

export function CopyButton({ text }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button onClick={handleCopy} className="ml-auto text-foreground/80 hover:text-foreground transition-colors">
      {copied
        ? <CheckIcon className="size-4 text-[rgb(134,239,172)]" />
        : <CopyIcon className="size-4" />
      }
    </button>
  )
}
