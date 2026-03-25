import type { Metadata } from "next";
import { serifFont, sansFont } from "./config/fonts";
import { AuthProvider } from "./context/AuthContext";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Presentation Coach - University of Chicago",
  description: "AI-powered presentation coaching and feedback system",
  icons: {
    icon: [
      { url: "/favicon.ico", type: "image/x-icon" },
      { url: "/favicon-32x32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16x16.png", type: "image/png", sizes: "16x16" },
      { url: "/icon.png", type: "image/png", sizes: "48x48" },
    ],
    shortcut: ["/favicon.ico"],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${serifFont.variable} ${sansFont.variable} antialiased`}
      >
        <AuthProvider>{children}</AuthProvider>
        <Toaster
          position="bottom-left"
          richColors
          toastOptions={{
            style: {
              fontSize: '0.875rem',
              padding: '14px 18px',
              borderRadius: '10px',
            },
            className: 'font-sans',
          }}
        />
      </body>
    </html>
  );
}
