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
  title: "Digital Record Player",
  description: "A digital record player.",
  // The web manifest (app/manifest.ts) covers Android/desktop install icons,
  // but iOS ignores it entirely for "Add to Home Screen" — Safari only
  // looks at apple-touch-icon links, so those are set here explicitly.
  icons: {
    icon: [
      { url: "/android/launchericon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/android/launchericon-512x512.png", sizes: "512x512", type: "image/png" },
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
        {/* Temporary mobile debugging: surfaces JS errors on-page since we
            can't see the phone's console. Catches bundle-load failures too. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var box = null;
  function ensure(){
    if (!box) {
      box = document.createElement('div');
      box.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#7f1d1d;color:#fff;font:11px/1.4 monospace;padding:8px;max-height:40vh;overflow:auto;white-space:pre-wrap;';
      document.body.appendChild(box);
    }
    return box;
  }
  function log(m){ try { ensure().textContent += m + '\\n\\n'; } catch(e) {} }
  window.addEventListener('error', function(e){
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) {
      log('ASSET FAILED: ' + (t.src || t.href));
      return;
    }
    log('ERROR: ' + (e.message || '') + ' @ ' + (e.filename || '') + ':' + (e.lineno || ''));
    if (e.error && e.error.stack) log(e.error.stack.slice(0, 600));
  }, true);
  window.addEventListener('unhandledrejection', function(e){
    var r = e.reason;
    log('REJECTION: ' + ((r && (r.stack || r.message)) || String(r)).slice(0, 600));
  });
})();`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
