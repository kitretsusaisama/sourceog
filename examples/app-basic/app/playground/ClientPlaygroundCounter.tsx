"use client";

import React from "react";

export default function ClientPlaygroundCounter(): React.JSX.Element {
  const [count, setCount] = React.useState(0);

  return (
    <button type="button" onClick={() => setCount((current) => current + 1)}>
      Count: {count}
    </button>
  );
}
