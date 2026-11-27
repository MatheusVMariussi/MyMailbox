// Relative imports: next.config.ts loads this module (through headers.ts) outside the app's path aliases.
import { SPLASH_GUARD_SCRIPT } from "../../components/loading-transition-utils";
import { sidebarBootstrapScript } from "../../components/sidebar-state-utils";
import { themeBootstrapScript } from "../../components/theme-utils";

/**
 * Every inline `<script>` the app renders itself (root layout and the splash guard). They are constants,
 * so the Content-Security-Policy allows them by SHA-256 hash; the framework's own inline scripts (RSC
 * payload, navigation bootstrap, React streaming) carry the per-request nonce instead. An inline script
 * added anywhere else is blocked in production until it is listed here.
 */
export const APP_INLINE_SCRIPTS: readonly string[] = [sidebarBootstrapScript, themeBootstrapScript, SPLASH_GUARD_SCRIPT];
