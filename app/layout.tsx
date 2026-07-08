import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Digital Record Player",
  description: "A digital record player.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
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
