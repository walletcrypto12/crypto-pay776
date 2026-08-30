import type { Metadata } from "next";

export const metadata: Metadata = { title: "CryptoPay Admin" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0f1e", color: "#f1f5f9", fontFamily: "system-ui, sans-serif", minHeight: "100vh" }}>
        {children}
      </body>
    </html>
  );
}
