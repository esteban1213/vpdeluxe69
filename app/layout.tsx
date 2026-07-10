import type { Metadata } from "next";
import { Bitcount_Single, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const bitcountSingle = Bitcount_Single({
  variable: "--font-bitcount-single",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Vinny Records",
  description: "A digital record player.",
  // The web manifest (app/manifest.ts) covers Android/desktop install icons,
  // but iOS ignores it entirely for "Add to Home Screen" — Safari only
  // looks at apple-touch-icon links, so those are set here explicitly.
  icons: {
    icon: [
      {
        url: "/android/launchericon-192x192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        url: "/android/launchericon-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    apple: [
      { url: "/ios/120.png", sizes: "120x120", type: "image/png" },
      { url: "/ios/152.png", sizes: "152x152", type: "image/png" },
      { url: "/ios/167.png", sizes: "167x167", type: "image/png" },
      { url: "/ios/180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Turntable",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bitcountSingle.variable}`}
    >
      <body>
        {/* Catches JS errors that would otherwise fail silently (bundle
            load failures, thrown errors, unhandled rejections) and logs
            them to the console — no visible UI, so a stray/benign error
            (e.g. iOS's share sheet) can't make the app look broken. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  function log(){ try { console.error.apply(console, arguments); } catch(e) {} }
  window.addEventListener('error', function(e){
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) {
      log('ASSET FAILED:', t.src || t.href);
      return;
    }
    log('ERROR:', e.message, '@', (e.filename || '') + ':' + (e.lineno || ''));
    if (e.error && e.error.stack) log(e.error.stack);
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    log('REJECTION:', (r && (r.stack || r.message)) || String(r));
  });
})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
