import React from "react";
import { ClientIsland } from "sourceog/client-island";
import ClientPlaygroundCounter from "./ClientPlaygroundCounter";

export const metadata = {
  title: "SourceOG Playground"
};

export default function PlaygroundPage(): React.JSX.Element {
  return (
    <section>
      <h1>Playground</h1>
      <p>Server-first route with a client island for hydration and bundle verification.</p>
      <ClientIsland
        component={ClientPlaygroundCounter}
        moduleId="./ClientPlaygroundCounter"
      />
    </section>
  );
}
