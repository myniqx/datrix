import "@fontsource-variable/inter";
import "highlight.js/styles/github-dark.min.css";
import "@fontsource-variable/jetbrains-mono";
import "./app/globals.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";

document.documentElement.classList.add("dark");

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element not found");

createRoot(rootElement).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
