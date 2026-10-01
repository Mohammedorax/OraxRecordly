import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import { getInitialLocale, I18nProvider } from "./contexts/I18nContext.tsx";
import { ThemeProvider } from "./contexts/ThemeContext.tsx";
import { getLocaleDirection } from "./i18n/config";
import "./index.css";

document.documentElement.dataset.platform = /mac/i.test(navigator.platform) ? "macos" : "other";

// Seed <html lang> / <html dir> from the persisted language before the first
// React render, so an RTL locale never flashes a left-to-right layout.
const initialLocale = getInitialLocale();
document.documentElement.lang = initialLocale;
document.documentElement.dir = getLocaleDirection(initialLocale);

ReactDOM.createRoot(document.getElementById("root")!).render(
	<React.StrictMode>
		<ThemeProvider>
			<I18nProvider>
				<App />
			</I18nProvider>
		</ThemeProvider>
	</React.StrictMode>,
);
