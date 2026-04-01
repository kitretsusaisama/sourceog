import React from "react";

export default function EnterpriseLayout(props: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html>
      <body>{props.children}</body>
    </html>
  );
}
