import type { Metadata } from "next";
import { serifFont, sansFont } from "./config/fonts";
import { AuthProvider } from "./context/AuthContext";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Presentation Coach - University of Chicago",
  description: "AI-powered presentation coaching and feedback system",
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
          position="bottom-center"
          richColors
          toastOptions={{
            style: {
              fontSize: '1.1rem',
              padding: '20px 24px',
              minWidth: '380px',
              borderRadius: '14px',
            },
            className: 'font-sans',
          }}
        />
      </body>
    </html>
  );
}
