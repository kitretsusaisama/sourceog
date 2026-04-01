import React from "react";

export default function StaticLayout(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html>
      <body>{props.children}</body>
    </html>
  );
}
