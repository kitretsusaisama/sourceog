import React from "react";

export default function EdgeLayout(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html>
      <body>{props.children}</body>
    </html>
  );
}
