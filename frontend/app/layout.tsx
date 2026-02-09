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
        <Toaster position="bottom-center" richColors />
      </body>
    </html>
  );
}
