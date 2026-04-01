"use client";

import React from "react";

export const metadata = {
  title: "SourceOG Playground"
};

export default function PlaygroundPage(): React.JSX.Element {
  const [count, setCount] = React.useState(0);

  return (
    <section>
      <h1>Playground</h1>
      <p>Fully client-rooted route for hydration and bundle verification.</p>
      <button type="button" onClick={() => setCount((current) => current + 1)}>
        Count: {count}
      </button>
    </section>
  );
}
