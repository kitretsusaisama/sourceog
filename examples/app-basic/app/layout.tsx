import React from "react";

export const metadata = {
  title: "SourceOG Basic App",
  description: "A production-oriented SourceOG example."
};

export default function RootLayout(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en">
      <body>
        <header>
          <nav style={{ display: "flex", gap: "1rem" }}>
            <a href="/">Home</a>
            <a href="/about">About</a>
            <a href="/blog/hello-sourceog">Blog</a>
          </nav>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  );
}
