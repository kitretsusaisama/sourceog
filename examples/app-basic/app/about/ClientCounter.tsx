"use client";

import React from "react";
import { callServerAction } from "sourceog/actions";

export default function ClientCounter(): React.JSX.Element {
  const [count, setCount] = React.useState(0);
  const [status, setStatus] = React.useState<"idle" | "saving" | "saved">("idle");

  async function handleIncrement(): Promise<void> {
    setCount((current) => current + 1);
    setStatus("saving");
    await callServerAction("recordAboutVisit");
    setStatus("saved");
  }

  return (
    <div>
      <p>Client counter: {count}</p>
      <p>Server action status: {status}</p>
      <button type="button" onClick={() => void handleIncrement()}>
        Increment
      </button>
    </div>
  );
}
