
import type { Metadata } from "next";
import "./globals.css";
import "./ui-theme.css";

export const metadata: Metadata = {
  title: "AROMEVA",
  description: "AROMEVA Investment Simulator",
  icons: {
    icon: [
      { url: '/aromeva-logo.png', type: 'image/png' },
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
      <body className="unify-pastel">{children}</body>
    </html>
  );
}
