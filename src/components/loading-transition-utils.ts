// The splash is for entering the app: the home page, sign-in, a typed URL, a bookmark or another site. A full page load
// whose referrer is another page of this app (a "View on calendar" link in an email) is not an entry.
export const ENTRY_PATHS = ["/", "/login", "/setup"];

// Runs while the server HTML is parsed, before first paint and before hydration, so an in-app full page load never
// flashes the splash. It is a constant on purpose: the Content-Security-Policy allows it by its SHA-256 hash
// (src/lib/security/inline-scripts.ts), so any change here changes the hash with it.
export const SPLASH_GUARD_SCRIPT = `try{var r=document.referrer;if(r){var u=new URL(r);if(u.origin===location.origin&&${JSON.stringify(ENTRY_PATHS)}.indexOf(u.pathname)<0)document.documentElement.setAttribute("data-splash-seen","")}}catch(e){}`;
export const SPLASH_GUARD_STYLE = "html[data-splash-seen] .splash-overlay{display:none!important}";
